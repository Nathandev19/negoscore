import { composeAnalysis } from "@/lib/analysis/compose";
import {
  extractDeal,
  extractDealFromImage,
  ExtractionError,
  MissingApiKeyError,
  type ExtractResult,
} from "@/lib/llm/extract";
import { PROMPT_VERSION } from "@/lib/llm/prompt";
import { ANON_COOKIE, anonCookieHeader, clientIp, hashIp, newAnonToken, readCookie, sameToken } from "@/lib/security/request";
import { hitUsageGuard } from "@/lib/security/usage-guard";
import { isStoragePath, sniffMime } from "@/lib/storage/documents";
import {
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
  deal: { id: string; anon_token: string | null; status: string };
};

function json(status: number, body: Record<string, unknown>, cookie: string | null) {
  const headers = new Headers();
  if (cookie) headers.append("Set-Cookie", cookie);
  return Response.json(body, { status, headers });
}

// Document déposé par ce même navigateur, vérifié octet par octet.
async function loadDocument(storagePath: string, anonToken: string | null): Promise<{ row: DocumentRow; bytes: Uint8Array }> {
  const rows = await selectRows<DocumentRow>(
    "deal_documents",
    `select=id,mime,bytes,deal:deals!inner(id,anon_token,status)&storage_path=eq.${encodeURIComponent(storagePath)}&limit=1`,
  );
  const row = rows[0];
  // Même réponse que le document existe ou non : rien à apprendre en sondant.
  if (!row || !sameToken(row.deal.anon_token, anonToken)) {
    throw new HttpError(404, "Fichier introuvable. Dépose-le à nouveau.");
  }
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
  return { row, bytes };
}

export async function POST(request: Request) {
  const existingToken = readCookie(request, ANON_COOKIE);
  const anonToken = existingToken ?? newAnonToken();
  const cookie = existingToken ? null : anonCookieHeader(anonToken);
  const fail = (status: number, message: string) => json(status, { error: message }, cookie);

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

  try {
    const guard = await hitUsageGuard(hashIp(clientIp(request)));
    if (!guard.allowed) {
      return fail(429, `Tu as lancé 5 analyses en une heure. Réessaie dans ${guard.retryInMinutes} min.`);
    }

    const extraAssumptions: string[] = [];
    let result: ExtractResult;
    let dealId: string | null = null;
    let rawText: string | null = null;

    if (fileMode) {
      const { row, bytes } = await loadDocument(storagePath, existingToken);
      dealId = row.deal.id;
      if (row.mime === "application/pdf") {
        // Aucune bibliothèque PDF dans le projet : le document est supprimé
        // tout de suite plutôt que conservé sans être analysé.
        await removeDocument(storagePath);
        await updateRows("deals", `id=eq.${dealId}`, { status: "unsupported" });
        return fail(501, "L'analyse de PDF arrive bientôt. En attendant, copie le texte du contrat et colle-le.");
      }
      result = await extractDealFromImage({ base64: Buffer.from(bytes).toString("base64"), mimeType: row.mime });
    } else {
      rawText = (text as string).trim();
      if (rawText.length > MAX_TEXT_LENGTH) {
        rawText = rawText.slice(0, MAX_TEXT_LENGTH);
        extraAssumptions.push("Ton texte dépassait 60 000 caractères : seul le début a été analysé.");
      }
      result = await extractDeal(rawText);
    }

    const analysis = composeAnalysis(result.extraction, { extraAssumptions });

    if (dealId) {
      await updateRows("deals", `id=eq.${dealId}`, { status: "analysed" });
    } else {
      const deal = await insertRow<{ id: string }>("deals", {
        anon_token: anonToken,
        source_type: "text",
        raw_text: rawText,
        status: "analysed",
      });
      dealId = deal.id;
    }
    const saved = await insertRow<{ id: string }>("analyses", {
      deal_id: dealId,
      model: result.model,
      prompt_version: PROMPT_VERSION,
      rate_table_version: analysis.estimate.rate_table_version,
      payload: analysis,
      score: analysis.score.value,
      confidence: analysis.confidence,
      cost_cents: Number((result.costEur * 100).toFixed(4)),
      latency_ms: result.latencyMs,
    });

    console.log(
      JSON.stringify({
        event: "analyse",
        source: fileMode ? "image" : "text",
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
    return json(200, { analysisId: saved.id }, cookie);
  } catch (caught) {
    if (caught instanceof HttpError) return fail(caught.status, caught.message);
    if (caught instanceof MissingApiKeyError) {
      console.error(JSON.stringify({ event: "analyse_error", reason: "missing_api_key" }));
      return fail(503, "Le service d'analyse n'est pas disponible pour le moment. Réessaie plus tard.");
    }
    if (caught instanceof SupabaseConfigError || caught instanceof SupabaseRequestError) {
      console.error(JSON.stringify({ event: "analyse_error", reason: "database", detail: caught.message.slice(0, 300) }));
      return fail(503, "Le service d'analyse n'est pas disponible pour le moment. Réessaie plus tard.");
    }
    if (caught instanceof ExtractionError) {
      console.error(JSON.stringify({ event: "analyse_error", reason: "invalid_output", detail: caught.message }));
      return fail(502, "On n'a pas réussi à lire cette offre. Réessaie, ou envoie un texte plus complet.");
    }
    console.error(
      JSON.stringify({
        event: "analyse_error",
        reason: "unexpected",
        detail: caught instanceof Error ? caught.message.slice(0, 300) : "inconnu",
      }),
    );
    return fail(500, "L'analyse n'a pas abouti. Réessaie dans une minute.");
  }
}
