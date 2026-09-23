import { readIdempotencyKey } from "@/lib/analysis/idempotency";
import { exchanges, NEGOTIATION_EXCHANGES } from "@/lib/content/vocabulaire";
import { loadResultForViewer } from "@/lib/analysis/load";
import { analysisPaused, ANALYSIS_PAUSED_MESSAGE } from "@/lib/analysis/pause";
import { recomputeForTier } from "@/lib/analysis/recompute";
import { getRequestSession, logAuthUnavailable } from "@/lib/auth/request-user";
import { classifyModelError } from "@/lib/llm/errors";
import { readBrandReply } from "@/lib/llm/turn";
import { TURN_PROMPT_VERSION } from "@/lib/llm/turn-prompt";
import { cleanSentText, loadSentMessages, messageForNextTurn, saveSentMessage } from "@/lib/negotiation/sent";
import { loadThread, threadConcluded, turnForKey, TURNS_TABLE } from "@/lib/negotiation/store";
import { processTurn, stateBefore } from "@/lib/negotiation/turn";
import { FIRST_TURN, LAST_TURN, MAX_REPLY_LENGTH, MIN_REPLY_LENGTH, OFF_TOPIC_MESSAGE, TOO_SHORT_REPLY_MESSAGE, TURN_FAILURE_MESSAGE } from "@/lib/negotiation/types";
import { parseTier } from "@/lib/rates/tier";
import { clientIp } from "@/lib/security/request";
import { limitRule, limitVerdict } from "@/lib/security/limite";
import { insertRow, SupabaseRequestError } from "@/lib/supabase/server";
import { recordProductEvent } from "@/lib/analytics/first-party";

export const runtime = "nodejs";
export const maxDuration = 120;

// Mission #080 — un tour de négociation : la réponse de la marque, collée par
// la personne, s'ajoute à CETTE analyse (B1).
//
// Un tour ne consomme ni crédit ni quota (mission #080 ter) : l'analyse de
// l'offre, déjà payée, couvre toute la négociation, jusqu'à cinq tours. Gardes
// qui restent : rejeu par clé d'idempotence avant tout, filet horaire par IP,
// plafond de cinq tours, refus d'un texte qui n'est pas une réponse à cette
// offre (rien n'est alors enregistré).

const UNAVAILABLE = "Le suivi de l'échange n'est pas disponible pour le moment. Réessaie plus tard.";

function json(status: number, body: Record<string, unknown>) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, { params }: RouteContext<"/api/analyses/[id]/tours">) {
  const { id } = await params;
  // Mission #089 : authentification injoignable n'est pas « pas de session ».
  // On ne sait rien de la personne : on le dit, sans rien affirmer d'autre.
  const session = await getRequestSession(request);
  if (session.kind === "unavailable") {
    logAuthUnavailable("tours");
    return json(503, { error: UNAVAILABLE, reason: "unavailable" });
  }
  const user = session.kind === "valid" ? session.user : null;
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
  // Mission #099 : refusé ICI, avant le moindre appel au modèle.
  if (reply.length < MIN_REPLY_LENGTH) return json(400, { error: TOO_SHORT_REPLY_MESSAGE, reason: "too_short" });
  if (reply.length > MAX_REPLY_LENGTH) {
    return json(400, { error: "Cette réponse est trop longue : colle seulement le dernier message de la marque." });
  }
  if (!tier) return json(400, { error: "Recharge la page et réessaie." });
  if (analysisPaused()) return json(503, { error: ANALYSIS_PAUSED_MESSAGE, reason: "paused" });

  // Mission #102 — ce tour ne compte plus rien dans le filet horaire, et il
  // n'a jamais réservé de droit (la négociation est payée à l'analyse) : un
  // échec n'a donc rien à défaire. Le brouillon collé reste dans le navigateur.
  try {
    // Propriétaire connecté seulement : l'analyse complète (message compris).
    const result = await loadResultForViewer(id, { user, anonToken: null });
    if (!result || !result.unlocked) return json(404, { error: "Analyse introuvable." });
    const thread = await loadThread(id);
    if (thread === "missing") return json(503, { error: UNAVAILABLE, reason: "unavailable" });

    // Rejeu : ce tour a déjà été enregistré, rien n'est refait.
    let keyToWrite = key;
    if (key) {
      const replay = await turnForKey(id, key);
      if (replay?.kind === "turn") return json(200, { turnNumber: replay.turnNumber, replayed: true });
      if (replay?.kind === "taken") keyToWrite = null;
    }

    if (threadConcluded(thread)) return json(409, { error: "Cet échange est conclu : il n'y a plus de tour à ajouter.", reason: "concluded" });
    const turnNumber = FIRST_TURN + thread.turns.length;
    if (turnNumber > LAST_TURN) {
      return json(409, { error: `Les ${exchanges(NEGOTIATION_EXCHANGES)} de cette négociation sont utilisés. Tu peux conclure l'échange.`, reason: "max_turns" });
    }

    // Mission #102, partie B — un échange est une étape À L'INTÉRIEUR d'une
    // négociation déjà ouverte et déjà payée : il ne compte pas dans le filet
    // horaire, qui ne voit que les ouvertures (lib/security/limite.ts). Avant
    // cette mission, il frappait le compteur des analyses : une négociation
    // normale — analyse, 4 échanges, conclusion — pouvait se bloquer elle-même
    // au milieu, et le brouillon collé partait avec le refus.
    const verdict = limitVerdict(limitRule("echange", { userId: user.id, ip: clientIp(request) }), null);
    if (!verdict.allowed) return json(429, { error: verdict.message, reason: "rate_limited" });

    const original = result.analysis;
    const previous = thread.turns.map((turn) => turn.payload);
    const state = stateBefore(original, previous, result.sourceText);
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
      read = await readBrandReply({ deal: state.deal, asks: state.asks, points: state.points, lastMessage, brandReply: reply });
    } catch (caught) {
      const failure = classifyModelError(caught);
      if (!failure) throw caught;
      console.error(JSON.stringify({ event: failure.event.replace("analyse_", "tour_"), provider: failure.provider, status: failure.status, error_type: failure.errorType }));
      return json(failure.kind === "timeout" ? 504 : 503, { error: TURN_FAILURE_MESSAGE[failure.kind], reason: failure.kind });
    }

    const outcome = processTurn(
      // Mission #100 : le texte de l'offre sert à citer ce qu'elle dit déjà.
      { original, previous, turnNumber, tier, brandReply: reply, offerText: result.sourceText },
      read.reading,
    );
    if (outcome.kind === "off_topic") {
      // B3 : rien n'est enregistré.
      console.warn(JSON.stringify({ event: "tour_hors_sujet", relevance: outcome.relevance }));
      return json(422, { error: OFF_TOPIC_MESSAGE[outcome.relevance], reason: "off_topic" });
    }

    try {
      await insertRow<{ id: string }>(TURNS_TABLE, {
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
          return json(409, { error: "Ce tour vient déjà d'être enregistré. Recharge la page.", reason: "duplicate" });
      }
      throw caught;
    }
    if (thread.turns.length === 0) {
      await recordProductEvent({ event: "negotiation_started", userId: user.id, entityType: "analysis", entityId: id, dedupeKey: `negotiation_started:${id}` });
    }
    await recordProductEvent({
      event: "negotiation_turn", userId: user.id, entityType: "analysis", entityId: id,
      metadata: { turn: turnNumber }, dedupeKey: `negotiation_turn:${id}:${turnNumber}`,
    });
    if (outcome.payload.conclusion !== null) {
      await recordProductEvent({
        event: "negotiation_concluded", userId: user.id, entityType: "analysis", entityId: id,
        metadata: { turn: turnNumber, source: "brand_reply" }, dedupeKey: `negotiation_concluded:${id}`,
      });
    }

    console.log(
      JSON.stringify({
        event: "tour",
        turn: turnNumber,
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
    console.error(JSON.stringify({ event: "tour_failed", detail: caught instanceof Error ? caught.message.slice(0, 300) : "inconnu" }));
    return json(503, { error: UNAVAILABLE, reason: "unavailable" });
  }
}
