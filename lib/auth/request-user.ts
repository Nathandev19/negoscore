import { ACCESS_COOKIE, sessionFromAccessToken, userFromAccessToken, type SessionCheck, type SessionUser } from "@/lib/auth/session";
import { readCookie } from "@/lib/security/request";

// Session d'une requête de route, vérifiée auprès de Supabase Auth.

// Mission #089 — trois issues pour la route : « valid », pas de session
// (« absent » ou « rejected »), « unavailable » (Supabase injoignable). Toute
// route pour laquelle une panne produirait une affirmation fausse (traiter une
// abonnée comme une visiteuse, lui dire de se connecter, dire son analyse
// introuvable) lit celle-ci.
export function getRequestSession(request: Request): Promise<SessionCheck> {
  return sessionFromAccessToken(readCookie(request, ACCESS_COOKIE));
}

// Utilisateur ou null, panne comprise. Réservé aux routes où une panne ne
// produit rien de faux à l'écran (voir la liste de la mission #089).
export function getRequestUser(request: Request): Promise<SessionUser | null> {
  return userFromAccessToken(readCookie(request, ACCESS_COOKIE));
}


// Trace commune d'une authentification injoignable (mission #089).
export function logAuthUnavailable(route: string): void {
  console.warn(JSON.stringify({ event: "auth_unavailable", route }));
}
