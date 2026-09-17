import { composeAnalysis } from "@/lib/analysis/compose";
import type { SessionUser } from "@/lib/auth/session";
import { getRequestUser } from "@/lib/auth/request-user";
import { reserveAnalysis, type Grant } from "@/lib/billing/entitlement";
import { ANALYSIS_PAUSED_MESSAGE, analysisPaused } from "@/lib/analysis/pause";
import { extractDeal, extractDealFromImage, extractDealFromPdf, type ExtractResult } from "@/lib/llm/extract";
import { classifyModelError, modelFailureMessage, rightNotUsed, UNREADABLE_OFFER_MESSAGE } from "@/lib/llm/errors";
import { PROMPT_VERSION } from "@/lib/llm/prompt";
import { ANON_COOKIE, anonCookieHeader, clientIp, hashIp, newAnonToken, readCookie, sameToken } from "@/lib/security/request";
import { hitUsageGuard, releaseUsageGuard } from "@/lib/security/usage-guard";
import { isStoragePath, sniffMime } from "@/lib/storage/documents";
import { inspectPdf } from "@/lib/storage/pdf";
import {
  deleteRows,
  downloadDocument,
  insertRow,
  removeDocument,
  selectRows,
  SupabaseConfigError,
  SupabaseRequestError,
  updateRows,
} from "@/lib/supabase/server";
import { MAX_FILE_BYTES } from "@/lib/upload";

export const runtime = "nodejs";
export const maxDuration = 120;

const MIN_TEXT_LENGTH = 20;
const MAX_TEXT_LENGTH = 60_000;

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

function json(status: number, body: Record<string, unknown>, cookie: string | null) {
  const headers = new Headers();
  if (cookie) headers.append("Set-Cookie", cookie);
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
  const user = await getRequestUser(request);
  // Un compte connecté n'a pas besoin de jeton anonyme.
  const anonToken = user ? null : (existingToken ?? newAnonToken());
  const cookie = !user && !existingToken && anonToken ? anonCookieHeader(anonToken) : null;
  const fail = (status: number, message: string, extra: Record<string, unknown> = {}) =>
    json(status, { error: message, ...extra }, cookie);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(400, "Requête illisible. Recharge la page et réessaie.");
  }
  const { text, storagePath } = (typeof body === "object" && body !== null ? body : {}) as {
    text?: unknown;
    storagePath?: unknown;
  };

  const fileMode = typeof storagePath === "string";
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
  const hourlyKey = hashIp(ip);
  let grant: Grant | null = null;
  let hourlyCounted = false;
  let document: DocumentRow | null = null;
  let savedDealId: string | null = null;

  // Abandon sans résultat : l'utilisateur retrouve exactement l'état d'avant.
  // Le fichier déposé est supprimé, rien de ce qui a été compté ne reste.
  async function abandon() {
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
    if (hourlyCounted) steps.push(() => releaseUsageGuard(hourlyKey));
    for (const step of steps) {
      await step().catch((error: unknown) =>
        console.error(
          JSON.stringify({ event: "analyse_abandon_error", detail: error instanceof Error ? error.message.slice(0, 200) : "inconnu" }),
        ),
      );
    }
  }

  try {
    const guard = await hitUsageGuard(hourlyKey);
    if (!guard.allowed) {
      return fail(429, `Tu as lancé 5 analyses en une heure. Réessaie dans ${guard.retryInMinutes} min.`);
    }
    hourlyCounted = true;

    if (fileMode) {
      document = await findDocument(storagePath, user, existingToken);
    }

    // Droit d'analyser VÉRIFIÉ avant tout appel au modèle. Il ne sera décompté
    // qu'après l'enregistrement d'une analyse valide (grant.commit).
    const entitlement = await reserveAnalysis({ user, anonToken: existingToken, commitAnonToken: anonToken, ip });
    if (!entitlement.allowed) {
      if (document) {
        // Pas de droit : le fichier déposé n'est pas conservé.
        await removeDocument(storagePath as string);
        await updateRows("deals", `id=eq.${document.deal.id}`, { status: "denied" });
      }
      // Filet anti-script : ce n'est pas un paywall, et le message ne dit pas
      // au visiteur qu'il a déjà consommé quelque chose.
      const limited = entitlement.reason === "rate_limited";
      return fail(limited ? 429 : 402, entitlement.message, {
        ...(limited ? {} : { paywall: true }),
        reason: entitlement.reason,
      });
    }
    grant = entitlement;

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
          extraAssumptions.push("Ton texte dépassait 60 000 caractères : seul le début a été analysé.");
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

    const analysis = composeAnalysis(result.extraction, { extraAssumptions });

    // Offre illisible : le modèle n'a rien pu lire d'exploitable. Ce n'est pas
    // un résultat : rien n'est enregistré ni décompté, et on dit quoi faire.
    if (result.extraction.input_quality.readable === false && analysis.evaluability === "incomplete") {
      await abandon();
      console.warn(JSON.stringify({ event: "analyse_unreadable", source, plan: entitlement.plan }));
      return fail(422, `${UNREADABLE_OFFER_MESSAGE[source]} ${rightNotUsed(entitlement.plan)}.`, { reason: "unreadable" });
    }

    let dealId: string;
    if (document) {
      dealId = document.deal.id;
      await updateRows("deals", `id=eq.${dealId}`, { status: "analysed", ...(user ? { user_id: user.id } : {}) });
    } else {
      const deal = await insertRow<{ id: string }>("deals", {
        user_id: user?.id ?? null,
        anon_token: anonToken,
        source_type: "text",
        raw_text: rawText,
        status: "analysed",
      });
      dealId = deal.id;
      savedDealId = dealId;
    }
    const saved = await insertRow<{ id: string }>("analyses", {
      deal_id: dealId,
      model: result.model,
      prompt_version: PROMPT_VERSION,
      rate_table_version: analysis.estimate.rate_table_version,
      payload: analysis,
      score: analysis.score?.value ?? null,
      confidence: analysis.confidence,
      cost_cents: Number((result.costEur * 100).toFixed(4)),
      latency_ms: result.latencyMs,
    });
    if (document) savedDealId = dealId;

    // Analyse valide et enregistrée : le droit est décompté MAINTENANT, jamais avant.
    if (!(await grant.commit())) {
      // Le dernier droit a été pris entre-temps par une autre analyse : celle-ci
      // est retirée, et l'utilisateur est prévenu comme s'il n'avait plus de droit.
      await abandon();
      console.warn(JSON.stringify({ event: "analyse_commit_refused", plan: entitlement.plan }));
      return fail(402, user ? "Tu n'as plus de crédit. Choisis une offre pour continuer." : "Tu as utilisé ton analyse gratuite. Choisis une offre pour analyser d'autres deals.", {
        paywall: true,
        reason: user ? "no_credit" : "free_used",
      });
    }
    grant = null;
    savedDealId = null;
    document = null;
    hourlyCounted = false;

    console.log(
      JSON.stringify({
        event: "analyse",
        source,
        pdf_pages: pdfPages,
        plan: entitlement.plan,
        signed_in: user !== null,
        model: result.model,
        input_tokens: result.inputTokens,
        output_tokens: result.outputTokens,
        cost_eur: Number(result.costEur.toFixed(6)),
        latency_ms: result.latencyMs,
        schema_valid_first_try: result.schemaValidFirstTry,
        attempts: result.attempts,
        usage_count: guard.count,
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
        },
      },
      cookie,
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
