import { getRequestUser } from "@/lib/auth/request-user";
import { analysisRightStatus } from "@/lib/billing/entitlement";
import { ANON_COOKIE, clientIp, hashIp, readCookie } from "@/lib/security/request";
import { hitUsageGuard } from "@/lib/security/usage-guard";
import { RIGHTS_PER_HOUR } from "@/lib/security/limits";

export const runtime = "nodejs";

// Reste-t-il un droit d'analyser ? Lecture seule, pour l'affichage du
// formulaire d'un compte connecté AVANT la saisie (mission #046). Ne réserve
// rien et ne compte rien ; le droit réel est décidé au moment de l'analyse.
// Appelé seulement quand l'indicateur de session est présent : un visiteur sans
// compte n'appelle pas le serveur (voir lib/billing/right-hint.ts).
export async function GET(request: Request) {
  const user = await getRequestUser(request);
  // Limite horaire par IP hachée (mission #062, B2), avec le compteur qui sert
  // déjà aux analyses et aux liens de connexion. Elle ne change rien pour un
  // usage normal : le formulaire n'appelle cette route qu'à son ouverture.
  // Au-delà, on répond comme quand la lecture échoue — le formulaire reste
  // ouvert, le droit réel est tranché au moment de l'analyse.
  try {
    const guard = await hitUsageGuard(hashIp(`droits:${clientIp(request)}`), { limit: RIGHTS_PER_HOUR });
    if (!guard.allowed) {
      return Response.json({ allowed: true, unknown: true }, { status: 429, headers: { "Cache-Control": "no-store" } });
    }
  } catch {
    // Compteur indisponible : on ne bloque pas une lecture sans effet.
  }
  try {
    const status = await analysisRightStatus(user, readCookie(request, ANON_COOKIE));
    return Response.json(
      status.allowed ? { allowed: true } : { allowed: false, reason: status.reason, message: status.message },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    // Indisponible : le formulaire reste ouvert, le serveur tranchera au clic.
    return Response.json({ allowed: true, unknown: true }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
