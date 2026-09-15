import { NextResponse, type NextRequest } from "next/server";
import {
  ACCESS_COOKIE,
  accessTokenExpiresSoon,
  expiredCookieHeader,
  REFRESH_COOKIE,
  refreshSession,
  sessionCookieHeaders,
} from "@/lib/auth/session";

// Rafraîchit la session avant le rendu quand le jeton d'accès expire, pour
// que pages et routes lisent un jeton valide. N'autorise rien : chaque page
// et chaque route vérifie elle-même l'utilisateur auprès de Supabase.

export async function proxy(request: NextRequest) {
  const accessToken = request.cookies.get(ACCESS_COOKIE)?.value;
  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;
  if (!refreshToken || (accessToken && !accessTokenExpiresSoon(accessToken))) {
    return NextResponse.next();
  }

  const session = await refreshSession(refreshToken).catch(() => null);
  if (!session) {
    const response = NextResponse.next();
    response.headers.append("Set-Cookie", expiredCookieHeader(ACCESS_COOKIE));
    response.headers.append("Set-Cookie", expiredCookieHeader(REFRESH_COOKIE));
    return response;
  }

  // Nouveau jeton transmis à la requête en cours et renvoyé au navigateur.
  request.cookies.set(ACCESS_COOKIE, session.accessToken);
  request.cookies.set(REFRESH_COOKIE, session.refreshToken);
  const response = NextResponse.next({ request: { headers: request.headers } });
  for (const cookie of sessionCookieHeaders(session)) response.headers.append("Set-Cookie", cookie);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|auth/callback|.*\\.(?:png|jpg|jpeg|webp|svg|ico)$).*)"],
};
