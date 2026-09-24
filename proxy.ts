import { NextResponse, type NextRequest } from "next/server";
import { shortPathTarget } from "@/lib/acquisition/chemins";
import { isDevZone, isOwnerEmail, isOwnerPath, ownerRefusal, ownerRefusalLog } from "@/lib/admin/owner";
import { requiresAccount } from "@/lib/auth/account-pages";
import { signedInRedirectPath } from "@/lib/auth/next-path";
import {
  ACCESS_COOKIE,
  accessTokenExpiresSoon,
  checkAccessToken,
  expiredCookieHeader,
  REFRESH_COOKIE,
  refreshSessionOutcome,
  sessionCookieHeaders,
  type Session,
} from "@/lib/auth/session";
import { expiredSessionHintCookieHeader, SESSION_HINT_COOKIE, sessionHintCookieHeader } from "@/lib/auth/session-hint";
import { expiredOwnerHintCookieHeader, OWNER_HINT_COOKIE, ownerHintCookieHeaderFor } from "@/lib/auth/owner-hint";

// Avant tout rendu :
//
// 1. Rafraîchit la session quand le jeton d'accès expire, pour que pages et
//    routes lisent un jeton valide.
//
// 2. Pages de compte (lib/auth/account-pages.ts, mission #048) : un visiteur sans session
//    valide reçoit une redirection 307 vers /connexion, décidée ici, avant que
//    la moindre partie de la page ne parte. Sans ce contrôle, l'écran de
//    chargement (loading.tsx, mission #045) commençait la réponse en 200, et la
//    redirection de la page n'arrivait qu'ensuite, dans le flux. Pour une
//    personne connectée, rien ne change : l'écran de chargement s'affiche
//    pendant le rendu. Chaque page garde sa propre vérification.
//
// 3. /connexion (page statique depuis la mission #045) : une personne déjà
//    connectée est renvoyée là où elle voulait aller.
//
// La session est toujours VÉRIFIÉE auprès de Supabase, jamais déduite de la
// présence d'un cookie ni de l'indicateur d'affichage : un cookie périmé
// renverrait vers /compte, qui renverrait vers /connexion, en boucle.
//
// 4. Mission #070 — l'en-tête ne prétend jamais une session que le serveur
//    refuse. C'est ICI que les cookies s'effacent, et nulle part ailleurs :
//    une page (composant serveur) ne peut pas poser de cookie, et plus du tout
//    une fois la réponse partie (docs Next : cookies, « HTTP does not allow
//    setting cookies after streaming starts ») ; une route n'est pas sur le
//    chemin d'une navigation. Le proxy, lui, passe avant chaque page et peut
//    poser des en-têtes Set-Cookie aussi bien sur une redirection que sur la
//    réponse normale.
//
//    Trois issues, jamais deux (lib/auth/session.ts) :
//      - session REFUSÉE par Supabase (compte supprimé, session révoquée, jeton
//        de rafraîchissement expiré) : les deux cookies de session et
//        l'indicateur sont effacés, sur la réponse même qui le constate ;
//      - Supabase INDISPONIBLE (réseau, 5xx) : on ne sait rien, on ne touche
//        à rien ;
//      - jeton d'accès simplement périmé avec un jeton de rafraîchissement
//        valable : la session est rafraîchie, jamais détruite.
//    Et un indicateur sans aucun cookie de session est effacé partout.
//
// 5. Mission #077 — pages réservées au propriétaire (/dev/retours,
//    lib/admin/owner.ts) : pour toute autre personne, connectée ou non, la
//    requête est réécrite vers une adresse qui n'existe pas. La réponse est
//    alors celle d'une adresse inconnue : même code 404, même page. La page
//    refait le contrôle elle-même.
//    Next ajoute à toute réponse réécrite un en-tête x-middleware-rewrite,
//    qu'on ne peut pas retirer : en production, TOUTE la zone /dev est donc
//    réécrite de la même façon pour les autres. /dev/retours y est
//    indiscernable de /dev/nimportequoi, corps et en-têtes compris.

// Adresse qui ne correspond à aucune route (le préfixe _ exclut un dossier du
// routage) : sa réponse est celle d'une page inexistante.
const NOWHERE = "/_introuvable";
// Mission #089 — page de compte pendant une panne de Supabase Auth.
const AUTH_UNAVAILABLE_PAGE = "/session-indisponible";

export async function proxy(request: NextRequest) {
  // Mission #106 — chemins courts porteurs d'UTM (/dm, /verdicts…). Avant
  // tout le reste : ce sont des adresses dictées à l'oral, tapées à la main,
  // qui n'ont besoin ni de session ni de rien d'autre. Redirection TEMPORAIRE
  // (307) : la table doit pouvoir changer sans qu'un navigateur ait mis
  // l'ancienne destination en cache pour toujours.
  const shortPath = shortPathTarget(request.nextUrl.pathname);
  if (shortPath) return NextResponse.redirect(new URL(shortPath, request.url), 307);

  const accessToken = request.cookies.get(ACCESS_COOKIE)?.value;
  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;
  const hasHint = request.cookies.has(SESSION_HINT_COOKIE);
  const hasOwnerHint = request.cookies.has(OWNER_HINT_COOKIE);
  const { pathname, search } = request.nextUrl;
  // /connexion/lien-expire : même page, avec le message d'erreur (mission #074).
  const onLoginPage = pathname === "/connexion" || pathname === "/connexion/lien-expire";
  const ownerOnly = isOwnerPath(pathname) || (isDevZone(pathname) && process.env.NODE_ENV === "production");

  // Rafraîchissement : seulement avec un jeton de rafraîchissement, et un jeton
  // d'accès absent ou sur le point d'expirer.
  let refreshed: Session | null = null;
  let rejected = false;
  let unavailable = false;
  if (refreshToken && (!accessToken || accessTokenExpiresSoon(accessToken))) {
    const outcome = await refreshSessionOutcome(refreshToken);
    if (outcome.kind === "refreshed") refreshed = outcome.session;
    else if (outcome.kind === "rejected") rejected = true;
    else unavailable = true;
  }
  const token = refreshed?.accessToken ?? (rejected ? undefined : accessToken);

  // Vérification auprès de Supabase, là où elle décide de l'accès.
  let signedIn = false;
  let owner = false;
  let sessionEmail: string | null = null;
  // Mission #089 — Supabase n'a pas pu répondre, au rafraîchissement ou à la
  // vérification : on ne sait pas si la personne est connectée.
  let checkUnavailable = false;
  if (token && (requiresAccount(pathname) || onLoginPage || ownerOnly)) {
    const check = await checkAccessToken(token);
    if (check.kind === "unavailable") checkUnavailable = true;
    if (check.kind === "valid") {
      signedIn = true;
      sessionEmail = check.user.email;
      owner = isOwnerEmail(check.user.email);
    }
    // Refus constaté. Sauf si le rafraîchissement n'a pas pu se faire : le
    // jeton vérifié est alors peut-être seulement périmé, et la session encore
    // bonne. Dans le doute, on ne détruit rien.
    else if (check.kind === "rejected" && !unavailable) rejected = true;
  }

  // Session refusée : la page qui suit ne doit pas la lire non plus.
  if (rejected) {
    request.cookies.delete(ACCESS_COOKIE);
    request.cookies.delete(REFRESH_COOKIE);
  }

  let response: NextResponse;
  if (ownerOnly && !owner) {
    // Une personne avec un cookie de session refusée ici : la raison va dans
    // les journaux (mission #079). Sans cookie (visiteur, robot), rien.
    if (token) console.warn(ownerRefusalLog(ownerRefusal(sessionEmail)));
    response = NextResponse.rewrite(new URL(NOWHERE, request.url));
  } else if (requiresAccount(pathname) && !signedIn && !rejected && (unavailable || checkUnavailable)) {
    // Mission #089 — une session existe peut-être, mais Supabase ne répond pas :
    // pas de « connecte-toi ». La page dit que c'est momentané ; l'adresse reste
    // la même, la recharger réessaie. Aucun cookie touché.
    response = NextResponse.rewrite(new URL(AUTH_UNAVAILABLE_PAGE, request.url));
  } else if (requiresAccount(pathname) && !signedIn) {
    const target = `/connexion?next=${encodeURIComponent(`${pathname}${search}`)}`;
    response = NextResponse.redirect(new URL(target, request.url), 307);
  } else if (onLoginPage && signedIn) {
    response = NextResponse.redirect(new URL(signedInRedirectPath(request.nextUrl.searchParams.get("next")), request.url));
  } else if (refreshed && !rejected) {
    // Nouveau jeton transmis à la requête en cours.
    request.cookies.set(ACCESS_COOKIE, refreshed.accessToken);
    request.cookies.set(REFRESH_COOKIE, refreshed.refreshToken);
    response = NextResponse.next({ request: { headers: request.headers } });
  } else if (rejected) {
    response = NextResponse.next({ request: { headers: request.headers } });
  } else {
    response = NextResponse.next();
  }

  if (rejected) {
    response.headers.append("Set-Cookie", expiredCookieHeader(ACCESS_COOKIE));
    response.headers.append("Set-Cookie", expiredCookieHeader(REFRESH_COOKIE));
    // Session invalide : l'en-tête ne doit plus afficher l'état connecté.
    response.headers.append("Set-Cookie", expiredSessionHintCookieHeader());
    if (hasOwnerHint) response.headers.append("Set-Cookie", expiredOwnerHintCookieHeader());
  } else if (refreshed) {
    for (const cookie of sessionCookieHeaders(refreshed)) response.headers.append("Set-Cookie", cookie);
    // L'indicateur suit la durée de la session rafraîchie.
    response.headers.append("Set-Cookie", sessionHintCookieHeader());
    // Indicateur propriétaire (mission #080) : reposé ou effacé selon
    // l'adresse de la session rafraîchie, vérifiée par Supabase.
    const ownerNow = isOwnerEmail(refreshed.user.email);
    if (ownerNow || hasOwnerHint) response.headers.append("Set-Cookie", ownerHintCookieHeaderFor(ownerNow));
  } else if (!accessToken && !refreshToken) {
    // Indicateurs orphelins : aucun cookie de session derrière. Rien à
    // vérifier, aucun appel à Supabase : il n'y a de toute façon pas de session.
    if (hasHint) response.headers.append("Set-Cookie", expiredSessionHintCookieHeader());
    if (hasOwnerHint) response.headers.append("Set-Cookie", expiredOwnerHintCookieHeader());
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|auth/callback|auth/confirm|.*\\.(?:png|jpg|jpeg|webp|svg|ico)$).*)"],
};
