import { beforeEach, describe, expect, it, vi } from "vitest";

// Logique de la purge, sans réseau : les requêtes Supabase sont enregistrées
// pour vérifier exactement ce qui serait supprimé.
const db = vi.hoisted(() => ({
  selects: [] as string[],
  deletes: [] as Array<{ table: string; filter: string }>,
  removed: [] as string[][],
  missingReceivedAt: false,
}));

vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/server")>();
  return {
    ...actual,
    selectRows: async (table: string, query: string) => {
      db.selects.push(`${table}?${query}`);
      return [];
    },
    removeDocuments: async (paths: string[]) => {
      db.removed.push(paths);
      return paths;
    },
    deleteRowsReturning: async (table: string, filter: string) => {
      if (db.missingReceivedAt && filter.includes("received_at")) {
        throw new actual.SupabaseRequestError(
          "suppression whop_events : HTTP 400 column whop_events.received_at does not exist",
          400,
          "42703",
        );
      }
      db.deletes.push({ table, filter });
      return [];
    },
  };
});

const { runPurge, scopeFilter, whopEventsExpiredFilter } = await import("@/lib/privacy/purge");
const NOW = new Date("2026-09-17T03:00:00.000Z");

beforeEach(() => {
  db.selects = [];
  db.deletes = [];
  db.removed = [];
  db.missingReceivedAt = false;
});

describe("portée de la purge", () => {
  it("sans portée : toute la base, comportement de production", async () => {
    await runPurge(NOW);
    expect(db.selects).toHaveLength(1);
    expect(db.selects[0]).not.toContain("id=in.");
    expect(db.deletes.map((d) => d.table)).toEqual(["usage_guard", "whop_events", "checkout_consents"]);
    for (const { filter } of db.deletes) expect(filter).not.toMatch(/(^|&)(id|event_id)=in\./);
  });

  it("avec portée : chaque requête est limitée aux lignes désignées", async () => {
    await runPurge(NOW, {
      documentIds: ["d1", "d2"],
      usageGuardIds: ["g1"],
      whopEventIds: ["msg_1"],
      consentIds: ["c1"],
    });
    expect(db.selects[0]).toContain('&id=in.("d1","d2")');
    const byTable = Object.fromEntries(db.deletes.map((d) => [d.table, d.filter]));
    expect(byTable.usage_guard).toContain('&id=in.("g1")');
    expect(byTable.whop_events).toContain('&event_id=in.("msg_1")');
    expect(byTable.checkout_consents).toContain('&id=in.("c1")');
  });

  it("une catégorie absente de la portée, ou vide, n'est pas purgée du tout", async () => {
    await runPurge(NOW, { documentIds: [] });
    expect(db.selects).toEqual([]);
    expect(db.deletes).toEqual([]);
    expect(scopeFilter({}, undefined, "id")).toBeNull();
    expect(scopeFilter(undefined, undefined, "id")).toBe("");
  });

  it("jamais de requête sur deals ni analyses", async () => {
    await runPurge(NOW);
    await runPurge(NOW, { documentIds: ["d"], usageGuardIds: ["g"], whopEventIds: ["e"], consentIds: ["c"] });
    for (const query of [...db.selects, ...db.deletes.map((d) => d.table)]) {
      expect(query).not.toMatch(/^(deals|analyses)\b/);
    }
  });
});

describe("événements Whop", () => {
  it("échus selon coalesce(processed_at, received_at)", () => {
    const filter = decodeURIComponent(whopEventsExpiredFilter("2021-09-17T03:00:00.000Z"));
    expect(filter).toBe(
      'or=(processed_at.lt."2021-09-17T03:00:00.000Z",and(processed_at.is.null,received_at.lt."2021-09-17T03:00:00.000Z"))',
    );
  });

  it("colonne received_at absente : la purge ne casse pas, retombe sur processed_at et le signale", async () => {
    db.missingReceivedAt = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const report = await runPurge(NOW);
    expect(report.whop_events).toBe(0);
    const whop = db.deletes.find((d) => d.table === "whop_events");
    expect(whop?.filter).toContain("processed_at=lt.");
    expect(whop?.filter).not.toContain("received_at");
    expect(JSON.parse(String(warn.mock.calls[0][0]))).toMatchObject({ event: "purge_whop_received_at_missing" });
    expect(db.deletes.some((d) => d.table === "checkout_consents")).toBe(true);
    warn.mockRestore();
  });
});
