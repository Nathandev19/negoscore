import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>> }));

vi.mock("@/lib/supabase/server", () => ({
  insertIfAbsent: async (_table: string, row: Record<string, unknown>) => { database.rows.push(row); },
  isMissingColumn: () => false,
}));
vi.mock("@/lib/telemetry/tagged", () => ({
  withEnvironment: async (write: (tag: Record<string, unknown>) => Promise<void>) =>
    write({ environment: "production", internal: false }),
}));

import { recordProductEvent } from "@/lib/analytics/first-party";

beforeEach(() => { database.rows = []; });

describe("l'attribution écrite sur une visite", () => {
  it("ne convertit jamais un objet ou une fonction en contenu UTM", async () => {
    for (const content of [Object.prototype, Object, "[object Object]", "function Object() { [native code] }"]) {
      await recordProductEvent({
        event: "landing_view",
        attribution: { path: "/", utm_source: "tiktok", utm_medium: "paid_social", utm_content: content as string },
      });
    }
    expect(database.rows).toHaveLength(4);
    for (const row of database.rows) {
      expect(row.utm_source).toBe("tiktok");
      expect(row.utm_medium).toBe("paid_social");
      expect(row.utm_content).toBeNull();
    }
  });

  it("garde un contenu propre et compte l'événement", async () => {
    await recordProductEvent({
      event: "landing_view",
      attribution: { path: "/", utm_source: "tiktok", utm_medium: "paid_social", utm_campaign: "lancement", utm_content: "promotion_tiktok" },
    });
    expect(database.rows).toHaveLength(1);
    expect(database.rows[0]).toMatchObject({
      event_name: "landing_view", path: "/", utm_source: "tiktok", utm_medium: "paid_social",
      utm_campaign: "lancement", utm_content: "promotion_tiktok",
    });
  });
});
