"use server";

import { POST as feedbackRoute } from "@/app/api/analyses/[id]/avis/route";
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
