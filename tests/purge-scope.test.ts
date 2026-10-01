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
    // login_claims : réclamations de connexion expirées (mission #067).
    // telemetry_salts : le sel d'avant-hier (mission #131). Une fois détruit,
    // les empreintes de ce jour-là ne peuvent plus être reliées à rien.
    expect(db.deletes.map((d) => d.table)).toEqual([
      "usage_guard",
      "deals",
      "whop_events",
      "checkout_consents",
      "login_claims",
      "telemetry_salts",
    ]);
    for (const { filter } of db.deletes) expect(filter).not.toMatch(/(^|&)(id|event_id)=in\./);
    // Texte des offres, réponses de marque collées (mission #080), puis les
    // trois colonnes de diagnostic de plus d'une semaine (mission #131).
    expect(db.updates.map((u) => u.table)).toEqual(["deals", "negotiation_turns", "product_events"]);
    for (const update of db.updates) expect(update.filter).not.toContain("id=in.");
  });

  it("mission #131 : le diagnostic des événements s'efface au bout d'une semaine", async () => {
    await runPurge(NOW);
    const diagnostic = db.updates.find((u) => u.table === "product_events");
    // Les trois colonnes partent ensemble : une empreinte sans sa famille de
    // navigateur ne répond plus à la question qu'on lui posait.
    expect(diagnostic?.patch).toEqual({ visitor: null, internal_reason: null, agent_family: null });
    expect(diagnostic?.filter).toContain("visitor=not.is.null");
    expect(decodeURIComponent(diagnostic?.filter ?? "")).toContain("occurred_at=lt.2026-09-10T03:00:00.000Z");
    // La LIGNE reste : les compteurs du cockpit ne lisent aucune de ces trois
    // colonnes, et effacer l'événement changerait les chiffres.
    expect(db.deletes.map((d) => d.table)).not.toContain("product_events");
    // Le sel, lui, est supprimé, pas vidé.
    const sels = db.deletes.find((d) => d.table === "telemetry_salts");
    expect(decodeURIComponent(sels?.filter ?? "")).toContain("day=lt.2026-09-15");
  });

  it("mission #080 : réponses de marque collées effacées au bout de 30 jours, le tour reste", async () => {
    await runPurge(NOW);
    const replies = db.updates.find((u) => u.table === "negotiation_turns");
    expect(replies?.patch).toEqual({ brand_reply: null });
    expect(replies?.filter).toContain("brand_reply=not.is.null");
    expect(decodeURIComponent(replies?.filter ?? "")).toContain("created_at=lt.2026-08-19T03:00:00.000Z");
    expect(db.deletes.map((d) => d.table)).not.toContain("negotiation_turns");
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

  // Mission #061 : les deals SANS COMPTE de plus de 30 jours sont supprimés,
  // avec leur analyse en cascade. Tout le reste est inchangé : aucune analyse
  // n'est supprimée directement, et un deal rattaché à un compte n'est jamais
  // touché — seul son texte collé est effacé.
  it("seuls les deals sans compte sont supprimés, jamais la table des analyses", async () => {
    await runPurge(NOW);
    await runPurge(NOW, { documentIds: ["d"], sourceTextDealIds: ["t"], usageGuardIds: ["g"], whopEventIds: ["e"], consentIds: ["c"] });
    for (const query of [...db.selects, ...db.deletes.map((d) => d.table)]) {
      expect(query).not.toMatch(/^analyses\b/);
    }
    const dealsSupprimes = db.deletes.filter((d) => d.table === "deals");
    // Premier appel sans portée : une suppression. Second appel : la catégorie
    // n'est pas dans la portée, donc rien.
    expect(dealsSupprimes).toHaveLength(1);
    expect(dealsSupprimes[0].filter).toContain("user_id=is.null");
    expect(decodeURIComponent(dealsSupprimes[0].filter)).toContain("created_at=lt.2026-08-19T03:00:00.000Z");
    // product_events : la purge du diagnostic (#131) n'a pas de portée, elle
    // ne part donc qu'au premier appel.
    const dealUpdates = db.updates.filter((u) => u.table === "deals");
    expect(dealUpdates).toHaveLength(2);
    for (const update of dealUpdates) {
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
