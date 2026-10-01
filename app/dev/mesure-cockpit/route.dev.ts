import { ADMIN_PERIODS, loadDashboardMesure, loadDashboards, parsePeriod } from "@/lib/admin/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Mission #133 — où passent les secondes du changement de période.
//
// /api/admin/cockpit est réservée au propriétaire : on ne peut pas la
// chronométrer sans sa session. Cette route mesure EXACTEMENT le même travail
// — `loadDashboardMesure`, la fonction que la route de production appelle —
// et n'existe qu'en développement (extension `.dev.ts`, absente du build de
// production, voir next.config.ts).
//
// Elle sépare les deux durées serveur, et mesure en plus le coût des quatre
// périodes LANCÉES ENSEMBLE : c'est la décision de la mission. Quatre RPC en
// parallèle coûtent la plus lente, pas la somme — si c'est vrai, le premier
// rendu de /admin peut tout embarquer sans ralentir.
//
// La troisième durée, l'aller-retour vu du navigateur, se lit en appelant
// cette route depuis le navigateur : elle n'est pas mesurable ici.
export async function GET(request: Request) {
  // `?periode=7d` : UNE période, exactement le travail de /api/admin/cockpit.
  // C'est ce mode qu'on appelle depuis le navigateur pour obtenir la troisième
  // durée, aller-retour compris.
  const seule = new URL(request.url).searchParams.get("periode");
  if (seule) {
    const mesure = await loadDashboardMesure(parsePeriod(seule));
    return Response.json(
      { rpc_ms: mesure.rpc_ms, total_ms: mesure.total_ms },
      {
        headers: {
          "Cache-Control": "no-store",
          "Server-Timing": `rpc;dur=${mesure.rpc_ms}, total;dur=${mesure.total_ms}`,
        },
      },
    );
  }

  const une: Record<string, { rpc_ms: number; total_ms: number; octets: number }> = {};
  for (const period of ADMIN_PERIODS) {
    const mesure = await loadDashboardMesure(period);
    une[period] = {
      rpc_ms: mesure.rpc_ms,
      total_ms: mesure.total_ms,
      octets: Buffer.byteLength(JSON.stringify(mesure.data)),
    };
  }

  const debut = performance.now();
  const quatre = await loadDashboards();
  const quatre_ms = Math.round((performance.now() - debut) * 10) / 10;

  return Response.json(
    {
      une,
      quatre_ensemble_ms: quatre_ms,
      somme_des_quatre_ms: Math.round(Object.values(une).reduce((t, m) => t + m.total_ms, 0) * 10) / 10,
      octets_des_quatre: Buffer.byteLength(JSON.stringify(quatre)),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
