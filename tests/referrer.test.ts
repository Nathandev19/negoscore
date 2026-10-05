import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { normalizeReferrer } from "@/lib/analytics/referrer";

const written = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));
vi.mock("@/lib/supabase/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/server")>()),
  insertIfAbsent: async (_table: string, row: Record<string, unknown>) => { written.rows.push(row); },
}));
vi.mock("@/lib/telemetry/tagged", () => ({
  withEnvironment: async (write: (environment: Record<string, unknown>) => Promise<void>) =>
    write({ environment: "test", internal: false }),
}));

const { parseAttribution, recordProductEvent } = await import("@/lib/analytics/first-party");

const site = "www.negoscore.fr";

describe("domaine du référent", () => {
  it("distingue une arrivée directe, une navigation interne et un site extérieur", () => {
    expect(normalizeReferrer("", site)).toBe("direct");
    expect(normalizeReferrer(null, site)).toBe("direct");
    expect(normalizeReferrer("https://negoscore.fr/tarifs?de=guide", site)).toBe("interne");
    expect(normalizeReferrer("https://www.negoscore.fr/", site)).toBe("interne");
    expect(normalizeReferrer("HTTPS://WWW.EXEMPLE.FR/chemin?secret=oui#ancre", site)).toBe("exemple.fr");
  });

  it.each([
    ["l.instagram.com", "instagram.com"],
    ["lm.instagram.com", "instagram.com"],
    ["m.facebook.com", "facebook.com"],
    ["l.facebook.com", "facebook.com"],
    ["www.google.fr", "google"],
    ["images.google.co.uk", "google"],
    ["t.co", "x.com"],
  ])("regroupe %s vers %s", (input, expected) => {
    expect(normalizeReferrer(`https://${input}/lien?secret=oui`, site)).toBe(expected);
  });

  it("conserve les autres domaines et ne garde jamais l'URL", () => {
    expect(normalizeReferrer("https://M.EXEMPLE.ORG:8443/offre?utm_source=x", site)).toBe("m.exemple.org");
    expect(normalizeReferrer("javascript:alert(1)", site)).toBe("direct");
  });

  it("écrit le nouveau domaine à côté des UTM, sans remplir les anciennes lignes", async () => {
    written.rows = [];
    await recordProductEvent({
      event: "landing_view",
      attribution: parseAttribution({ path: "/", referrer_host: "https://l.instagram.com/secret?token=123", utm_source: " TikTok " }),
    });
    expect(written.rows[0]).toMatchObject({ referrer_host: "instagram.com", referrer_domain: "instagram.com", utm_source: "tiktok" });
    expect(JSON.stringify(written.rows[0])).not.toContain("secret");
    await recordProductEvent({ event: "landing_view", attribution: parseAttribution({ path: "/" }) });
    expect(written.rows[1]).not.toHaveProperty("referrer_domain");
  });

  it("la migration ne reconstitue aucun référent et ne change pas les groupes UTM", () => {
    const sql = readFileSync("supabase/migrations/20261005000038_referrer_domain.sql", "utf8");
    expect(sql).toContain("add column if not exists referrer_domain text default null");
    expect(sql).not.toMatch(/update\s+public\.product_events/i);
    expect(sql).toContain("coalesce(referrer_domain, 'inconnu')");
    expect(sql).toContain("from acquisition_base a");
  });
});
