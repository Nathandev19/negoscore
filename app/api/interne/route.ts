import { getRequestSession } from "@/lib/auth/request-user";
import { expiredInternalCookieHeader, internalCookieHeader, internalSecret, isInternalEmail, markSecretValid } from "@/lib/telemetry/internal";

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

// Mission #127, partie B — le même marquage, demandé depuis la page /interne.
//
// La voie du dessus (GET, compte interne connecté) reste la normale. Celle-ci
// existe pour les navigateurs intégrés d'Instagram et de TikTok, où se
// connecter n'est pas praticable : le secret d'INTERNAL_MARK_SECRET tient lieu
// de preuve, et il voyage dans le corps du formulaire, pas dans l'adresse.
//
// Mauvais secret, secret absent, variable non configurée : 404. Jamais 401 —
// une erreur d'autorisation dirait qu'il y a une porte ici.
export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const cle = form?.get("cle");
  if (!markSecretValid(typeof cle === "string" ? cle : null)) return NOT_FOUND();

  const retirer = form?.get("action") === "retirer";
  const cookie = retirer ? expiredInternalCookieHeader() : internalCookieHeader(internalSecret());
  if (!cookie) {
    // Aucun sel serveur : on ne pose pas un cookie constant, il serait
    // falsifiable (lib/telemetry/internal.ts).
    console.error(JSON.stringify({ event: "interne_secret_absent" }));
    return NOT_FOUND();
  }
  // 303 : le navigateur revient en GET sur la page, qui relit le cookie et
  // affiche l'état réel. Sans JavaScript, et sans renvoyer le formulaire si la
  // personne recharge.
  return new Response(null, {
    status: 303,
    headers: {
      Location: `/interne?cle=${encodeURIComponent(typeof cle === "string" ? cle : "")}`,
      "Cache-Control": "no-store",
      "Set-Cookie": cookie,
    },
  });
}
