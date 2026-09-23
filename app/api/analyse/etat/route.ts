import { readIdempotencyKey, replayableAnalysis } from "@/lib/analysis/idempotency";
import { getRequestSession } from "@/lib/auth/request-user";
import { ANON_COOKIE, readCookie } from "@/lib/security/request";

export const runtime = "nodejs";

// Mission #102, partie A — où en est CETTE tentative ?
//
// Appelée au retour au premier plan, quand la requête longue a été coupée par
// le système (iOS gèle les onglets en arrière-plan). Elle ne fait que LIRE :
// aucun appel au modèle, aucun droit réservé ni décompté, rien de compté dans
// le filet horaire. Elle ne peut donc jamais lancer une seconde analyse.
//
// La clé d'idempotence n'est pas une autorisation : `replayableAnalysis` ne
// rend une analyse que si elle appartient déjà au demandeur (compte connecté,
// ou jeton anonyme de ce navigateur). Une clé présentée par quelqu'un d'autre
// ne rend rien, et rien ne dit qu'elle existe.
export async function GET(request: Request) {
  const key = readIdempotencyKey(new URL(request.url).searchParams.get("cle"));
  if (!key) return Response.json({ etat: "inconnu" }, { headers: { "Cache-Control": "no-store" } });

  const session = await getRequestSession(request);
  // Authentification injoignable : on ne sait pas de qui vient la clé, donc on
  // ne répond rien de définitif. Le navigateur continue d'attendre.
  if (session.kind === "unavailable") {
    return Response.json({ etat: "indisponible" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const user = session.kind === "valid" ? session.user : null;
  const anonToken = readCookie(request, ANON_COOKIE);

  try {
    const replay = await replayableAnalysis(key, { user, anonToken });
    if (replay.kind === "analysis") {
      return Response.json({ etat: "faite", analysisId: replay.analysisId }, { headers: { "Cache-Control": "no-store" } });
    }
    // « taken » : la clé est à quelqu'un d'autre, ou la demande n'a pas produit
    // d'analyse. Dans les deux cas, il n'y a rien à rendre à ce navigateur.
    return Response.json({ etat: "inconnu" }, { headers: { "Cache-Control": "no-store" } });
  } catch (caught) {
    console.error(
      JSON.stringify({ event: "analyse_etat_failed", detail: caught instanceof Error ? caught.message.slice(0, 200) : "inconnu" }),
    );
    return Response.json({ etat: "indisponible" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
