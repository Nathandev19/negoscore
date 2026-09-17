import { loadResultForViewer } from "@/lib/analysis/load";
import { getRequestUser } from "@/lib/auth/request-user";
import { SHARE_CARD_FILENAME, shareCardAvailable } from "@/lib/share-card/element";
import { renderShareCard } from "@/lib/share-card/render";
import { ANON_COOKIE, readCookie } from "@/lib/security/request";

export const runtime = "nodejs";

function notFound() {
  return new Response("Analyse introuvable.", { status: 404, headers: { "Cache-Control": "no-store" } });
}

// Carte partageable d'une analyse, téléchargée par « Enregistrer la carte ».
// Réservée à la personne qui a lancé l'analyse : mêmes règles que la page de
// résultat et la suppression (session pour une analyse rattachée à un compte,
// cookie anonyme sinon). Connaître l'identifiant ne suffit pas.
export async function GET(request: Request, { params }: RouteContext<"/analyse/resultat/[id]/carte">) {
  const { id } = await params;
  const user = await getRequestUser(request);
  const anonToken = readCookie(request, ANON_COOKIE);
  const result = await loadResultForViewer(id, { user, anonToken });
  if (!result || !shareCardAvailable(result.analysis)) return notFound();

  return renderShareCard(result.analysis, {
    "Content-Disposition": `attachment; filename="${SHARE_CARD_FILENAME}"`,
    // Image propre à son propriétaire : jamais mise en cache partagé.
    "Cache-Control": "private, no-store",
  });
}
