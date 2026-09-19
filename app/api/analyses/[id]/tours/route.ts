import { readIdempotencyKey } from "@/lib/analysis/idempotency";
import { loadResultForViewer } from "@/lib/analysis/load";
import { analysisPaused, ANALYSIS_PAUSED_MESSAGE } from "@/lib/analysis/pause";
import { recomputeForTier } from "@/lib/analysis/recompute";
import { getRequestUser } from "@/lib/auth/request-user";
import { reserveTurn, type Grant } from "@/lib/billing/entitlement";
import { classifyModelError, modelFailureMessage } from "@/lib/llm/errors";
import { readBrandReply } from "@/lib/llm/turn";
import { TURN_PROMPT_VERSION } from "@/lib/llm/turn-prompt";
import { cleanSentText, loadSentMessages, messageForNextTurn, saveSentMessage } from "@/lib/negotiation/sent";
import { loadThread, threadConcluded, turnForKey, TURNS_TABLE } from "@/lib/negotiation/store";
import { processTurn, stateBefore } from "@/lib/negotiation/turn";
import { FIRST_TURN, LAST_TURN, MAX_REPLY_LENGTH, MIN_REPLY_LENGTH, OFF_TOPIC_MESSAGE } from "@/lib/negotiation/types";
import { parseTier } from "@/lib/rates/tier";
import { clientIp, hashIp } from "@/lib/security/request";
import { hitUsageGuard, releaseUsageGuard } from "@/lib/security/usage-guard";
import { deleteRows, insertRow, SupabaseRequestError } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 120;

// Mission #080 — un tour de négociation : la réponse de la marque, collée par
// la personne, s'ajoute à CETTE analyse (B1).
//
// Mêmes gardes que l'analyse, dans le même ordre (D4) : rejeu par clé
// d'idempotence avant tout, filet horaire par IP, droit VÉRIFIÉ avant l'appel au
// modèle, DÉCOMPTÉ seulement après l'enregistrement du tour. Un texte qui n'est
// pas une réponse à cette offre ne coûte rien (B3) : l'appel au modèle est à
// nos frais.

const UNAVAILABLE = "Le suivi de l'échange n'est pas disponible pour le moment. Réessaie plus tard : rien n'a été décompté.";

function json(status: number, body: Record<string, unknown>) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, { params }: RouteContext<"/api/analyses/[id]/tours">) {
  const { id } = await params;
  const user = await getRequestUser(request);
  if (!user) return json(401, { error: "Connecte-toi pour suivre l'échange avec la marque.", reason: "signed_out" });

  const body = (await request.json().catch(() => null)) as {
    reply?: unknown;
    tier?: unknown;
    idempotencyKey?: unknown;
    // B3 : message corrigé par la créatrice au moment de coller la réponse.
    sentMessage?: unknown;
  } | null;
  const reply = typeof body?.reply === "string" ? body.reply.trim() : "";
  const tier = parseTier(body?.tier);
  const key = readIdempotencyKey(body?.idempotencyKey);
  if (reply.length < MIN_REPLY_LENGTH) return json(400, { error: "Colle la réponse de la marque." });
  if (reply.length > MAX_REPLY_LENGTH) {
    return json(400, { error: "Cette réponse est trop longue : colle seulement le dernier message de la marque." });
  }
  if (!tier) return json(400, { error: "Recharge la page et réessaie." });
  if (analysisPaused()) return json(503, { error: ANALYSIS_PAUSED_MESSAGE, reason: "paused" });

  let grant: Grant | null = null;
  let hourlyKey: string | null = null;
  let savedTurnId: string | null = null;
  async function abandon() {
    const steps: Array<() => Promise<unknown>> = [];
    if (savedTurnId) {
      const turnId = savedTurnId;
      steps.push(() => deleteRows(TURNS_TABLE, `id=eq.${turnId}`));
    }
    if (grant) steps.push(grant.release);
    if (hourlyKey) {
      const guardKey = hourlyKey;
      steps.push(() => releaseUsageGuard(guardKey));
    }
    for (const step of steps) {
      await step().catch((error: unknown) =>
        console.error(JSON.stringify({ event: "tour_abandon_error", detail: error instanceof Error ? error.message.slice(0, 200) : "inconnu" })),
      );
    }
  }

  try {
    // Propriétaire connecté seulement : l'analyse complète (message compris).
    const result = await loadResultForViewer(id, { user, anonToken: null });
    if (!result || !result.unlocked) return json(404, { error: "Analyse introuvable." });
    const thread = await loadThread(id);
    if (thread === "missing") return json(503, { error: UNAVAILABLE, reason: "unavailable" });

    // Rejeu : ce tour a déjà été enregistré, rien n'est refait ni décompté.
    let keyToWrite = key;
    if (key) {
      const replay = await turnForKey(id, key);
      if (replay?.kind === "turn") return json(200, { turnNumber: replay.turnNumber, replayed: true });
      if (replay?.kind === "taken") keyToWrite = null;
    }

    if (threadConcluded(thread)) return json(409, { error: "Cet échange est conclu : il n'y a plus de tour à ajouter.", reason: "concluded" });
    const turnNumber = FIRST_TURN + thread.turns.length;
    if (turnNumber > LAST_TURN) {
      return json(409, { error: `Les ${LAST_TURN - 1} tours de cette analyse sont utilisés. Tu peux conclure l'échange.`, reason: "max_turns" });
    }

    const guardKey = hashIp(clientIp(request));
    const guard = await hitUsageGuard(guardKey);
    if (!guard.allowed) return json(429, { error: `Tu as lancé 5 analyses en une heure. Réessaie dans ${guard.retryInMinutes} min.` });
    hourlyKey = guardKey;

    const entitlement = await reserveTurn(user);
    if (!entitlement.allowed) {
      await abandon();
      return json(402, { error: entitlement.message, paywall: true, reason: entitlement.reason });
    }
    grant = entitlement;

    const original = result.analysis;
    const previous = thread.turns.map((turn) => turn.payload);
    const state = stateBefore(original, previous);
    // Le message auquel la marque répond (B) : corrigé à l'instant, sinon
    // enregistré à la copie, sinon le message proposé, gardé comme hypothèse.
    const answeredTurn = turnNumber - 1;
    const corrected = cleanSentText(body?.sentMessage);
    if (corrected) {
      await saveSentMessage({ analysisId: id, userId: user.id, turnNumber: answeredTurn, text: corrected, source: "corrected" });
    }
    const sent = messageForNextTurn({
      corrected,
      recorded: (await loadSentMessages(id)).get(answeredTurn),
      proposed: previous.at(-1)?.message.text ?? recomputeForTier(original, tier).ready_to_send_message?.text ?? "",
    });
    const lastMessage = sent.text;

    let read: Awaited<ReturnType<typeof readBrandReply>>;
    try {
      read = await readBrandReply({ deal: state.deal, asks: state.asks, lastMessage, brandReply: reply });
    } catch (caught) {
      const failure = classifyModelError(caught);
      if (!failure) throw caught;
      await abandon();
      console.error(JSON.stringify({ event: failure.event.replace("analyse_", "tour_"), provider: failure.provider, status: failure.status, error_type: failure.errorType }));
      return json(failure.kind === "timeout" ? 504 : 503, { error: modelFailureMessage(failure.kind, entitlement.plan), reason: failure.kind });
    }

    const outcome = processTurn({ original, previous, turnNumber, tier, brandReply: reply }, read.reading);
    if (outcome.kind === "off_topic") {
      // B3 : rien n'est enregistré ni décompté.
      await abandon();
      console.warn(JSON.stringify({ event: "tour_hors_sujet", relevance: outcome.relevance }));
      return json(422, { error: OFF_TOPIC_MESSAGE[outcome.relevance], reason: "off_topic" });
    }

    let saved: { id: string };
    try {
      saved = await insertRow<{ id: string }>(TURNS_TABLE, {
        analysis_id: id,
        user_id: user.id,
        kind: "reply",
        turn_number: turnNumber,
        brand_reply: reply,
        payload: outcome.payload,
        model: read.usage.model,
        prompt_version: TURN_PROMPT_VERSION,
        rate_table_version: (outcome.payload.pricing_after ?? outcome.payload.pricing_before).rate_table_version,
        cost_cents: Number((read.usage.costEur * 100).toFixed(4)),
        latency_ms: read.usage.latencyMs,
        ...(keyToWrite ? { idempotency_key: keyToWrite } : {}),
      });
    } catch (caught) {
      // Deux envois simultanés du même tour : l'index unique n'en garde qu'un.
      if (caught instanceof SupabaseRequestError && caught.code === "23505") {
        await abandon();
        return json(409, { error: "Ce tour vient déjà d'être enregistré. Recharge la page.", reason: "duplicate" });
      }
      throw caught;
    }
    savedTurnId = saved.id;

    // Tour enregistré : le crédit est décompté MAINTENANT, jamais avant.
    if (!(await grant.commit())) {
      await abandon();
      return json(402, { error: "Tu n'as plus de crédit. Choisis une formule pour continuer.", paywall: true, reason: "no_credit" });
    }
    grant = null;
    savedTurnId = null;
    hourlyKey = null;

    console.log(
      JSON.stringify({
        event: "tour",
        turn: turnNumber,
        plan: entitlement.plan,
        outcome: outcome.payload.outcome,
        terms_changed: outcome.payload.changes.length,
        ignored_changes: outcome.payload.ignored_changes.length,
        message_fallback: outcome.payload.message.fallback,
        sent_message_basis: sent.basis,
        concluded: outcome.payload.conclusion !== null,
        model: read.usage.model,
        cost_eur: Number(read.usage.costEur.toFixed(6)),
        latency_ms: read.usage.latencyMs,
      }),
    );
    return json(200, { turnNumber });
  } catch (caught) {
    await abandon();
    console.error(JSON.stringify({ event: "tour_failed", detail: caught instanceof Error ? caught.message.slice(0, 300) : "inconnu" }));
    return json(503, { error: UNAVAILABLE, reason: "unavailable" });
  }
}
