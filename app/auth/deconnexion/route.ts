import { ACCESS_COOKIE, expiredCookieHeader, REFRESH_COOKIE, signOut } from "@/lib/auth/session";
import { flashCookieHeader } from "@/lib/auth/flash";
import { expiredSessionHintCookieHeader } from "@/lib/auth/session-hint";
import { expiredOwnerHintCookieHeader } from "@/lib/auth/owner-hint";
import { readCookie } from "@/lib/security/request";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const accessToken = readCookie(request, ACCESS_COOKIE);
  if (accessToken) await signOut(accessToken);
  const headers = new Headers({ Location: "/", "Cache-Control": "no-store" });
  headers.append("Set-Cookie", expiredCookieHeader(ACCESS_COOKIE));
  headers.append("Set-Cookie", expiredCookieHeader(REFRESH_COOKIE));
  headers.append("Set-Cookie", expiredSessionHintCookieHeader());
  headers.append("Set-Cookie", expiredOwnerHintCookieHeader());
  // Bandeau « Déconnexion réussie » sur la page d'arrivée.
  headers.append("Set-Cookie", flashCookieHeader("deconnexion", process.env.NODE_ENV === "production"));
  return new Response(null, { status: 303, headers });
}
