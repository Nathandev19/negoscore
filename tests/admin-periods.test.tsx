import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const supabase = vi.hoisted(() => ({ rpc: vi.fn(), selectRows: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  rpc: supabase.rpc,
  // Mission #112 — le cockpit lit aussi les paiements non rattachés
  // (lib/admin/data.ts, loadUnattachedPayments). Aucun ici.
  selectRows: supabase.selectRows,
}));

const { loadDashboard, parsePeriod, sinceForPeriod } = await import("@/lib/admin/data");
const { default: AdminDashboard } = await import("@/app/admin/page");

const EMPTY = {
  counts: {},
  paid_pro: 0,
  granted_pro: 0,
  feedback: { total: 0, fair: 0, not_fair: 0 },
  purchases: { purchases: 0, revenue_eur: 0, revenue_covered: 0 },
  timeseries: [],
  acquisition: [],
};

describe("filtres de période du cockpit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-23T12:00:00.000Z"));
    supabase.rpc.mockReset().mockResolvedValue(EMPTY);
    supabase.selectRows.mockReset().mockResolvedValue([]);
  });
  afterEach(() => vi.useRealTimers());

  it("transmet à la RPC la borne correspondant exactement à chaque URL", async () => {
    const expected = {
      "24h": "2026-09-22T12:00:00.000Z",
      "7d": "2026-09-16T12:00:00.000Z",
      "30d": "2026-08-24T12:00:00.000Z",
      all: null,
    } as const;

    for (const [period, p_since] of Object.entries(expected)) {
      expect(parsePeriod(period)).toBe(period);
      expect(sinceForPeriod(period as keyof typeof expected)).toBe(p_since);
      await loadDashboard(period as keyof typeof expected);
      expect(supabase.rpc).toHaveBeenLastCalledWith("admin_dashboard_metrics", { p_since });
    }
    expect(parsePeriod("inconnu")).toBe("7d");
  });

  it("relit searchParams et marque la période de l'URL comme active", async () => {
    const page = await AdminDashboard({ params: Promise.resolve({}), searchParams: Promise.resolve({ period: "30d" }) });
    const html = renderToStaticMarkup(page);
    for (const period of ["24h", "7d", "30d", "all"]) expect(html).toContain(`href="/admin?period=${period}"`);
    expect(html).toMatch(/<a aria-current="page"[^>]+href="\/admin\?period=30d">30 jours<\/a>/);
    expect(supabase.rpc).toHaveBeenCalledWith("admin_dashboard_metrics", { p_since: "2026-08-24T12:00:00.000Z" });
  });

  // Mission #112, A4 — un paiement qu'on n'a pas su rattacher doit SE VOIR.
  // Un journal ne se regarde pas ; le cockpit, si.
  it("affiche les paiements sans compte rattaché, et rien quand il n'y en a pas", async () => {
    const render = async () =>
      renderToStaticMarkup(await AdminDashboard({ params: Promise.resolve({}), searchParams: Promise.resolve({}) }));

    expect(await render()).not.toContain("Paiements sans compte rattaché");

    supabase.selectRows.mockResolvedValue([
      { event_id: "evt_1", email: "acheteur@exemple.test", plan: "pack", amount: 4.99, currency: "eur", paid_at: "2026-09-23T09:00:00.000Z", resolution: null },
      { event_id: "evt_2", email: null, plan: "pro", amount: 12.99, currency: "eur", paid_at: "2026-08-01T09:00:00.000Z", resolution: "abandonne" },
    ]);
    const html = await render();
    expect(html).toContain("Paiements sans compte rattaché");
    expect(html).toContain("evt_1");
    expect(html).toContain("acheteur@exemple.test");
    expect(html).toContain("En attente");
    expect(html).toContain("Abandonné");
    // La lecture porte bien sur les paiements qu'on n'a pas su rattacher.
    expect(supabase.selectRows).toHaveBeenCalledWith("pending_payments", expect.stringContaining("reason=eq.compte_introuvable"));
  });
});
