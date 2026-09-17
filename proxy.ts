import { NextResponse, type NextRequest } from "next/server";
import { requiresAccount } from "@/lib/auth/account-pages";
import { signedInRedirectPath } from "@/lib/auth/next-path";
import {
  ACCESS_COOKIE,
  accessTokenExpiresSoon,
  expiredCookieHeader,
  REFRESH_COOKIE,
  refreshSession,
  sessionCookieHeaders,
  type Session,
  userFromAccessToken,
} from "@/lib/auth/session";
import { expiredSessionHintCookieHeader, sessionHintCookieHeader } from "@/lib/auth/session-hint";

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

export async function proxy(request: NextRequest) {
  const accessToken = request.cookies.get(ACCESS_COOKIE)?.value;
  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;
  const { pathname, search } = request.nextUrl;
  const onLoginPage = pathname === "/connexion";

  // Rafraîchissement : seulement avec un jeton de rafraîchissement, et un jeton
  // d'accès absent ou sur le point d'expirer.
  let refreshed: Session | null = null;
  let invalidated = false;
  if (refreshToken && (!accessToken || accessTokenExpiresSoon(accessToken))) {
    refreshed = await refreshSession(refreshToken).catch(() => null);
    invalidated = refreshed === null;
  }
  const token = refreshed?.accessToken ?? (invalidated ? undefined : accessToken);

  let response: NextResponse;
  if (requiresAccount(pathname) && !(token && (await userFromAccessToken(token)))) {
    const target = `/connexion?next=${encodeURIComponent(`${pathname}${search}`)}`;
    response = NextResponse.redirect(new URL(target, request.url), 307);
  } else if (onLoginPage && token && (await userFromAccessToken(token))) {
    response = NextResponse.redirect(new URL(signedInRedirectPath(request.nextUrl.searchParams.get("next")), request.url));
  } else if (refreshed) {
    // Nouveau jeton transmis à la requête en cours.
    request.cookies.set(ACCESS_COOKIE, refreshed.accessToken);
    request.cookies.set(REFRESH_COOKIE, refreshed.refreshToken);
    response = NextResponse.next({ request: { headers: request.headers } });
  } else {
    response = NextResponse.next();
  }

  if (refreshed) {
    for (const cookie of sessionCookieHeaders(refreshed)) response.headers.append("Set-Cookie", cookie);
    // L'indicateur suit la durée de la session rafraîchie.
    response.headers.append("Set-Cookie", sessionHintCookieHeader());
  } else if (invalidated) {
    response.headers.append("Set-Cookie", expiredCookieHeader(ACCESS_COOKIE));
    response.headers.append("Set-Cookie", expiredCookieHeader(REFRESH_COOKIE));
    // Session invalide : l'en-tête ne doit plus afficher l'état connecté.
    response.headers.append("Set-Cookie", expiredSessionHintCookieHeader());
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|auth/callback|auth/confirm|.*\\.(?:png|jpg|jpeg|webp|svg|ico)$).*)"],
};
