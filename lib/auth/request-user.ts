import { ACCESS_COOKIE, userFromAccessToken, type SessionUser } from "@/lib/auth/session";
import { readCookie } from "@/lib/security/request";

// Utilisateur d'une requête de route, vérifié auprès de Supabase Auth.
export function getRequestUser(request: Request): Promise<SessionUser | null> {
  return userFromAccessToken(readCookie(request, ACCESS_COOKIE));
}
