import { beforeEach, describe, expect, it, vi } from "vitest";

// Mission #131 — la lecture des événements ne filtre RIEN.
//
// C'est la propriété qui donne sa valeur à cet écran : une ligne écartée du
// cockpit et une ligne qui n'existe pas se ressemblent beaucoup trop. Si cette
// vue appliquait le même filtre que le cockpit, elle ne pourrait pas servir à
// vérifier que le marquage de #118 et le jeton de mesure de #135 fonctionnent.

const db = vi.hoisted(() => ({
  queries: [] as string[],
  colonnesAbsentes: false,
}));

vi.mock("@/lib/supabase/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/server")>()),
  selectRows: async (table: string, query: string) => {
    db.queries.push(`${table}?${query}`);
    if (db.colonnesAbsentes && query.includes("visitor")) {
      const { SupabaseRequestError } = await import("@/lib/supabase/server");
      throw new SupabaseRequestError("colonne absente", 400, "42703");
    }
    return [];
  },
  countRows: async () => 0,
  rpc: async () => ({ total: 0, items: [] }),
}));

const { loadRecentEvents, RECENT_EVENTS_LIMIT } = await import("@/lib/admin/data");

beforeEach(() => {
  db.queries = [];
  db.colonnesAbsentes = false;
});

describe("les 200 derniers événements", () => {
  it("aucun filtre : les lignes internes et hors production sont là", async () => {
    await loadRecentEvents();
    expect(db.queries).toHaveLength(1);
    const requete = db.queries[0];
    // Ni l'environnement, ni la marque interne ne restreignent la lecture.
    expect(requete).not.toContain("environment=");
    expect(requete).not.toContain("internal=");
    expect(requete).not.toContain("event_name=");
  });

  it("du plus récent au plus ancien, et bornés", async () => {
    await loadRecentEvents();
    expect(db.queries[0]).toContain("order=occurred_at.desc");
    expect(db.queries[0]).toContain(`limit=${RECENT_EVENTS_LIMIT}`);
    expect(RECENT_EVENTS_LIMIT).toBe(200);
  });

  it("une limite hostile est ramenée dans des bornes raisonnables", async () => {
    await loadRecentEvents(100000);
    expect(db.queries[0]).toContain("limit=500");
    db.queries = [];
    await loadRecentEvents(-5);
    expect(db.queries[0]).toContain("limit=1");
  });

  it("ni l'adresse IP ni le user-agent ne sont demandés : ils ne sont pas écrits", async () => {
    await loadRecentEvents();
    expect(db.queries[0]).not.toContain("user_agent");
    expect(db.queries[0]).not.toMatch(/\bip\b/);
  });

  it("colonnes de diagnostic absentes : on sert ce qui existe, et on le dit", async () => {
    db.colonnesAbsentes = true;
    const data = await loadRecentEvents();
    expect(data).not.toBe("missing");
    if (data === "missing") return;
    // Deuxième requête, sans les trois colonnes de la migration.
    expect(db.queries).toHaveLength(2);
    expect(db.queries[1]).not.toContain("visitor");
    expect(data.detail).toBe(false);
  });
});
