import { getRequestUser } from "@/lib/auth/request-user";
import { analysisRightStatus } from "@/lib/billing/entitlement";
import { ANON_COOKIE, readCookie } from "@/lib/security/request";

export const runtime = "nodejs";

// Reste-t-il un droit d'analyser ? Lecture seule, pour l'affichage du
// formulaire d'un compte connecté AVANT la saisie (mission #046). Ne réserve
// rien et ne compte rien ; le droit réel est décidé au moment de l'analyse.
// Appelé seulement quand l'indicateur de session est présent : un visiteur sans
// compte n'appelle pas le serveur (voir lib/billing/right-hint.ts).
export async function GET(request: Request) {
  const user = await getRequestUser(request);
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
