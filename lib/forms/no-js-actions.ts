"use server";

import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { POST as analyseRoute } from "@/app/api/analyse/route";
import { POST as feedbackRoute } from "@/app/api/analyses/[id]/avis/route";
import { applySetCookies, forwardedJsonRequest } from "@/lib/forms/forward";
import { parseTier } from "@/lib/rates/tier";
import { clientIp, hashIp, isUuid } from "@/lib/security/request";

// Actions serveur des formulaires envoyables sans JavaScript (mission #075).
// Chacune transmet le formulaire à la route existante (lib/forms/forward.ts) :
// mêmes protections, même code. Avec JavaScript, ces actions ne servent pas :
// le navigateur intercepte l'envoi et appelle la route lui-même, comme avant.

// ─── Analyse d'une offre collée ──────────────────────────────────────────────

export type AnalyseWithoutJsState =
  | { status: "idle" }
  // text : ce que la personne a collé, réaffiché tel quel. Rien n'est perdu.
  | { status: "error"; message: string; text: string; paywall: boolean };

const ANALYSE_FAILED =
  "L'analyse n'a pas abouti. Appuie de nouveau sur « Analyser mon deal » : si elle était déjà partie, tu retrouves ton résultat sans rien payer de plus.";

// Clé d'idempotence (mission #060) sans navigateur pour la tirer : dérivée de
// l'IP hachée, du texte et d'une tranche de 10 minutes. Un envoi répété
// (double clic, « renvoyer le formulaire » du navigateur) retombe sur la même
// clé, donc sur la même analyse, sans rien décompter de plus. La route ne rend
// une analyse existante qu'à son propriétaire : une clé partagée ne livre rien.
export async function noJsIdempotencyKey(text: string, ip: string, now: number = Date.now()): Promise<string> {
  const slot = Math.floor(now / (10 * 60 * 1000));
  return createHash("sha256").update(`sans-js:${hashIp(ip)}:${slot}:${text.trim()}`).digest("base64url");
}

export async function analyseWithoutJs(_previous: AnalyseWithoutJsState, formData: FormData): Promise<AnalyseWithoutJsState> {
  const text = String(formData.get("text") ?? "");
  const ip = clientIp(new Request("http://localhost", { headers: await headers() }));
  let analysisId: string | null = null;
  try {
    const request = await forwardedJsonRequest("/api/analyse", {
      text,
      idempotencyKey: await noJsIdempotencyKey(text, ip),
    });
    const response = await analyseRoute(request);
    await applySetCookies(response);
    const body = (await response.json().catch(() => ({}))) as { analysisId?: unknown; error?: unknown; paywall?: unknown };
    if (response.ok && typeof body.analysisId === "string") {
      analysisId = body.analysisId;
    } else {
      return {
        status: "error",
        message: typeof body.error === "string" ? body.error : ANALYSE_FAILED,
        text,
        paywall: body.paywall === true,
      };
    }
  } catch {
    return { status: "error", message: ANALYSE_FAILED, text, paywall: false };
  }
  // Hors du try : redirect() interrompt l'action en levant une exception.
  redirect(`/analyse/resultat/${analysisId}`);
}

// ─── Avis sur l'estimation ───────────────────────────────────────────────────

export type FeedbackWithoutJsState =
  | { status: "idle" }
  | { status: "saved"; tier: string; rating: string; comment: string }
  | { status: "error"; message: string; rating: string; comment: string };

export async function saveFeedbackWithoutJs(_previous: FeedbackWithoutJsState, formData: FormData): Promise<FeedbackWithoutJsState> {
  const id = String(formData.get("analysisId") ?? "");
  const rating = String(formData.get("rating") ?? "");
  const comment = String(formData.get("comment") ?? "");
  const tier = parseTier(formData.get("tier"));
  if (!rating) {
    return { status: "error", message: "Choisis une réponse avant d'envoyer.", rating, comment };
  }
  if (!isUuid(id) || !tier) {
    return { status: "error", message: "Ton avis n'a pas pu être enregistré. Recharge la page et réessaie.", rating, comment };
  }
  try {
    const request = await forwardedJsonRequest(`/api/analyses/${id}/avis`, { rating, comment, tier });
    const response = await feedbackRoute(request, { params: Promise.resolve({ id }) });
    if (response.ok) return { status: "saved", tier, rating, comment };
    const body = (await response.json().catch(() => ({}))) as { error?: unknown };
    return {
      status: "error",
      message: typeof body.error === "string" ? body.error : "Ton avis n'a pas pu être enregistré.",
      rating,
      comment,
    };
  } catch {
    return { status: "error", message: "Ton avis n'a pas pu être enregistré. Réessaie plus tard.", rating, comment };
  }
}
