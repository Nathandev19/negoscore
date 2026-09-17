import { beforeEach, describe, expect, it, vi } from "vitest";
import sample from "@/lib/fixtures/analysis-legacy-1.0.json";

// « Cette estimation te paraît juste ? » : réservé au propriétaire, une ligne
// par analyse (modifiable), aucune donnée personnelle ni texte d'offre.

const db = vi.hoisted(() => ({
  analyses: new Map<string, { payload: unknown; deal: Record<string, unknown> }>(),
  writes: [] as Array<{ table: string; row: Record<string, unknown>; onConflict: string }>,
  missing: false,
}));
const user = vi.hoisted(() => ({ current: null as { id: string; email: string } | null }));

vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/server")>();
  return {
    ...actual,
    selectRows: async (table: string, query: string) => {
      if (table !== "analyses") return [];
      const row = db.analyses.get(query.match(/id=eq\.([^&]+)/)?.[1] ?? "");
      return row ? [row] : [];
    },
    upsertRow: async (table: string, row: Record<string, unknown>, onConflict: string) => {
      if (db.missing) throw new actual.SupabaseRequestError("table absente", 404, "PGRST205");
      db.writes.push({ table, row, onConflict });
    },
  };
});
vi.mock("@/lib/auth/request-user", () => ({ getRequestUser: async () => user.current }));

const { POST } = await import("@/app/api/analyses/[id]/avis/route");

const ANON_ID = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_ID = "22222222-2222-4222-8222-222222222222";
const MISSING_ID = "44444444-4444-4444-8444-444444444444";
const OWNER_TOKEN = "jeton-du-navigateur-auteur";

beforeEach(() => {
  db.analyses.clear();
  db.writes = [];
  db.missing = false;
  user.current = null;
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  db.analyses.set(ANON_ID, { payload: sample, deal: { id: "d1", anon_token: OWNER_TOKEN, user_id: null, source_type: "text", raw_text: "Bonjour, Camille de Maison Ortie", deal_documents: [] } });
  db.analyses.set(ACCOUNT_ID, { payload: sample, deal: { id: "d2", anon_token: null, user_id: "user-a", source_type: "text", raw_text: "x", deal_documents: [] } });
});

function post(id: string, cookie: string | null, body: unknown) {
  return POST(
    new Request(`http://localhost:3000/api/analyses/${id}/avis`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

const OWNER = `deal_anon_token=${OWNER_TOKEN}`;

describe("enregistrement de l'avis", () => {
  it("le propriétaire : une ligne par analyse, avec la version de la table, le score et la fourchette", async () => {
    const response = await post(ANON_ID, OWNER, { rating: "too_high", comment: "  La marque paie 400 € d'habitude.  " });
    expect(response.status).toBe(200);
    expect(db.writes).toEqual([
      {
        table: "analysis_feedback",
        onConflict: "analysis_id",
        row: {
          analysis_id: ANON_ID,
          rating: "too_high",
          comment: "La marque paie 400 € d'habitude.",
          rate_table_version: "demo-2026-09",
          score: 32,
          total_low: 510,
          total_high: 1100,
          updated_at: expect.any(String),
        },
      },
    ]);
  });

  it("modifiable : un second envoi remplace le premier (même clé de conflit)", async () => {
    await post(ANON_ID, OWNER, { rating: "fair" });
    await post(ANON_ID, OWNER, { rating: "too_low", comment: "" });
    expect(db.writes.map((w) => [w.row.analysis_id, w.row.rating, w.row.comment, w.onConflict])).toEqual([
      [ANON_ID, "fair", null, "analysis_id"],
      [ANON_ID, "too_low", null, "analysis_id"],
    ]);
  });

  it("aucune donnée personnelle ni texte d'offre dans la ligne", async () => {
    await post(ANON_ID, OWNER, { rating: "fair" });
    const row = db.writes[0].row;
    expect(Object.keys(row).sort()).toEqual(
      ["analysis_id", "comment", "rate_table_version", "rating", "score", "total_high", "total_low", "updated_at"].sort(),
    );
    const serialized = JSON.stringify(row);
    for (const forbidden of ["Marque Exemple", "Camille", "Ortie", OWNER_TOKEN, "user-a"]) expect(serialized).not.toContain(forbidden);
  });

  it("réponse invalide ou commentaire de plus de 200 caractères : refusé, rien n'est écrit", async () => {
    expect((await post(ANON_ID, OWNER, { rating: "parfait" })).status).toBe(400);
    expect((await post(ANON_ID, OWNER, { rating: "fair", comment: "x".repeat(201) })).status).toBe(400);
    expect((await post(ANON_ID, OWNER, null)).status).toBe(400);
    expect(db.writes).toEqual([]);
  });

  it("table absente (migration 016 non appliquée) : 503 et message honnête", async () => {
    db.missing = true;
    const response = await post(ANON_ID, OWNER, { rating: "fair" });
    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain("n'a pas pu être enregistré");
  });
});

describe("accès : réservé à la personne qui a lancé l'analyse", () => {
  it("autre visiteur, sans cookie, identifiant inexistant : introuvable, rien n'est écrit", async () => {
    expect((await post(ANON_ID, "deal_anon_token=un-autre", { rating: "fair" })).status).toBe(404);
    expect((await post(ANON_ID, null, { rating: "fair" })).status).toBe(404);
    expect((await post(MISSING_ID, OWNER, { rating: "fair" })).status).toBe(404);
    expect(db.writes).toEqual([]);
  });

  it("analyse rattachée à un compte : seul ce compte peut répondre", async () => {
    user.current = { id: "user-b", email: "b@example.com" };
    expect((await post(ACCOUNT_ID, null, { rating: "fair" })).status).toBe(404);
    user.current = { id: "user-a", email: "a@example.com" };
    expect((await post(ACCOUNT_ID, null, { rating: "fair" })).status).toBe(200);
    expect(db.writes).toHaveLength(1);
  });
});
