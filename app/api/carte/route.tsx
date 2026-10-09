import { ImageResponse } from "next/og";
import { ANON_COOKIE, readCookie } from "@/lib/security/request";
import { loadFonts } from "@/lib/share-card/render";
import { VERDICT_CARD_SIZE, verdictCardAvailable, verdictCardElement } from "@/lib/share-card/verdict-card";
import { latestVerdictData } from "@/lib/share-card/verdict-data";

// Mission #165 — LA CARTE DE VERDICT, à l'adresse d'un seul navigateur.
//
// Pas d'identifiant dans l'adresse, pas de paramètre : la route lit le cookie
// anonyme httpOnly et rend la carte de l'analyse la plus récente de CE
// navigateur. Connaître l'adresse ne donne donc accès à rien, et il n'y a
// aucun identifiant à énumérer.
//
// Node, pas Edge : la police est lue sur le disque avec fs (assets/fonts),
// jamais sur un CDN — une image qui part chez quelqu'un d'autre ne doit pas
// dépendre d'un tiers pour exister.
export const runtime = "nodejs";
// Carte propre à un navigateur : jamais rendue à l'avance, jamais mise en
// cache partagé.
export const dynamic = "force-dynamic";

// 404 À CORPS VIDE, dans tous les cas où il n'y a pas de carte : pas de
// cookie, pas d'analyse, analyse sans verdict, lecture impossible. La réponse
// ne dit jamais laquelle des quatre — elle n'a rien à apprendre à qui la
// sollicite.
function rien(): Response {
  return new Response(null, { status: 404, headers: { "Cache-Control": "private, no-store" } });
}

export async function GET(request: Request): Promise<Response> {
  const anonToken = readCookie(request, ANON_COOKIE);
  if (!anonToken) return rien();

  // Une panne de lecture ne doit pas remonter en 500 : de l'extérieur, une
  // carte qu'on ne peut pas produire et une carte qui n'existe pas sont la
  // même chose. Le journal, lui, dit laquelle — il dit OÙ, jamais QUOI.
  const data = await latestVerdictData(anonToken).catch((erreur: unknown) => {
    console.error(
      JSON.stringify({
        event: "carte_verdict_indisponible",
        etape: "lecture",
        detail: erreur instanceof Error ? erreur.message.slice(0, 120) : "inconnu",
      }),
    );
    return null;
  });
  if (!data) return rien();
  if (!verdictCardAvailable(data)) return rien();

  return new ImageResponse(verdictCardElement(data), {
    ...VERDICT_CARD_SIZE,
    fonts: await loadFonts(),
    headers: { "Cache-Control": "private, no-store" },
  });
}
