import { beforeEach, describe, expect, it, vi } from "vitest";

// Logique de la purge, sans réseau : les requêtes Supabase sont enregistrées
// pour vérifier exactement ce qui serait supprimé.
const db = vi.hoisted(() => ({
  selects: [] as string[],
  deletes: [] as Array<{ table: string; filter: string }>,
  updates: [] as Array<{ table: string; filter: string; patch: Record<string, unknown> }>,
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
    updateRows: async (table: string, filter: string, patch: Record<string, unknown>) => {
      db.updates.push({ table, filter, patch });
      return [];
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
  db.updates = [];
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
    expect(db.updates).toHaveLength(1);
    expect(db.updates[0].filter).not.toContain("id=in.");
  });

  it("avec portée : chaque requête est limitée aux lignes désignées", async () => {
    await runPurge(NOW, {
      documentIds: ["d1", "d2"],
      sourceTextDealIds: ["t1"],
      usageGuardIds: ["g1"],
      whopEventIds: ["msg_1"],
      consentIds: ["c1"],
    });
    expect(db.selects[0]).toContain('&id=in.("d1","d2")');
    const byTable = Object.fromEntries(db.deletes.map((d) => [d.table, d.filter]));
    expect(byTable.usage_guard).toContain('&id=in.("g1")');
    expect(byTable.whop_events).toContain('&event_id=in.("msg_1")');
    expect(byTable.checkout_consents).toContain('&id=in.("c1")');
    expect(db.updates[0].filter).toContain('&id=in.("t1")');
  });

  it("une catégorie absente de la portée, ou vide, n'est pas purgée du tout", async () => {
    await runPurge(NOW, { documentIds: [] });
    expect(db.selects).toEqual([]);
    expect(db.deletes).toEqual([]);
    expect(db.updates).toEqual([]);
    expect(scopeFilter({}, undefined, "id")).toBeNull();
    expect(scopeFilter(undefined, undefined, "id")).toBe("");
  });

  it("jamais de suppression de deals ni d'analyses : seul le texte collé est effacé", async () => {
    await runPurge(NOW);
    await runPurge(NOW, { documentIds: ["d"], sourceTextDealIds: ["t"], usageGuardIds: ["g"], whopEventIds: ["e"], consentIds: ["c"] });
    for (const query of [...db.selects, ...db.deletes.map((d) => d.table)]) {
      expect(query).not.toMatch(/^(deals|analyses)\b/);
    }
    expect(db.updates).toHaveLength(2);
    for (const update of db.updates) {
      expect(update.table).toBe("deals");
      expect(update.patch).toEqual({ raw_text: null });
      expect(update.filter).toContain("raw_text=not.is.null");
      expect(decodeURIComponent(update.filter)).toContain("created_at=lt.2026-08-19T03:00:00.000Z");
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
