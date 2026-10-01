import { describe, expect, it, vi } from "vitest";

// Mission #133 — MESURER AVANT DE CORRIGER, ET GARDER LA MESURE.
//
// Le constat était « 2 à 3 secondes entre le clic et le mouvement des barres »,
// sans savoir où elles passaient. Trois durées se confondaient : la RPC
// Postgres, la fonction serveur, l'aller-retour vu du navigateur.
//
// Mesuré (app/dev/mesure-cockpit/route.dev.ts, en local, contre la vraie base) :
//   - RPC Supabase ............. 92 à 242 ms
//   - total de la fonction ..... la même chose, à 0,1 ms près
//   - aller-retour navigateur .. 103 à 258 ms, soit ~12 à 17 ms de réseau
// Les quatre périodes ensemble : 154 ms contre 414 ms en série, et 6,4 ko.
//
// Conclusion : la mise en forme ne coûte rien, et le serveur local ne met pas
// 2 secondes. Les 2 à 3 secondes vues sur la production sont donc EN DEHORS de
// cette fonction — réseau et démarrage à froid. C'est pour qu'on puisse le
// vérifier là-bas sans rebrancher quoi que ce soit que les deux durées
// serveur sont publiées en en-tête `Server-Timing`.
//
// Ce fichier garde la mesure vivante : une instrumentation qu'on retire sans
// s'en apercevoir, c'est une enquête à refaire.

const supabase = vi.hoisted(() => ({ rpc: vi.fn(), selectRows: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ rpc: supabase.rpc, selectRows: supabase.selectRows }));

const acces = vi.hoisted(() => ({ adminAccess: vi.fn() }));
vi.mock("@/lib/admin/access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admin/access")>()),
  adminAccess: acces.adminAccess,
}));

const { ADMIN_PERIODS, loadDashboardMesure, loadDashboards, sinceForPeriod } = await import("@/lib/admin/data");
const { GET } = await import("@/app/api/admin/cockpit/route");

const VIDE = {
  counts: {}, excluded: 0, internal: 0, paid_pro: 0, granted_pro: 0,
  feedback: { total: 0, fair: 0, not_fair: 0 },
  purchases: { purchases: 0, revenue_eur: 0, revenue_covered: 0 },
  timeseries: [], acquisition: [], guides: [], example: { total: 0, direct: 0 }, tier_changes: [],
};

const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("les trois durées sont séparées", () => {
  it("le temps de la RPC est mesuré, et il est contenu dans le temps total", async () => {
    supabase.rpc.mockImplementation(async () => {
      await attendre(40);
      return VIDE;
    });
    const mesure = await loadDashboardMesure("7d");
    expect(mesure.data).not.toBe("missing");
    // La RPC a bien duré : ce n'est pas un zéro décoratif.
    expect(mesure.rpc_ms).toBeGreaterThanOrEqual(30);
    // Et la mise en forme vient APRÈS, donc le total ne peut pas être inférieur.
    expect(mesure.total_ms).toBeGreaterThanOrEqual(mesure.rpc_ms);
  });

  it("une RPC en panne rend « missing », et ses durées quand même", async () => {
    supabase.rpc.mockImplementation(async () => {
      await attendre(20);
      throw new Error("relation inconnue");
    });
    const mesure = await loadDashboardMesure("24h");
    expect(mesure.data).toBe("missing");
    expect(mesure.rpc_ms).toBeGreaterThanOrEqual(10);
    expect(Number.isFinite(mesure.total_ms)).toBe(true);
  });

  it("/api/admin/cockpit publie les deux durées serveur", async () => {
    acces.adminAccess.mockResolvedValue({ ok: true });
    supabase.rpc.mockResolvedValue(VIDE);
    const response = await GET(new Request("https://negoscore.fr/api/admin/cockpit?period=30d"));
    expect(response.status).toBe(200);
    const entete = response.headers.get("Server-Timing") ?? "";
    // Deux durées nommées, lisibles dans les outils de développement. Si la
    // production annonce total;dur=110 pendant que le navigateur voit 2 500 ms,
    // le temps n'est pas dans cette fonction.
    expect(entete).toMatch(/^rpc;dur=\d+(\.\d+)?, total;dur=\d+(\.\d+)?$/);
  });

  it("l'en-tête est là aussi quand la RPC manque", async () => {
    acces.adminAccess.mockResolvedValue({ ok: true });
    supabase.rpc.mockRejectedValue(new Error("relation inconnue"));
    const response = await GET(new Request("https://negoscore.fr/api/admin/cockpit?period=7d"));
    expect(response.status).toBe(503);
    expect(response.headers.get("Server-Timing")).toMatch(/rpc;dur=/);
  });
});

describe("les quatre périodes chargées ensemble", () => {
  it("quatre RPC, quatre fenêtres de temps distinctes", async () => {
    const vues: unknown[] = [];
    supabase.rpc.mockImplementation(async (_fn: string, args: { p_since: string | null }) => {
      vues.push(args.p_since);
      await attendre(30);
      return VIDE;
    });
    const debut = performance.now();
    const parPeriode = await loadDashboards();
    const ecoule = performance.now() - debut;

    // Les quatre y sont.
    expect(Object.keys(parPeriode).sort()).toEqual([...ADMIN_PERIODS].sort());
    // Chacune a demandé SA fenêtre : sans cela, « 24 h » afficherait les
    // chiffres de « 7 jours » et la mémoire mentirait.
    expect(vues).toHaveLength(4);
    expect(new Set(vues).size).toBe(4);
    expect(vues).toContain(null);
    expect(sinceForPeriod("all")).toBe(null);
    // En parallèle : le coût est celui de la plus lente, pas la somme des
    // quatre. C'est ce qui rend l'embarquement acceptable au premier rendu.
    expect(ecoule).toBeLessThan(4 * 30);
  });

  it("une période en panne n'emporte pas les trois autres", async () => {
    supabase.rpc.mockImplementation(async (_fn: string, args: { p_since: string | null }) => {
      if (args.p_since === null) throw new Error("panne passagère");
      return VIDE;
    });
    const parPeriode = await loadDashboards();
    expect(parPeriode.all).toBe("missing");
    for (const period of ["24h", "7d", "30d"] as const) expect(parPeriode[period]).not.toBe("missing");
  });
});
