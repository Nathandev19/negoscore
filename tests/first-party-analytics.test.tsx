import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Funnel, TimeSeries } from "@/components/admin/charts";
import { parsePeriod, sinceForPeriod, type DashboardData } from "@/lib/admin/data";
import { parseAttribution } from "@/lib/analytics/first-party";

const telemetry = vi.hoisted(() => ({ calls: [] as unknown[] }));
vi.mock("@/lib/analytics/first-party", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/analytics/first-party")>()),
  recordProductEvent: async (input: unknown) => telemetry.calls.push(input),
}));

beforeEach(() => { telemetry.calls = []; });
afterEach(() => vi.restoreAllMocks());

describe("attribution first-party", () => {
  it("normalise les UTM dynamiques sans hardcoder une campagne", () => {
    expect(parseAttribution({
      path: "/tarifs?utm_source=TikTok", referrer_host: "WWW.TIKTOK.COM",
      utm_source: " TikTok ", utm_medium: "Organic Social", utm_campaign: "Launch Été", utm_content: "VIDEO 27 / test",
    })).toEqual({
      path: "/tarifs?utm_source=TikTok", referrer_host: "www.tiktok.com",
      utm_source: "tiktok", utm_medium: "organic_social", utm_campaign: "launch_t_", utm_content: "video_27_test",
    });
  });

  it("rejette un chemin externe et borne les valeurs", () => {
    const parsed = parseAttribution({ path: "https://evil.test/x", utm_source: "A".repeat(500) });
    expect(parsed.path).toBeNull();
    expect(parsed.utm_source).toHaveLength(100);
  });

  it("l'endpoint public n'accepte que les vues prévues depuis la même origine", async () => {
    const { POST } = await import("@/app/api/events/route");
    const send = (event: string, origin = "http://localhost:3000", site = "same-origin") => POST(new Request("http://localhost:3000/api/events", {
      method: "POST", headers: { origin, "sec-fetch-site": site, "content-type": "application/json" }, body: JSON.stringify({ event, attribution: { utm_source: "TikTok" } }),
    }));
    expect((await send("landing_view")).status).toBe(204);
    expect(telemetry.calls).toEqual([expect.objectContaining({ event: "landing_view", attribution: expect.objectContaining({ utm_source: "tiktok" }) })]);
    expect((await send("analysis_completed")).status).toBe(400);
    expect((await send("landing_view", "https://evil.test", "cross-site")).status).toBe(403);
    expect((await send("landing_view", "pas une url")).status).toBe(403);
    expect(telemetry.calls).toHaveLength(1);
  });
});

describe("fixture synthétique du dashboard", () => {
  const counts = {
    landing_view: 100, analysis_started: 25, analysis_completed: 20, signup: 8,
    checkout_started: 3, purchase_completed: 2,
  };
  const dashboard: DashboardData = {
    counts,
    // Mission #103 : les lignes écartées parce qu'elles ne viennent pas de la
    // production. Elles ne pèsent sur aucun autre chiffre de cet objet.
    excluded: 218,
    paid_pro: 1,
    granted_pro: 1,
    feedback: { total: 5, fair: 3, not_fair: 2 },
    purchases: { purchases: 2, revenue_eur: 48, revenue_covered: 2 },
    timeseries: [
      { day: "2026-09-22", page_views: 40, analyses: 10, signups: 3, purchases: 1 },
      { day: "2026-09-23", page_views: 60, analyses: 15, signups: 5, purchases: 1 },
    ],
    acquisition: [
      { source: "tiktok", campaign: "launch", content: "video_1_negociation", visits: 70, analyses: 20, signups: 6, purchases: 2 },
      { source: "instagram", campaign: "launch", content: "reel_1", visits: 30, analyses: 5, signups: 2, purchases: 0 },
    ],
  };

  it("reflète exactement 100/25/20/8/3/2, les feedbacks et les deux types de Pro", () => {
    expect(dashboard.timeseries.reduce((sum, row) => sum + row.page_views, 0)).toBe(100);
    expect(dashboard.timeseries.reduce((sum, row) => sum + row.analyses, 0)).toBe(25);
    expect(dashboard.timeseries.reduce((sum, row) => sum + row.signups, 0)).toBe(8);
    expect(dashboard.acquisition.reduce((sum, row) => sum + row.purchases, 0)).toBe(2);
    expect(dashboard).toMatchObject({ counts, paid_pro: 1, granted_pro: 1, feedback: { total: 5, fair: 3, not_fair: 2 } });
    const html = renderToStaticMarkup(<><TimeSeries rows={dashboard.timeseries}/><Funnel data={dashboard}/></>);
    for (const value of ["Visites", ">100<", "Analyses lancées", ">25<", "Analyses terminées", ">20<", "Inscriptions", ">8<", "Checkout", ">3<", "Achats", ">2<"]) expect(html).toContain(value);
  });

  it("les périodes 24 h, 7 j, 30 j et tout ont des bornes exactes", () => {
    const now = new Date("2026-09-23T12:00:00.000Z");
    expect(sinceForPeriod("24h", now)).toBe("2026-09-22T12:00:00.000Z");
    expect(sinceForPeriod("7d", now)).toBe("2026-09-16T12:00:00.000Z");
    expect(sinceForPeriod("30d", now)).toBe("2026-08-24T12:00:00.000Z");
    expect(sinceForPeriod("all", now)).toBeNull();
    expect(parsePeriod("inconnu")).toBe("7d");
  });

  it("les agrégations restent SQL/serveur et séparent payant de grant", () => {
    const sql = readFileSync(path.join(process.cwd(), "supabase/migrations/20260923000030_admin_cockpit.sql"), "utf8").toLowerCase();
    for (const event of Object.keys(counts)) expect(sql).toContain(`'${event}'`);
    expect(sql).toContain("from filtered group by 1,2,3");
    expect(sql).toContain("from public.credits where plan='pro' and period_end > now()");
    expect(sql).toContain("from public.admin_entitlements where entitlement='pro' and source='admin_grant'");
    expect(sql).toContain("offset greatest(p_offset,0) limit least(greatest(p_limit,1),100)");
  });
});

describe("les événements critiques restent placés à leur source serveur", () => {
  const source = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
  it("analyse, inscription, feedback et achat sont instrumentés sans contenu métier", () => {
    const analyse = source("app/api/analyse/route.ts");
    // Mission #108 — les deux événements passent par le même point d'émission,
    // avec le même identifiant de passage. Ce qui compte reste leur PLACE :
    // le lancement avant l'appel au modèle, la fin après le décompte.
    expect(analyse.indexOf('runEvent("analysis_started"')).toBeLessThan(analyse.indexOf("await extractDeal("));
    expect(analyse.indexOf('runEvent("analysis_completed"')).toBeGreaterThan(analyse.indexOf("await grant.commit()"));
    expect(source("lib/auth/sign-in.ts")).toContain('event: "signup"');
    expect(source("app/api/analyses/[id]/avis/route.ts")).toContain('event: "feedback_submitted"');
    expect(source("app/api/whop/webhook/route.ts")).toContain('event: "purchase_completed"');
    const analytics = source("lib/analytics/first-party.ts");
    expect(analytics).not.toMatch(/raw_text|brand_reply|ready_to_send_message/);
    expect(analytics).toContain("insertIfAbsent");
  });
});
