import { adminAccess, adminError } from "@/lib/admin/access";
import { loadDashboardMesure, parsePeriod } from "@/lib/admin/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Mission #132 — les chiffres d'une période, sans recharger la page.
//
// Changer de période rechargeait tout : écran blanc, saut de mise en page, et
// la comparaison perdue — on ne voyait pas CE QUI AVAIT CHANGÉ, on voyait un
// écran qui disparaissait puis réapparaissait. Le cockpit garde désormais ses
// graphiques montés et remplace leurs VALEURS ; c'est cette route qui les lui
// donne.
//
// Mêmes chiffres, même fonction : `loadDashboard`, celle du rendu serveur. Il
// n'y a pas deux chemins de calcul, donc pas deux résultats possibles.
//
// Réservée au propriétaire, par le même contrôle que les pages /admin
// (lib/admin/access.ts) : session vérifiée auprès de Supabase, adresse
// comparée à OWNER_EMAIL. Une panne d'authentification rend 503, jamais 401 —
// on ne dit pas « déconnecte-toi » à quelqu'un dont la session est peut-être
// valide (mission #089 bis).
export async function GET(request: Request) {
  const access = await adminAccess(request);
  if (!access.ok) return adminError(access);

  const period = parsePeriod(new URL(request.url).searchParams.get("period"));
  const mesure = await loadDashboardMesure(period);
  // Mission #133 — les deux durées serveur sont publiées. Si les outils de
  // développement montrent 2 500 ms quand `total` en annonce 110, le temps
  // n'est pas dans cette fonction : il est dans le réseau ou dans le
  // démarrage à froid. On ne cherchera pas au mauvais endroit.
  const chrono = { "Server-Timing": `rpc;dur=${mesure.rpc_ms}, total;dur=${mesure.total_ms}` };
  if (mesure.data === "missing") {
    return Response.json({ error: "missing" }, { status: 503, headers: { "Cache-Control": "no-store", ...chrono } });
  }
  return Response.json({ period, data: mesure.data }, { headers: { "Cache-Control": "no-store", ...chrono } });
}
