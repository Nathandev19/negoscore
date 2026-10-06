import { parseAttribution, recordProductEvent } from "@/lib/analytics/first-party";
import { isRobot, refusesTracking } from "@/lib/analytics/robots";
import { shortPathAttribution } from "@/lib/acquisition/chemins";
import { normalizeReferrer } from "@/lib/analytics/referrer";
import { analysisOriginFor, eventForPage, INTERNAL_ORIGIN_PARAM, originPathFor } from "@/lib/analytics/views";

export const runtime = "nodejs";
// La vue est enregistrée à chaque chargement : rien ici n'est mis en cache, ni
// par Next, ni par le réseau, ni par le navigateur (voir HEADERS).
export const dynamic = "force-dynamic";

// Mission #120 — l'image d'un pixel qui enregistre une vue, sans JavaScript.
//
// Les pages mesurées (lib/analytics/views.ts) sont lues aussi par
// des gens venus d'un moteur de recherche. Mesurer dans le navigateur laisserait
// dehors ceux qui n'ont pas JavaScript — exactement la garantie #074 qu'on
// tient par ailleurs. C'est donc le serveur qui compte, quand le navigateur
// demande l'image.
//
// LA RÉPONSE EST TOUJOURS LA MÊME IMAGE, quoi qu'il arrive : page inconnue,
// robot, refus de suivi, écriture impossible. Rien dans la réponse ne dit au
// client ce qui a été fait de sa requête — même règle que /api/events depuis la
// mission #103. Et l'en-tête X-Robots-Tag de next.config.ts couvre déjà
// /api/:path*, donc cette adresse n'est jamais indexée.

// GIF transparent de 1×1, 43 octets, écrit ici plutôt que lu sur le disque :
// aucun fichier à embarquer dans le déploiement.
const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

const HEADERS = {
  "Content-Type": "image/gif",
  // Sans ceci le navigateur garderait l'image et la deuxième visite ne serait
  // jamais comptée.
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  Pragma: "no-cache",
  "Content-Length": String(PIXEL.length),
};

const image = () => new Response(new Uint8Array(PIXEL), { status: 200, headers: HEADERS });

// L'adresse de la page qui a demandé l'image, et seulement si elle est du même
// site. C'est de là que viennent les UTM et l'origine `?de=` : le navigateur
// envoie l'adresse complète pour une ressource de même origine.
function referringPage(request: Request): URL | null {
  const referer = request.headers.get("referer");
  if (!referer) return null;
  try {
    const url = new URL(referer);
    return url.origin === new URL(request.url).origin ? url : null;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const page = params.get("p");
  const event = eventForPage(page);
  if (!event) return image();

  // Une image demandée par autre chose qu'un chargement de page : ce n'est pas
  // une vue. Les en-têtes Sec-Fetch- sont absents sur les navigateurs anciens,
  // et on ne punit pas leur absence.
  const dest = request.headers.get("sec-fetch-dest");
  const site = request.headers.get("sec-fetch-site");
  if ((dest && dest !== "image") || (site && site !== "same-origin")) return image();

  if (refusesTracking(request.headers)) return image();
  if (isRobot(request.headers.get("user-agent"))) return image();

  // Mission #136 — UNE VUE N'EST ENREGISTRÉE QUE SI LA PAGE EST AFFICHÉE.
  //
  // Le pixel partait sur un PRÉCHARGEMENT : React 19 émet une consigne de
  // préchargement d'image pour toute image rendue côté serveur, Next l'embarque
  // dans la charge RSC, et le navigateur l'applique au document COURANT quand
  // il précharge un guide depuis le pied de page. Trois vues par arrivée sur
  // l'accueil, sur des guides que personne n'avait ouverts.
  //
  // Le composant n'émet plus d'image préchargeable (components/analytics/
  // view-pixel.tsx). Cette garde-ci est la seconde barrière, et elle est la
  // seule que le navigateur ne peut pas contourner : l'adresse de la page qui
  // demande le pixel doit être CELLE QU'IL DÉCLARE. Un préchargement depuis
  // l'accueil porte le référent de l'accueil : il ne correspond pas, il ne
  // compte pas.
  //
  // Référent absent : on n'enregistre plus. C'est un choix, et il coûte
  // quelque chose — un navigateur configuré pour ne jamais envoyer de référent
  // ne sera plus compté. Entre un trou connu et un chiffre faux, on prend le
  // trou : la mission #129 a déjà montré ce que coûte un nombre auquel on ne
  // peut pas se fier.
  const from = referringPage(request);
  // Mission #137 — /exemple sert le contenu de /analyse/demo sans redirection.
  // La page affichée est donc bien celle que le pixel déclare, même si
  // l'adresse du navigateur est différente, et son attribution vient de la
  // table des chemins courts plutôt que de paramètres d'adresse.
  const court = from ? shortPathAttribution(from.pathname) : null;
  const affichee = court ? court.to : from?.pathname;
  if (!from || affichee !== page) return image();
  const query = from.searchParams;
  const originKey = query.get(INTERNAL_ORIGIN_PARAM);
  const origin = event === "example_view" ? originPathFor(originKey)
    : event === "analysis_page_view" ? analysisOriginFor(originKey) : undefined;

  await recordProductEvent({
    event,
    attribution: parseAttribution({
      path: page,
      // `referer` est la page qui demande le pixel, pas la page qui lui a
      // envoyé le visiteur. Seul le navigateur peut transmettre ce domaine.
      referrer_host: params.has("r") ? normalizeReferrer(params.get("r"), new URL(request.url).hostname) : null,
      utm_source: court ? court.utm_source : query.get("utm_source"),
      utm_medium: court ? court.utm_medium : query.get("utm_medium"),
      utm_campaign: court ? court.utm_campaign : query.get("utm_campaign"),
      utm_content: court ? court.utm_content : query.get("utm_content"),
    }),
    // D'où vient le clic vers l'exemple ou l'analyse. `null` = arrivée directe,
    // et c'est une information, pas un trou.
    entityType: event === "example_view" || event === "analysis_page_view" ? "origine" : null,
    entityId: origin ?? null,
  });
  return image();
}
