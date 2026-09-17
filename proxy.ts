import { NextResponse, type NextRequest } from "next/server";
import { signedInRedirectPath } from "@/lib/auth/next-path";
import {
  ACCESS_COOKIE,
  accessTokenExpiresSoon,
  expiredCookieHeader,
  REFRESH_COOKIE,
  refreshSession,
  sessionCookieHeaders,
  userFromAccessToken,
} from "@/lib/auth/session";
import { expiredSessionHintCookieHeader, sessionHintCookieHeader } from "@/lib/auth/session-hint";

// Rafraîchit la session avant le rendu quand le jeton d'accès expire, pour
// que pages et routes lisent un jeton valide. N'autorise rien : chaque page
// et chaque route vérifie elle-même l'utilisateur auprès de Supabase.
//
// /connexion (page statique depuis la mission #045) : une personne déjà
// connectée est renvoyée là où elle voulait aller. La session est VÉRIFIÉE
// auprès de Supabase, jamais déduite de la présence d'un cookie ni de
// l'indicateur d'affichage : un cookie périmé renverrait vers /compte, qui
// renverrait vers /connexion, en boucle. Ce n'est qu'un raccourci : la page de
// connexion ne donne accès à rien.

export async function proxy(request: NextRequest) {
  const accessToken = request.cookies.get(ACCESS_COOKIE)?.value;
  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;
  const onLoginPage = request.nextUrl.pathname === "/connexion";

  if (!refreshToken || (accessToken && !accessTokenExpiresSoon(accessToken))) {
    if (onLoginPage && accessToken) {
      const redirect = await signedInRedirect(request, accessToken);
      if (redirect) return redirect;
    }
    return NextResponse.next();
  }

  const session = await refreshSession(refreshToken).catch(() => null);
  if (!session) {
    const response = NextResponse.next();
    response.headers.append("Set-Cookie", expiredCookieHeader(ACCESS_COOKIE));
    response.headers.append("Set-Cookie", expiredCookieHeader(REFRESH_COOKIE));
    // Session invalide : l'en-tête ne doit plus afficher l'état connecté.
    response.headers.append("Set-Cookie", expiredSessionHintCookieHeader());
    return response;
  }

  // Nouveau jeton transmis à la requête en cours et renvoyé au navigateur.
  request.cookies.set(ACCESS_COOKIE, session.accessToken);
  request.cookies.set(REFRESH_COOKIE, session.refreshToken);
  const response =
    (onLoginPage ? await signedInRedirect(request, session.accessToken) : null) ??
    NextResponse.next({ request: { headers: request.headers } });
  for (const cookie of sessionCookieHeaders(session)) response.headers.append("Set-Cookie", cookie);
  // L'indicateur suit la durée de la session rafraîchie.
  response.headers.append("Set-Cookie", sessionHintCookieHeader());
  return response;
}

async function signedInRedirect(request: NextRequest, accessToken: string): Promise<NextResponse | null> {
  if (!(await userFromAccessToken(accessToken))) return null;
  const target = signedInRedirectPath(request.nextUrl.searchParams.get("next"));
  return NextResponse.redirect(new URL(target, request.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|auth/callback|auth/confirm|.*\\.(?:png|jpg|jpeg|webp|svg|ico)$).*)"],
};
