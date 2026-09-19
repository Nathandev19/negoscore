import { loadResultForViewer } from "@/lib/analysis/load";
import { recomputeForDeal, recomputeForTier } from "@/lib/analysis/recompute";
import { getRequestUser } from "@/lib/auth/request-user";
import { currentState } from "@/lib/negotiation/current";
import { loadThread } from "@/lib/negotiation/store";
import { SHARE_CARD_FILENAME, shareCardAvailable } from "@/lib/share-card/element";
import { renderShareCard } from "@/lib/share-card/render";
import { tierFromUrl } from "@/lib/share-card/tier-param";
import { ANON_COOKIE, readCookie } from "@/lib/security/request";

export const runtime = "nodejs";

function unavailable() {
  return new Response("Carte momentanément indisponible.", { status: 503, headers: { "Cache-Control": "no-store" } });
}

function notFound() {
  return new Response("Analyse introuvable.", { status: 404, headers: { "Cache-Control": "no-store" } });
}

// Carte partageable d'une analyse, téléchargée par « Enregistrer la carte ».
// Réservée à la personne qui a lancé l'analyse : mêmes règles que la page de
// résultat et la suppression (session pour une analyse rattachée à un compte,
// cookie anonyme sinon). Connaître l'identifiant ne suffit pas.
// ?niveau= : le niveau affiché sur la page au moment du clic. Les chiffres sont
// recalculés ici par le moteur, jamais repris de l'adresse. Sans paramètre : le
// niveau de l'analyse enregistrée.
export async function GET(request: Request, { params }: RouteContext<"/analyse/resultat/[id]/carte">) {
  const { id } = await params;
  const user = await getRequestUser(request);
  const anonToken = readCookie(request, ANON_COOKIE);
  const result = await loadResultForViewer(id, { user, anonToken });
  if (!result || !shareCardAvailable(result.analysis)) return notFound();

  const tier = tierFromUrl(request.url);
  const atTier = tier ? recomputeForTier(result.analysis, tier) : result.analysis;
  // Mission #084 — après un tour, la carte porte le score et la fourchette des
  // termes ACTUELS, comme la page. Fil illisible : la carte n'est pas créée,
  // plutôt que de montrer les chiffres d'une offre qui a peut-être changé.
  const thread = result.unlocked && user ? await loadThread(id).catch(() => "error" as const) : null;
  if (thread === "error") return unavailable();
  const negotiated = thread && thread !== "missing" ? currentState(thread) : null;
  const analysis = negotiated ? recomputeForDeal(atTier, negotiated.deal) : atTier;
  if (!shareCardAvailable(analysis)) return notFound();
  return renderShareCard(analysis, {
    "Content-Disposition": `attachment; filename="${SHARE_CARD_FILENAME}"`,
    // Image propre à son propriétaire : jamais mise en cache partagé.
    "Cache-Control": "private, no-store",
  });
}
