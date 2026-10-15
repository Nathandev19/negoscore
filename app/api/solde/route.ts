import { getRequestSession, logAuthUnavailable } from "@/lib/auth/request-user";
import { analysisBalance } from "@/lib/billing/entitlement";
import { ANON_COOKIE, readCookie } from "@/lib/security/request";

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
//
// ─── Mission #194, D — PLUS AUCUN FILET HORAIRE ICI, ET C'EST VOULU ───────
//
// Cette route portait hitUsageGuard, repris de /api/droits. Or ce filet fait
// un rpc usage_guard_hit, c'est-à-dire une ÉCRITURE en base — à chaque
// chargement de page, sur une route dont le commentaire ci-dessus dit qu'elle
// ne touche aucun compteur. Deux allers-retours pour une lecture, dont un en
// écriture, sur le chemin critique de l'en-tête de TOUTES les pages.
//
// Il ne protégeait rien : son échec était déjà ignoré (le catch le disait en
// toutes lettres), donc un attaquant n'avait qu'à le faire tomber. Et il n'y a
// rien à protéger — cette route ne réserve rien, ne décompte rien et n'appelle
// aucun modèle payant. Elle lit un compteur et un solde.
//
// /api/droits et la route d'analyse GARDENT leur filet : là, il protège une
// opération qui coûte de l'argent.
export async function GET(request: Request) {
  const session = await getRequestSession(request);
  if (session.kind === "unavailable") {
    logAuthUnavailable("solde");
    return Response.json({ unknown: true }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const user = session.kind === "valid" ? session.user : null;
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
