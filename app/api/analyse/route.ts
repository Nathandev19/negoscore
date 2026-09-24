import { composeAnalysis } from "@/lib/analysis/compose";
import { messageCoverage, needsRewrite } from "@/lib/negotiation/coverage";
import { rewriteMessage } from "@/lib/llm/message-rewrite";
import { MAX_TEXT_LENGTH, TEXT_TRUNCATED_NOTE } from "@/lib/analysis/text";
import type { SessionUser } from "@/lib/auth/session";
import { getRequestSession, logAuthUnavailable } from "@/lib/auth/request-user";
import { claimRetry, RETRY_MESSAGES, sameOffer, type RetryClaim } from "@/lib/analysis/retry";
import { readIdempotencyKey, replayableAnalysis } from "@/lib/analysis/idempotency";
import { recordPendingDebit } from "@/lib/analysis/pending-debit";
import { reserveAnalysis, type Denial, type Grant } from "@/lib/billing/entitlement";
import { NO_FREE_LEFT_MESSAGE, rightHintCookieHeader } from "@/lib/billing/right-hint";
import { ANALYSIS_PAUSED_MESSAGE, analysisPaused } from "@/lib/analysis/pause";
import { extractDeal, extractDealFromImage, extractDealFromPdf, type ExtractResult } from "@/lib/llm/extract";
import { classifyModelError, modelFailureMessage, rightNotUsed, UNREADABLE_OFFER_MESSAGE } from "@/lib/llm/errors";
import { PROMPT_VERSION } from "@/lib/llm/prompt";
import { preferredTier } from "@/lib/rates/tier-preference";
import { ANON_COOKIE, anonCookieHeader, clientIp, hashIp, newAnonToken, readCookie, sameToken } from "@/lib/security/request";
import { limitRule, limitVerdict } from "@/lib/security/limite";
import { hitUsageGuard, releaseUsageGuard } from "@/lib/security/usage-guard";
import { isStoragePath, sniffMime } from "@/lib/storage/documents";
import { inspectPdf } from "@/lib/storage/pdf";
import {
  deleteRows,
  downloadDocument,
  insertRow,
  isMissingColumn,
  removeDocument,
  selectRows,
  SupabaseConfigError,
  SupabaseRequestError,
  updateRows,
} from "@/lib/supabase/server";
import { MAX_FILE_BYTES } from "@/lib/upload";
import { parseAttribution, recordProductEvent } from "@/lib/analytics/first-party";
import { withEnvironment } from "@/lib/telemetry/tagged";

export const runtime = "nodejs";
export const maxDuration = 120;

const MIN_TEXT_LENGTH = 20;

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type DocumentRow = {
  id: string;
  mime: string;
  bytes: number;
  deal: { id: string; anon_token: string | null; user_id: string | null; status: string };
};

function json(status: number, body: Record<string, unknown>, ...cookies: Array<string | null>) {
  const headers = new Headers();
  for (const cookie of cookies) if (cookie) headers.append("Set-Cookie", cookie);
  return Response.json(body, { status, headers });
}

function canUseDeal(deal: DocumentRow["deal"], user: SessionUser | null, anonToken: string | null): boolean {
  if (deal.user_id !== null) return user !== null && deal.user_id === user.id;
  return sameToken(deal.anon_token, anonToken);
}

async function findDocument(storagePath: string, user: SessionUser | null, anonToken: string | null): Promise<DocumentRow> {
  const rows = await selectRows<DocumentRow>(
    "deal_documents",
    `select=id,mime,bytes,deal:deals!inner(id,anon_token,user_id,status)&storage_path=eq.${encodeURIComponent(storagePath)}&limit=1`,
  );
  const row = rows[0];
  // Même réponse que le document existe ou non : rien à apprendre en sondant.
  if (!row || !canUseDeal(row.deal, user, anonToken)) {
    throw new HttpError(404, "Fichier introuvable. Dépose-le à nouveau.");
  }
  return row;
}

// Fichier relu dans le stockage et vérifié octet par octet.
async function readDocument(storagePath: string, row: DocumentRow): Promise<Uint8Array> {
  let bytes: Uint8Array;
  try {
    bytes = await downloadDocument(storagePath);
  } catch (caught) {
    if (caught instanceof SupabaseRequestError && (caught.status === 400 || caught.status === 404)) {
      throw new HttpError(404, "Le fichier n'est pas arrivé. Dépose-le à nouveau.");
    }
    throw caught;
  }
  if (bytes.byteLength > MAX_FILE_BYTES || bytes.byteLength !== row.bytes || sniffMime(bytes) !== row.mime) {
    await removeDocument(storagePath);
    await updateRows("deals", `id=eq.${row.deal.id}`, { status: "rejected" });
    throw new HttpError(400, "Ce fichier ne correspond pas à ce qui a été annoncé. Dépose-le à nouveau.");
  }
  return bytes;
}

export async function POST(request: Request) {
  const existingToken = readCookie(request, ANON_COOKIE);
  // Mission #089 — authentification injoignable : on ne sait pas si c'est une
  // abonnée ou une visiteuse. On s'arrête avant tout : aucun jeton anonyme
  // tiré ni posé (rien n'est rattaché au navigateur), rien de réservé ni de
  // compté, même message que toute autre panne de la route.
  const session = await getRequestSession(request);
  if (session.kind === "unavailable") {
    logAuthUnavailable("analyse");
    return json(503, { error: modelFailureMessage("unavailable", null), reason: "service_unavailable" });
  }
  const user = session.kind === "valid" ? session.user : null;
  // Un compte connecté n'a pas besoin de jeton anonyme.
  const anonToken = user ? null : (existingToken ?? newAnonToken());
  const cookie = !user && !existingToken && anonToken ? anonCookieHeader(anonToken) : null;
  const fail = (status: number, message: string, extra: Record<string, unknown> = {}) =>
    json(status, { error: message, ...extra }, cookie);
  // Visiteur sans compte dont l'analyse gratuite est prise (décomptée ou refusée) :
  // le formulaire le dira avant la prochaine saisie (lib/billing/right-hint.ts).
  const noFreeLeftHint = user ? null : rightHintCookieHeader(process.env.NODE_ENV === "production");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(400, "Requête illisible. Recharge la page et réessaie.");
  }
  const {
    text,
    storagePath,
    retryOf,
    idempotencyKey,
    attribution: rawAttribution,
    doNotTrack,
  } = (typeof body === "object" && body !== null ? body : {}) as {
    text?: unknown;
    storagePath?: unknown;
    // Relance gratuite d'une analyse incomplète : identifiant de l'analyse d'origine.
    retryOf?: unknown;
    // Clé tirée par le navigateur avant l'envoi (mission #060).
    idempotencyKey?: unknown;
    attribution?: unknown;
    // Mission #108, B4 — le navigateur demande à ne pas être suivi. Lu en
    // booléen strict : tout le reste vaut « non demandé ». Ce drapeau ne peut
    // que RETIRER de la mesure, jamais en ajouter.
    doNotTrack?: unknown;
  };
  const key = readIdempotencyKey(idempotencyKey);
  const attribution = parseAttribution(rawAttribution);

  // Mission #108, partie B — les deux événements d'une analyse sont appariés.
  //
  // Avant : le lancement portait la clé d'idempotence du navigateur, la fin
  // portait l'identifiant de l'analyse. Deux identifiants différents, aucun
  // lien possible entre les deux bouts — et surtout, deux analyses lancées
  // avec la MÊME clé (elle vit une heure dans le navigateur) écrasaient leur
  // lancement par déduplication, alors que chaque fin restait comptée. D'où
  // plus de terminées que de lancées, ce qui est impossible.
  //
  // Désormais un seul identifiant, tiré ici, au début de la requête qui
  // exécute l'analyse : il n'existe que pour ce passage, il est porté par les
  // deux événements, et il sert de clé de déduplication à chacun. Un rejeu
  // idempotent sort avant d'en tirer un ; une reprise ne passe pas par ici.
  const runId = crypto.randomUUID();
  // Le navigateur a demandé à ne pas être suivi : ni lancement, ni fin. La
  // symétrie tient donc aussi dans ce cas.
  const tracks = doNotTrack !== true;
  const runEvent = (
    event: "analysis_started" | "analysis_completed",
    metadata: Record<string, string | number | boolean | null>,
  ) =>
    tracks
      ? recordProductEvent({
          event,
          userId: user?.id ?? null,
          attribution,
          entityType: "analysis_run",
          entityId: runId,
          metadata,
          dedupeKey: `${event}:${runId}`,
        })
      : Promise.resolve();

  const fileMode = typeof storagePath === "string";
  const retryMode = retryOf !== undefined && retryOf !== null;
  if (retryMode && fileMode) {
    return fail(400, "La relance se fait en collant le texte de l'offre complétée.");
  }
  if (fileMode && !isStoragePath(storagePath)) {
    return fail(400, "Fichier introuvable. Dépose-le à nouveau.");
  }
  if (!fileMode && (typeof text !== "string" || text.trim().length < MIN_TEXT_LENGTH)) {
    return fail(400, "Colle au moins 20 caractères du message de la marque.");
  }

  if (analysisPaused()) {
    // Interrupteur ANALYSIS_PAUSED : rien n'est compté, rien n'est appelé.
    return fail(503, ANALYSIS_PAUSED_MESSAGE, { reason: "paused" });
  }

  const ip = clientIp(request);
  // Haché DANS le filet (mission #088) : sans sel serveur, hashIp lève une
  // erreur qui, ici, donnait une réponse vide.
  let hourlyKey: string | null = null;
  // Clé écrite sur le deal à l'enregistrement, sauf si elle appartient déjà à
  // quelqu'un d'autre (voir le rejeu ci-dessous).
  let keyToWrite: string | null = key;
  let grant: Grant | null = null;
  let hourlyCounted = false;
  let document: DocumentRow | null = null;
  let savedDealId: string | null = null;

  // Abandon sans résultat : l'utilisateur retrouve exactement l'état d'avant.
  // Le fichier déposé est supprimé, rien de ce qui a été compté ne reste.
  // Mission #099 — renvoie false si une étape a échoué : l'appelant sait alors
  // que quelque chose est resté en base, et peut le reprendre.
  async function abandon(): Promise<boolean> {
    const steps: Array<() => Promise<unknown>> = [];
    if (document) {
      const dealId = document.deal.id;
      steps.push(() => removeDocument(storagePath as string));
      steps.push(() => updateRows("deals", `id=eq.${dealId}`, { status: "failed" }));
    }
    if (savedDealId) {
      const dealId = savedDealId;
      // Deal enregistré puis décompte refusé : l'analyse part avec lui (cascade).
      steps.push(() => deleteRows("deals", `id=eq.${dealId}`));
    }
    if (grant) {
      const release = grant.release;
      steps.push(() => release());
    }
    if (hourlyCounted && hourlyKey) {
      const guardKey = hourlyKey;
      steps.push(() => releaseUsageGuard(guardKey));
    }
    let ok = true;
    for (const step of steps) {
      await step().catch((error: unknown) => {
        ok = false;
        console.error(
          JSON.stringify({ event: "analyse_abandon_error", detail: error instanceof Error ? error.message.slice(0, 200) : "inconnu" }),
        );
      });
    }
    return ok;
  }

  try {
    // Rejeu (mission #060) : cette demande a déjà été traitée, on rend le même
    // résultat. Avant le filet horaire, avant le droit, avant le modèle : une
    // reprise après coupure réseau ne coûte rien de plus.
    //
    // Mission #088 — DANS le filet : une panne de la base pendant cette
    // vérification (Supabase en 522, le 19/09) donnait une réponse vide. Elle
    // donne maintenant le message lisible du reste de la route (503, « rien
    // n'a été décompté »). Et la route S'ARRÊTE : sans cette vérification, on
    // ne sait pas si la demande a déjà été traitée, et continuer pourrait
    // décompter deux fois la même analyse. Rien n'est réservé ni compté à ce
    // stade : abandon() n'a rien à défaire.
    if (key) {
      const replay = await replayableAnalysis(key, { user, anonToken: existingToken });
      if (replay.kind === "analysis") {
        console.log(JSON.stringify({ event: "analyse_rejouee", signed_in: user !== null }));
        return json(200, { analysisId: replay.analysisId, meta: { replayed: true } }, cookie);
      }
      if (replay.kind === "taken") {
        // Clé déjà employée ailleurs : on ne dit pas par qui, et on ne la réécrit
        // pas. Le navigateur en tirera une neuve à la prochaine tentative.
        keyToWrite = null;
      }
    }

    // Mission #102, partie B — lancer une analyse OUVRE une négociation :
    // c'est cela, et cela seul, que le filet horaire compte. Un compte connecté
    // a son propre compteur : l'activité d'un autre derrière la même adresse
    // (wifi partagé, 4G, entreprise) ne peut plus le bloquer.
    const rule = limitRule("ouverture", { userId: user?.id ?? null, ip });
    hourlyKey = rule ? hashIp(rule.key) : null;
    const guard = hourlyKey && rule ? await hitUsageGuard(hourlyKey, { limit: rule.limit, windowSeconds: rule.windowSeconds }) : null;
    const verdict = limitVerdict(rule, guard);
    if (!verdict.allowed) {
      console.warn(JSON.stringify({ event: "ouverture_freinee", scope: rule?.scope ?? "aucun", signed_in: user !== null }));
      return fail(429, verdict.message, { reason: "rate_limited" });
    }
    hourlyCounted = verdict.counted;

    if (fileMode) {
      document = await findDocument(storagePath, user, existingToken);
    }

    // Droit d'analyser VÉRIFIÉ avant tout appel au modèle. Il ne sera décompté
    // qu'après l'enregistrement d'une analyse valide (grant.commit).
    // Relance d'une analyse incomplète (lib/analysis/retry.ts) : aucun droit
    // réservé ni décompté. La relance est réservée sur l'analyse d'origine, et
    // la réservation est levée par abandon() si l'analyse n'aboutit pas.
    let retry: RetryClaim | null = null;
    if (retryMode) {
      const claim = await claimRetry(retryOf, { user, anonToken: existingToken });
      if (!claim.ok) return fail(claim.status, claim.message, { reason: claim.reason });
      retry = claim;
    }
    const entitlement: Grant | Denial = retry
      ? { allowed: true, plan: "retry", commit: async () => true, release: retry.release }
      : await reserveAnalysis({ user, anonToken: existingToken, commitAnonToken: anonToken, ip });
    if (!entitlement.allowed) {
      if (document) {
        // Pas de droit : le fichier déposé n'est pas conservé.
        await removeDocument(storagePath as string);
        await updateRows("deals", `id=eq.${document.deal.id}`, { status: "denied" });
      }
      // Filet anti-script : ce n'est pas un paywall, et le message ne dit pas
      // au visiteur qu'il a déjà consommé quelque chose.
      const limited = entitlement.reason === "rate_limited";
      if (!limited) {
        return json(402, { error: entitlement.message, paywall: true, reason: entitlement.reason }, cookie, noFreeLeftHint);
      }
      return fail(429, entitlement.message, { reason: entitlement.reason });
    }
    grant = entitlement;

    await runEvent("analysis_started", { source: fileMode ? "file" : "text", retry: retryMode });

    const extraAssumptions: string[] = [];
    let result: ExtractResult;
    let rawText: string | null = null;
    let pdfPages: number | null = null;
    const source = document?.mime === "application/pdf" ? "pdf" : document ? "image" : "text";

    try {
      if (document?.mime === "application/pdf") {
        const bytes = await readDocument(storagePath as string, document);
        // Taille, pages, protection : refusé avant tout appel au modèle.
        const check = inspectPdf(bytes);
        if (!check.ok) {
          console.warn(JSON.stringify({ event: "pdf_refused", reason: check.reason, bytes: bytes.byteLength }));
          throw new HttpError(400, `${check.message} ${rightNotUsed(entitlement.plan)}.`);
        }
        pdfPages = check.pages;
        result = await extractDealFromPdf({ base64: Buffer.from(bytes).toString("base64"), filename: "offre.pdf" });
      } else if (document) {
        const bytes = await readDocument(storagePath as string, document);
        result = await extractDealFromImage({ base64: Buffer.from(bytes).toString("base64"), mimeType: document.mime });
      } else {
        rawText = (text as string).trim();
        if (rawText.length > MAX_TEXT_LENGTH) {
          rawText = rawText.slice(0, MAX_TEXT_LENGTH);
          extraAssumptions.push(TEXT_TRUNCATED_NOTE);
        }
        result = await extractDeal(rawText);
      }
    } catch (caught) {
      const failure = classifyModelError(caught);
      if (!failure) throw caught;
      await abandon();
      // Une cause, un événement. Ni texte d'offre, ni clé : fournisseur, statut, type.
      console.error(
        JSON.stringify({
          event: failure.event,
          provider: failure.provider,
          status: failure.status,
          error_type: failure.errorType,
          source,
          plan: entitlement.plan,
          signed_in: user !== null,
        }),
      );
      return fail(failure.kind === "timeout" ? 504 : failure.event === "analyse_failed_invalid_output" ? 502 : 503, modelFailureMessage(failure.kind, entitlement.plan), {
        reason: failure.kind === "timeout" ? "model_timeout" : "model_unavailable",
      });
    }

    // Niveau mémorisé (compte, sinon cookie du navigateur, sinon défaut de la table) :
    // l'analyse est calculée et enregistrée à ce niveau, modifiable ensuite sur la page de résultat.
    const tier = await preferredTier(request, user);
    let analysis = composeAnalysis(result.extraction, { extraAssumptions, tier });

    // Mission #115, A3 — le message doit porter ce que l'analyse a établi. Il
    // est déjà complété de façon déterministe par composeAnalysis ; avant d'en
    // arriver là, on laisse UNE chance au modèle d'écrire lui-même un message
    // complet, ce qui se lit toujours mieux qu'un ajout mécanique.
    //
    // Ce second appel ne réanalyse rien : il reçoit les points et la langue,
    // jamais le texte de l'offre. La fourchette, le score et les points ne
    // peuvent donc pas bouger entre les deux versions.
    if (needsRewrite(result.extraction, analysis)) {
      try {
        const rewritten = await rewriteMessage(analysis);
        const second = composeAnalysis(
          { ...result.extraction, ready_to_send_message: { ...result.extraction.ready_to_send_message, text: rewritten.text } },
          { extraAssumptions, tier },
        );
        console.log(
          JSON.stringify({
            event: "message_reecrit",
            manquants_avant: messageCoverage(analysis, analysis.ready_to_send_message.text).uncovered.length,
            complete_apres: messageCoverage(second, rewritten.text).ok,
            cost_eur: Number(rewritten.usage.costEur.toFixed(6)),
          }),
        );
        analysis = second;
      } catch (caught) {
        // Seconde tentative impossible : le complément déterministe de
        // composeAnalysis a déjà fait le travail, l'analyse part telle quelle.
        console.warn(
          JSON.stringify({ event: "message_reecriture_impossible", detail: caught instanceof Error ? caught.message.slice(0, 200) : "inconnu" }),
        );
      }
    }

    // Offre illisible : le modèle n'a rien pu lire d'exploitable. Ce n'est pas
    // un résultat : rien n'est enregistré ni décompté, et on dit quoi faire.
    if (result.extraction.input_quality.readable === false && analysis.evaluability === "incomplete") {
      await abandon();
      console.warn(JSON.stringify({ event: "analyse_unreadable", source, plan: entitlement.plan }));
      return fail(422, `${UNREADABLE_OFFER_MESSAGE[source]} ${rightNotUsed(entitlement.plan)}.`, { reason: "unreadable" });
    }

    // Relance : elle vaut pour la même offre. Une autre marque que celle de
    // l'analyse d'origine n'est pas facturée, mais pas rendue non plus : la
    // relance reste disponible, et la personne lance une analyse normale.
    if (retry && !sameOffer(retry.originalBrand, analysis.deal.brand)) {
      await abandon();
      console.warn(JSON.stringify({ event: "analyse_retry_different_offer" }));
      return fail(422, `${RETRY_MESSAGES.different_offer} ${rightNotUsed(entitlement.plan)}.`, { reason: "retry_different_offer" });
    }

    // La clé d'idempotence est écrite avec le deal. Deux cas la font sauter
    // sans rien casser : la migration 019 pas encore appliquée (colonne
    // absente), et une clé prise entre-temps par une autre demande (index
    // unique). L'analyse, elle, est enregistrée dans tous les cas.
    async function withKey<T>(write: (extra: Record<string, unknown>) => Promise<T>): Promise<T> {
      if (!keyToWrite) return write({});
      try {
        return await write({ idempotency_key: keyToWrite });
      } catch (caught) {
        const duplicate = caught instanceof SupabaseRequestError && caught.code === "23505";
        if (!duplicate && !isMissingColumn(caught)) throw caught;
        console.warn(JSON.stringify({ event: "idempotency_ecriture_ignoree", reason: duplicate ? "cle_prise" : "colonne_absente" }));
        keyToWrite = null;
        return write({});
      }
    }

    let dealId: string;
    if (document) {
      dealId = document.deal.id;
      await withKey((extra) =>
        updateRows("deals", `id=eq.${dealId}`, { status: "analysed", ...(user ? { user_id: user.id } : {}), ...extra }),
      );
    } else {
      // Mission #103 : d'où vient ce dossier. Le cockpit ne compte que la production.
      const deal = await withKey((extra) =>
        withEnvironment((environment) =>
          insertRow<{ id: string }>("deals", {
            ...environment,
            user_id: user?.id ?? null,
            anon_token: anonToken,
            source_type: "text",
            raw_text: rawText,
            status: "analysed",
            ...extra,
          }),
        ),
      );
      dealId = deal.id;
      savedDealId = dealId;
    }
    const saved = await withEnvironment((environment) =>
      insertRow<{ id: string }>("analyses", {
        ...environment,
        deal_id: dealId,
        model: result.model,
        prompt_version: PROMPT_VERSION,
        rate_table_version: analysis.estimate.rate_table_version,
        payload: analysis,
        score: analysis.score?.value ?? null,
        confidence: analysis.confidence,
        cost_cents: Number((result.costEur * 100).toFixed(4)),
        latency_ms: result.latencyMs,
        // Colonnes de la migration 018, écrites seulement pour une relance : une
        // analyse normale s'enregistre même si la migration n'est pas appliquée.
        ...(retry ? { retry_of: retry.originalId, is_retry: true } : {}),
      }),
    );
    if (document) savedDealId = dealId;

    // Analyse valide et enregistrée : le droit est décompté MAINTENANT, jamais avant.
    if (!(await grant.commit())) {
      // Le dernier droit a été pris entre-temps par une autre analyse : celle-ci
      // est retirée, et l'utilisateur est prévenu comme s'il n'avait plus de droit.
      const undone = await abandon();
      console.warn(JSON.stringify({ event: "analyse_commit_refused", plan: entitlement.plan }));
      // Mission #099 (audit A1) — la suppression a échoué : l'analyse est
      // restée, visible, sans avoir été décomptée. On le dit, et on la confie
      // au rattrapage quotidien plutôt que de la laisser derrière nous.
      if (!undone) {
        console.error(
          JSON.stringify({
            event: "analyse_non_decomptee",
            analysis_id: saved.id,
            deal_id: dealId,
            user_id: user?.id ?? null,
            plan: entitlement.plan,
          }),
        );
        await recordPendingDebit({
          analysis_id: saved.id,
          deal_id: dealId,
          user_id: user?.id ?? null,
          anon_token: user ? null : anonToken,
          plan: entitlement.plan,
        }).catch((error: unknown) =>
          console.error(
            JSON.stringify({
              event: "analyse_non_decomptee_non_enregistree",
              analysis_id: saved.id,
              detail: error instanceof Error ? error.message.slice(0, 200) : "inconnu",
            }),
          ),
        );
      }
      return json(
        402,
        {
          error: user ? "Tu n'as plus de négociation disponible. Choisis une formule pour continuer." : NO_FREE_LEFT_MESSAGE,
          paywall: true,
          reason: user ? "no_credit" : "free_used",
        },
        cookie,
        noFreeLeftHint,
      );
    }
    grant = null;
    savedDealId = null;
    document = null;
    hourlyCounted = false;

    // L'identifiant de l'analyse reste lisible dans les métadonnées : c'est
    // l'identifiant de PASSAGE qui apparie les deux événements.
    await runEvent("analysis_completed", { source, plan: entitlement.plan, retry: retry !== null, analysis_id: saved.id });

    console.log(
      JSON.stringify({
        event: "analyse",
        source,
        pdf_pages: pdfPages,
        plan: entitlement.plan,
        signed_in: user !== null,
        retry: retry !== null,
        model: result.model,
        input_tokens: result.inputTokens,
        output_tokens: result.outputTokens,
        cost_eur: Number(result.costEur.toFixed(6)),
        latency_ms: result.latencyMs,
        schema_valid_first_try: result.schemaValidFirstTry,
        attempts: result.attempts,
        usage_count: guard?.count ?? 0,
      }),
    );
    // Métadonnées de mesure : aucune donnée du deal, seulement des repères.
    return json(
      200,
      {
        analysisId: saved.id,
        meta: {
          latency_ms: result.latencyMs,
          confidence: analysis.confidence,
          // Sans verdict, la bande est remplacée par l'état : « unpriced » ou « incomplete ».
          score_band: analysis.score?.band ?? analysis.evaluability,
          has_price: analysis.deal.payment.amount_eur !== null,
          retry: retry !== null,
        },
      },
      cookie,
      // L'analyse gratuite de ce navigateur vient d'être décomptée.
      entitlement.plan === "free" ? noFreeLeftHint : null,
    );
  } catch (caught) {
    const plan = grant?.plan ?? null;
    await abandon();
    if (caught instanceof HttpError) return fail(caught.status, caught.message);
    if (caught instanceof SupabaseConfigError || caught instanceof SupabaseRequestError) {
      console.error(JSON.stringify({ event: "analyse_failed_database", detail: caught.message.slice(0, 300) }));
      return fail(503, modelFailureMessage("unavailable", plan), { reason: "service_unavailable" });
    }
    console.error(
      JSON.stringify({
        event: "analyse_failed_unexpected",
        detail: caught instanceof Error ? caught.message.slice(0, 300) : "inconnu",
      }),
    );
    return fail(500, modelFailureMessage("unavailable", plan), { reason: "service_unavailable" });
  }
}
