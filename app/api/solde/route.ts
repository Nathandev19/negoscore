import { getRequestSession, logAuthUnavailable } from "@/lib/auth/request-user";
import { analysisBalance } from "@/lib/billing/entitlement";
import { ANON_COOKIE, clientIp, hashIp, readCookie } from "@/lib/security/request";
import { hitUsageGuard } from "@/lib/security/usage-guard";
import { RIGHTS_PER_HOUR } from "@/lib/security/limits";

export const runtime = "nodejs";

// Mission #182 — COMBIEN D'ANALYSES IL RESTE, pour l'en-tête et pour l'écran
// de saisie. Lecture seule : ne réserve rien, ne décompte rien, ne touche
// aucun compteur. Le droit réel reste tranché par reserveAnalysis au moment de
// l'analyse.
//
// Contrairement à /api/droits (mission #046), cette route répond AUSSI à un
// navigateur sans compte : la gratuité est un solde comme un autre, et la
// mission #182 demande qu'il soit juste pour une session anonyme. Elle ne lit
// que le jeton anonyme déjà posé — elle n'en pose aucun.
//
// Aucune réponse ne contient de nombre inventé : quand la lecture échoue, le
// champ est ABSENT et l'écran n'affiche rien (même règle que le compteur de la
// mission #181).
export async function GET(request: Request) {
  const session = await getRequestSession(request);
  if (session.kind === "unavailable") {
    logAuthUnavailable("solde");
    return Response.json({ unknown: true }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const user = session.kind === "valid" ? session.user : null;
  // Même filet horaire que /api/droits, sur le même compteur : l'en-tête
  // n'appelle qu'au chargement d'une page, un usage normal n'y touche pas.
  try {
    const guard = await hitUsageGuard(hashIp(`solde:${clientIp(request)}`), { limit: RIGHTS_PER_HOUR });
    if (!guard.allowed) {
      return Response.json({ unknown: true }, { status: 429, headers: { "Cache-Control": "no-store" } });
    }
  } catch {
    // Compteur indisponible : on ne bloque pas une lecture sans effet.
  }
  try {
    const solde = await analysisBalance(user, readCookie(request, ANON_COOKIE));
    return Response.json(
      {
        restantes: solde.restantes,
        rechargeLe: solde.rechargeLe === null ? null : solde.rechargeLe.toISOString(),
        source: solde.source,
        intact: solde.intact,
      },
      // private : ce nombre est celui d'UNE personne, aucun cache partagé ne
      // doit le resservir (même règle que /api/droits, mission #062 B3).
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return Response.json({ unknown: true }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
