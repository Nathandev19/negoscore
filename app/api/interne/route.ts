import { getRequestSession } from "@/lib/auth/request-user";
import { expiredInternalCookieHeader, internalCookieHeader, internalSecret, isInternalEmail } from "@/lib/telemetry/internal";

export const runtime = "nodejs";

// Mission #118 — marquer CE navigateur comme interne.
//
// C'est la porte du cas 3 : téléphone et PC déconnectés, qui produisent le plus
// de visites parasites. Le cookie survit à la déconnexion, mais il ne
// s'OBTIENT qu'en étant connecté avec une adresse interne — et sa valeur est
// signée par un secret serveur, donc infalsifiable (lib/telemetry/internal.ts).
//
// Pour toute autre personne, connectée ou non, cette adresse répond comme une
// adresse inexistante : même 404, même corps vide. Rien ne dit qu'elle existe,
// rien ne permet de la sonder. Même règle que les pages du propriétaire
// (mission #077).
//
// GET             : marque ce navigateur.
// GET ?retirer=1  : le démarque — de quoi vérifier soi-même que le marquage
//                   change bien les chiffres, et redevenir un visiteur.
//
// Une méthode GET qui pose un cookie : elle ne modifie rien d'autre que l'état
// du navigateur qui la demande, et une adresse doit pouvoir se taper à la main
// sur un téléphone.

const NOT_FOUND = () => new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request) {
  const session = await getRequestSession(request);
  if (session.kind !== "valid" || !isInternalEmail(session.user.email)) return NOT_FOUND();

  const retirer = new URL(request.url).searchParams.get("retirer") !== null;
  if (retirer) {
    return Response.json(
      { interne: false, message: "Ce navigateur compte de nouveau comme un visiteur." },
      { status: 200, headers: { "Cache-Control": "no-store", "Set-Cookie": expiredInternalCookieHeader() } },
    );
  }

  const cookie = internalCookieHeader(internalSecret());
  if (!cookie) {
    // Ni IP_HASH_SALT ni clé service_role : aucun secret pour signer. On ne
    // pose pas un cookie constant qui serait, lui, falsifiable.
    console.error(JSON.stringify({ event: "interne_secret_absent" }));
    return Response.json(
      { interne: false, message: "Aucun secret serveur : le marquage est impossible." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  return Response.json(
    { interne: true, message: "Ce navigateur ne compte plus dans les chiffres du cockpit." },
    { status: 200, headers: { "Cache-Control": "no-store", "Set-Cookie": cookie } },
  );
}
