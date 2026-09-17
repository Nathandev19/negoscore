import OpenAI from "openai";
import { ExtractionError, MissingApiKeyError } from "@/lib/llm/extract";
import { MODEL } from "@/lib/llm/model";

// Classement des échecs du modèle, pour dire la vérité à l'utilisateur et
// journaliser une cause précise. Aucun texte d'offre ni clé n'est conservé :
// seuls le statut HTTP et le type d'erreur renvoyés par le fournisseur.

export type ModelFailureKind = "unavailable" | "timeout";

export type ModelFailure = {
  kind: ModelFailureKind;
  // Événement de journal, un par cause.
  event:
    | "analyse_failed_quota"
    | "analyse_failed_rate_limit"
    | "analyse_failed_auth"
    | "analyse_failed_missing_key"
    | "analyse_failed_provider_error"
    | "analyse_failed_connection"
    | "analyse_failed_timeout"
    | "analyse_failed_invalid_output"
    | "analyse_failed_bad_request";
  provider: string;
  status: number | null;
  errorType: string | null;
};

const PROVIDER = MODEL.envKey === "OPENAI_API_KEY" ? "openai" : "inconnu";

function failure(kind: ModelFailureKind, event: ModelFailure["event"], status: number | null, errorType: string | null): ModelFailure {
  return { kind, event, provider: PROVIDER, status, errorType };
}

// null : l'erreur ne vient pas du modèle (base de données, code, requête).
export function classifyModelError(caught: unknown): ModelFailure | null {
  if (caught instanceof MissingApiKeyError) return failure("unavailable", "analyse_failed_missing_key", null, "missing_api_key");
  if (caught instanceof ExtractionError) return failure("unavailable", "analyse_failed_invalid_output", null, "invalid_output");
  // Délai dépassé : celui du client, ou l'échéance globale de la route.
  if (caught instanceof OpenAI.APIConnectionTimeoutError || caught instanceof OpenAI.APIUserAbortError) {
    return failure("timeout", "analyse_failed_timeout", null, "timeout");
  }
  if (caught instanceof DOMException && (caught.name === "TimeoutError" || caught.name === "AbortError")) {
    return failure("timeout", "analyse_failed_timeout", null, "timeout");
  }
  if (caught instanceof OpenAI.APIConnectionError) return failure("unavailable", "analyse_failed_connection", null, "connection");
  if (caught instanceof OpenAI.APIError) {
    const status = typeof caught.status === "number" ? caught.status : null;
    const errorType = caught.code ?? caught.type ?? null;
    if (status === 429) {
      const quota = errorType === "insufficient_quota" || errorType === "credit_balance_exhausted" || caught.type === "insufficient_quota";
      return failure("unavailable", quota ? "analyse_failed_quota" : "analyse_failed_rate_limit", status, errorType);
    }
    if (status === 401 || status === 403) return failure("unavailable", "analyse_failed_auth", status, errorType);
    if (status === 408 || status === 504) return failure("timeout", "analyse_failed_timeout", status, errorType);
    if (status !== null && status >= 500) return failure("unavailable", "analyse_failed_provider_error", status, errorType);
    // 400, 404, 413, 422… : requête refusée par le fournisseur. C'est notre appel qui est en cause.
    return failure("unavailable", "analyse_failed_bad_request", status, errorType);
  }
  return null;
}

export function rightNotUsed(plan: "free" | "pack" | "pro" | "retry" | null): string {
  if (plan === null) return "Rien n'a été décompté";
  if (plan === "retry") return "Ta relance gratuite n'a pas été utilisée";
  return plan === "free"
    ? "Ton analyse gratuite n'a pas été utilisée"
    : plan === "pro"
      ? "Cette analyse n'a pas été décomptée de ton abonnement"
      : "Ton crédit n'a pas été utilisé";
}

// Messages affichés : jamais de code d'erreur, jamais la faute de l'utilisateur.
export function modelFailureMessage(kind: ModelFailureKind, plan: "free" | "pack" | "pro" | "retry" | null): string {
  const right = rightNotUsed(plan);
  return kind === "timeout"
    ? `L'analyse a pris trop de temps et n'a pas abouti. ${right}, réessaie dans quelques minutes.`
    : `L'analyse est momentanément indisponible. ${right}, réessaie dans quelques minutes.`;
}

export const UNREADABLE_OFFER_MESSAGE = {
  text: "On n'arrive pas à lire une offre dans ce texte. Colle le message complet de la marque, avec les contenus demandés et la rémunération.",
  image: "On n'arrive pas à lire cette image. Envoie une capture plus nette et bien cadrée, ou colle le texte du message.",
  pdf: "On n'arrive pas à lire ce PDF. Fais une capture d'écran de l'offre, ou colle son texte.",
} as const;
