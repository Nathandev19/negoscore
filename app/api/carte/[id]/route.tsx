import { ImageResponse } from "next/og";
import { getRequestSession, logAuthUnavailable } from "@/lib/auth/request-user";
import { ANON_COOKIE, readCookie } from "@/lib/security/request";
import { loadFonts } from "@/lib/share-card/render";
import { VERDICT_CARD_SIZE, verdictCardAvailable, verdictCardElement } from "@/lib/share-card/verdict-card";
import { carteDuFil, filRowsFor, verdictDataFromRow, verdictRowFor } from "@/lib/share-card/verdict-data";

// Mission #165, reprise par la #169 — LA CARTE DE VERDICT.
//
// Elle a remplacé la carte de la #064, dont elle hérite des trois refus et de
// la nuance de langue. Ce qu'elle ne reprend pas, c'est sa façon de lire : la
// #064 chargeait l'analyse entière et le fil entier, `brand_reply` compris,
// pour recalculer les termes actuels. Cette route ne recalcule RIEN.
//
// LE CHIFFRAGE EST FAIT AILLEURS, à l'écriture du tour, là où le Deal complet
// est tenu légitimement (lib/negotiation/pricing.ts). Ici on projette des
// colonnes nommées — des nombres, des booléens, des clés de listes fermées —
// et on dessine. Le nom de l'annonceur n'entre jamais en mémoire, quel que
// soit l'état de la négociation.
//
// Node, pas Edge : la police est lue sur le disque avec fs (assets/fonts),
// jamais sur un CDN — une image qui part chez quelqu'un d'autre ne doit pas
// dépendre d'un tiers pour exister.
export const runtime = "nodejs";
// Carte propre à une personne : jamais rendue à l'avance, jamais mise en
// cache partagé.
export const dynamic = "force-dynamic";

const SANS_CACHE = { "Cache-Control": "private, no-store" } as const;

// 404 À CORPS VIDE, dans tous les cas où il n'y a pas de carte : pas de
// session ni de cookie, analyse qui n'est pas la sienne, analyse sans verdict,
// tour sans bande, lecture impossible. La réponse ne dit jamais laquelle —
// elle n'a rien à apprendre à qui la sollicite.
function rien(): Response {
  return new Response(null, { status: 404, headers: SANS_CACHE });
}

// 503, et c'est un refus différent : le fil existe mais ne se lit pas. Les
// chiffres d'origine sont peut-être périmés, donc on ne montre rien — mais un
// second essai produira la carte. Refus hérité de la #064.
function indisponible(): Response {
  return new Response(null, { status: 503, headers: SANS_CACHE });
}

function journal(etape: string, erreur: unknown): void {
  console.error(
    JSON.stringify({
      event: "carte_verdict_indisponible",
      etape,
      detail: erreur instanceof Error ? erreur.message.slice(0, 120) : "inconnu",
    }),
  );
}

export async function GET(request: Request, { params }: RouteContext<"/api/carte/[id]">): Promise<Response> {
  const { id } = await params;

  // Mission #089 bis — l'authentification injoignable donnait user = null, et
  // la carte d'une analyse rattachée à un compte devenait introuvable pour sa
  // propre propriétaire. Une panne n'est pas une absence de session.
  const session = await getRequestSession(request);
  if (session.kind === "unavailable") {
    logAuthUnavailable("carte");
    return indisponible();
  }
  const userId = session.kind === "valid" ? session.user.id : null;
  const anonToken = readCookie(request, ANON_COOKIE);
  if (!userId && !anonToken) return rien();

  const row = await verdictRowFor(id, { userId, anonToken }).catch((erreur: unknown) => {
    // Une panne de lecture ne doit pas remonter en 500 : de l'extérieur, une
    // carte qu'on ne peut pas produire et une carte qui n'existe pas sont la
    // même chose. Le journal, lui, dit OÙ, jamais QUOI.
    journal("analyse", erreur);
    return null;
  });
  if (!row) return rien();

  // Le fil : illisible, on ne rend RIEN plutôt que des chiffres peut-être
  // périmés sur une image faite pour être postée. Refus hérité de la #064.
  const fil = await filRowsFor(id).catch((erreur: unknown) => {
    journal("fil", erreur);
    return "erreur" as const;
  });
  if (fil === "erreur") return indisponible();

  // Les termes ACTUELS priment sur ceux de l'offre d'origine. « indisponible »
  // : un tour enregistré avant la #169, ou dont la table a disparu du code
  // (#085) — pas de carte, et aucun repli sur l'origine.
  const courant = carteDuFil(fil);
  if (courant === "indisponible") return rien();
  const data = courant ?? verdictDataFromRow(row);
  if (!verdictCardAvailable(data)) return rien();

  return new ImageResponse(verdictCardElement(data), {
    ...VERDICT_CARD_SIZE,
    fonts: await loadFonts(),
    headers: SANS_CACHE,
  });
}
