"use server";

import { POST as feedbackRoute } from "@/app/api/analyses/[id]/avis/route";
import { POST as turnRoute } from "@/app/api/analyses/[id]/tours/route";
import { forwardedJsonRequest } from "@/lib/forms/forward";
import { parseTier } from "@/lib/rates/tier";
import { isUuid } from "@/lib/security/request";

// Actions serveur des formulaires envoyables sans JavaScript (mission #075).
// Chacune transmet le formulaire à la route existante (lib/forms/forward.ts) :
// mêmes protections, même code. Avec JavaScript, ces actions ne servent pas :
// le navigateur intercepte l'envoi et appelle la route lui-même, comme avant.
//
// L'analyse sans JavaScript a été retirée (mission #076) : l'envoi aboutissait,
// mais la page de résultat ne s'affiche pas sans JavaScript (son contenu
// arrive en différé, derrière l'écran de chargement, et c'est un script qui
// l'affiche). Une analyse consommée pour rien à lire : le formulaire d'analyse
// dit désormais qu'il demande JavaScript, et n'envoie rien.

// ─── Réponse de la marque, sans JavaScript (mission #099, audit B15) ─────────
//
// Le formulaire du fil n'avait aucune action serveur : sans JavaScript, il ne
// partait nulle part, et le texte collé était perdu. Il part maintenant vers la
// même route que le bouton, et ce qui revient contient TOUJOURS le texte soumis :
// un refus ne fait plus disparaître ce qu'on vient de coller.

export type TurnWithoutJsState =
  | { status: "idle" }
  | { status: "saved"; reply: "" }
  | { status: "error"; message: string; reply: string };

export async function saveTurnWithoutJs(_previous: TurnWithoutJsState, formData: FormData): Promise<TurnWithoutJsState> {
  const id = String(formData.get("analysisId") ?? "");
  const reply = String(formData.get("reply") ?? "");
  const tier = parseTier(formData.get("tier"));
  const key = String(formData.get("idempotencyKey") ?? "") || undefined;
  if (!isUuid(id) || !tier) {
    return { status: "error", message: "La réponse n'a pas pu être envoyée. Recharge la page et réessaie.", reply };
  }
  try {
    const request = await forwardedJsonRequest(`/api/analyses/${id}/tours`, { reply, tier, ...(key ? { idempotencyKey: key } : {}) });
    const response = await turnRoute(request, { params: Promise.resolve({ id }) });
    if (response.ok) return { status: "saved", reply: "" };
    const body = (await response.json().catch(() => ({}))) as { error?: unknown };
    return {
      status: "error",
      message: typeof body.error === "string" ? body.error : "La réponse n'a pas pu être analysée.",
      reply,
    };
  } catch {
    return { status: "error", message: "La réponse n'a pas pu être envoyée. Réessaie plus tard.", reply };
  }
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
  // Mission #086 : tour dont la page affichait les chiffres (0 par défaut).
  const turn = Number(formData.get("turn") ?? 0) || 0;
  if (!rating) {
    return { status: "error", message: "Choisis une réponse avant d'envoyer.", rating, comment };
  }
  if (!isUuid(id) || !tier) {
    return { status: "error", message: "Ton avis n'a pas pu être enregistré. Recharge la page et réessaie.", rating, comment };
  }
  try {
    const request = await forwardedJsonRequest(`/api/analyses/${id}/avis`, { rating, comment, tier, turn });
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
