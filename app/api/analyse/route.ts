import { composeAnalysis } from "@/lib/analysis/compose";
import { extractDeal, ExtractionError, MissingApiKeyError } from "@/lib/llm/extract";

export const runtime = "nodejs";
export const maxDuration = 120;

const MIN_TEXT_LENGTH = 20;
const MAX_TEXT_LENGTH = 60_000;
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60 * 60 * 1000;

// Rate limiting en mémoire, par instance : 5 analyses par IP et par heure.
const hitsByIp = new Map<string, number[]>();

function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
}

function takeSlot(ip: string, now: number): { allowed: boolean; retryInMinutes: number } {
  const recent = (hitsByIp.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) {
    hitsByIp.set(ip, recent);
    return { allowed: false, retryInMinutes: Math.ceil((RATE_WINDOW_MS - (now - recent[0])) / 60_000) };
  }
  recent.push(now);
  hitsByIp.set(ip, recent);
  return { allowed: true, retryInMinutes: 0 };
}

function error(status: number, message: string) {
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return error(400, "Requête illisible. Recharge la page et réessaie.");
  }
  const { text, storagePath } = (typeof body === "object" && body !== null ? body : {}) as {
    text?: unknown;
    storagePath?: unknown;
  };

  if (typeof storagePath === "string") {
    return error(501, "L'analyse de photo et de PDF arrive bientôt. En attendant, colle le texte du message.");
  }
  if (typeof text !== "string" || text.trim().length < MIN_TEXT_LENGTH) {
    return error(400, "Colle au moins 20 caractères du message de la marque.");
  }

  const slot = takeSlot(clientIp(request), Date.now());
  if (!slot.allowed) {
    return error(429, `Tu as lancé 5 analyses en une heure. Réessaie dans ${slot.retryInMinutes} min.`);
  }

  const extraAssumptions: string[] = [];
  let input = text.trim();
  if (input.length > MAX_TEXT_LENGTH) {
    input = input.slice(0, MAX_TEXT_LENGTH);
    extraAssumptions.push("Ton texte dépassait 60 000 caractères : seul le début a été analysé.");
  }

  try {
    const result = await extractDeal(input);
    const analysis = composeAnalysis(result.extraction, { extraAssumptions });
    console.log(
      JSON.stringify({
        event: "analyse",
        model: result.model,
        input_tokens: result.inputTokens,
        output_tokens: result.outputTokens,
        cost_eur: Number(result.costEur.toFixed(6)),
        latency_ms: result.latencyMs,
        schema_valid_first_try: result.schemaValidFirstTry,
        attempts: result.attempts,
      }),
    );
    return Response.json({ analysis });
  } catch (caught) {
    if (caught instanceof MissingApiKeyError) {
      console.error(JSON.stringify({ event: "analyse_error", reason: "missing_api_key" }));
      return error(503, "Le service d'analyse n'est pas disponible pour le moment. Réessaie plus tard.");
    }
    if (caught instanceof ExtractionError) {
      console.error(JSON.stringify({ event: "analyse_error", reason: "invalid_output", detail: caught.message }));
      return error(502, "On n'a pas réussi à lire cette offre. Réessaie, ou colle un texte plus complet.");
    }
    console.error(
      JSON.stringify({
        event: "analyse_error",
        reason: "unexpected",
        detail: caught instanceof Error ? caught.message.slice(0, 300) : "inconnu",
      }),
    );
    return error(500, "L'analyse n'a pas abouti. Réessaie dans une minute.");
  }
}
