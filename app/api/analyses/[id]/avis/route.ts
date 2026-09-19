import { feedbackInputSchema, saveFeedback } from "@/lib/analysis/feedback";
import { loadResultForViewer } from "@/lib/analysis/load";
import { judgedFigures } from "@/lib/analysis/judged";
import { getRequestUser } from "@/lib/auth/request-user";
import { loadThread } from "@/lib/negotiation/store";
import { ANON_COOKIE, readCookie } from "@/lib/security/request";

export const runtime = "nodejs";

const UNAVAILABLE = "Ton avis n'a pas pu être enregistré pour le moment. Réessaie plus tard.";

function json(status: number, body: Record<string, unknown>) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

// Avis sur l'estimation : réservé à la personne qui a lancé l'analyse, mêmes
// règles que la page de résultat et la suppression. Une réponse par analyse,
// remplacée à chaque envoi.
export async function POST(request: Request, { params }: RouteContext<"/api/analyses/[id]/avis">) {
  const { id } = await params;
  const user = await getRequestUser(request);
  const anonToken = readCookie(request, ANON_COOKIE);

  const body = await request.json().catch(() => null);
  const input = feedbackInputSchema.safeParse(body);
  if (!input.success) return json(400, { error: "Choisis une réponse (200 caractères au plus pour le commentaire). Recharge la page si le problème continue." });

  try {
    const result = await loadResultForViewer(id, { user, anonToken });
    // Inexistante ou appartenant à quelqu'un d'autre : même réponse.
    if (!result) return json(404, { error: "Analyse introuvable." });
    // Chiffres recalculés ici au niveau et pour le tour envoyés, jamais repris
    // du navigateur (mission #086) : ceux que la page affichait. Le fil n'est
    // lu que là où la page l'affiche (propriétaire connecté).
    const thread = input.data.turn > 0 && result.unlocked && user ? await loadThread(id) : null;
    const judged = judgedFigures(result.analysis, input.data.tier, thread === "missing" ? null : thread, input.data.turn);
    if (!judged) return json(409, { error: "Cette page n'est plus à jour : recharge-la, puis donne ton avis sur les chiffres affichés." });
    const shown = judged.analysis;
    const outcome = await saveFeedback(id, shown, input.data, judged.turn);
    if (outcome === "missing") return json(503, { error: UNAVAILABLE });
    console.log(JSON.stringify({ event: "analysis_feedback_saved", rating: input.data.rating, tier: shown.profile_tier, turn: judged.turn, has_comment: input.data.comment !== null }));
    return json(200, { ok: true });
  } catch (caught) {
    console.error(
      JSON.stringify({ event: "analysis_feedback_error", detail: caught instanceof Error ? caught.message.slice(0, 200) : "inconnu" }),
    );
    return json(503, { error: UNAVAILABLE });
  }
}
