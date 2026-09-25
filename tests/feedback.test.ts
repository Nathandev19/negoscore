import { beforeEach, describe, expect, it, vi } from "vitest";
import sample from "@/lib/fixtures/analysis-legacy-1.0.json";
import { sampleAnalysis } from "@/lib/sample-analysis";
import { recomputeForTier } from "@/lib/analysis/recompute";

// « Cette estimation te paraît juste ? » : réservé au propriétaire, une ligne
// par analyse (modifiable), aucune donnée personnelle ni texte d'offre.

const db = vi.hoisted(() => ({
  analyses: new Map<string, { payload: unknown; deal: Record<string, unknown> }>(),
  writes: [] as Array<{ table: string; row: Record<string, unknown>; onConflict: string }>,
  missing: false,
  missingColumn: false,
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
      if (db.missingColumn) throw new actual.SupabaseRequestError("colonne absente", 400, "PGRST204");
      db.writes.push({ table, row, onConflict });
    },
  };
});
vi.mock("@/lib/auth/request-user", async () => (await import("./helpers/request-session")).requestSessionMock(() => user.current));

const { POST } = await import("@/app/api/analyses/[id]/avis/route");

const ANON_ID = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_ID = "22222222-2222-4222-8222-222222222222";
const CURRENT_ID = "33333333-3333-4333-8333-333333333333";
const MISSING_ID = "44444444-4444-4444-8444-444444444444";
const OWNER_TOKEN = "jeton-du-navigateur-auteur";

beforeEach(() => {
  db.analyses.clear();
  db.writes = [];
  db.missing = false;
  db.missingColumn = false;
  user.current = null;
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  db.analyses.set(ANON_ID, { payload: sample, deal: { id: "d1", anon_token: OWNER_TOKEN, user_id: null, source_type: "text", raw_text: "Bonjour, Camille de Maison Ortie", deal_documents: [] } });
  db.analyses.set(CURRENT_ID, { payload: sampleAnalysis, deal: { id: "d3", anon_token: OWNER_TOKEN, user_id: null, source_type: "text", raw_text: "x", deal_documents: [] } });
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
    const response = await post(ANON_ID, OWNER, { rating: "too_high", comment: "  La marque paie 400 € d'habitude.  ", tier: "confirmed" });
    expect(response.status).toBe(200);
    expect(db.writes).toEqual([
      {
        table: "analysis_feedback",
        // Mission #086 : un avis par analyse ET par tour.
        onConflict: "analysis_id,turn_number",
        row: {
          analysis_id: ANON_ID,
          rating: "too_high",
          comment: "La marque paie 400 € d'habitude.",
          rate_table_version: "demo-2026-09",
          profile_tier: "confirmed",
          // Mission #086 : l'offre d'origine (aucun tour envoyé).
          turn_number: 0,
          turn_recorded: true,
          score: 32,
          total_low: 510,
          total_high: 1100,
          updated_at: expect.any(String),
          // Mission #103 — d'où vient ce retour, décidé par le serveur. Ce
          // test tourne dans vitest : la valeur est donc « test », et le
          // cockpit, qui ne compte que « production », l'ignorera.
          environment: "test",
          // Mission #118 — et de qui. Aucun cookie interne dans cette requête,
          // aucun compte interne configuré : ce retour compte comme celui d'un
          // visiteur.
          internal: false,
        },
      },
    ]);
  });

  it("modifiable : un second envoi sur le même tour remplace le premier (même clé de conflit)", async () => {
    await post(ANON_ID, OWNER, { rating: "fair", tier: "confirmed" });
    await post(ANON_ID, OWNER, { rating: "too_low", comment: "", tier: "confirmed" });
    expect(db.writes.map((w) => [w.row.analysis_id, w.row.rating, w.row.comment, w.onConflict])).toEqual([
      [ANON_ID, "fair", null, "analysis_id,turn_number"],
      [ANON_ID, "too_low", null, "analysis_id,turn_number"],
    ]);
  });

  it("aucune donnée personnelle ni texte d'offre dans la ligne", async () => {
    await post(ANON_ID, OWNER, { rating: "fair", tier: "confirmed" });
    const row = db.writes[0].row;
    expect(Object.keys(row).sort()).toEqual(
      ["analysis_id", "comment", "environment", "internal", "profile_tier", "rate_table_version", "rating", "score", "total_high", "total_low", "turn_number", "turn_recorded", "updated_at"].sort(),
    );
    const serialized = JSON.stringify(row);
    for (const forbidden of ["Marque Exemple", "Camille", "Ortie", OWNER_TOKEN, "user-a"]) expect(serialized).not.toContain(forbidden);
  });

  it("réponse invalide ou commentaire de plus de 200 caractères : refusé, rien n'est écrit", async () => {
    expect((await post(ANON_ID, OWNER, { rating: "parfait", tier: "confirmed" })).status).toBe(400);
    expect((await post(ANON_ID, OWNER, { rating: "fair", comment: "x".repeat(201), tier: "confirmed" })).status).toBe(400);
    expect((await post(ANON_ID, OWNER, null)).status).toBe(400);
    expect(db.writes).toEqual([]);
  });

  it("B4 — sans niveau, ou niveau inconnu : refusé, rien n'est écrit", async () => {
    expect((await post(CURRENT_ID, OWNER, { rating: "fair" })).status).toBe(400);
    expect((await post(CURRENT_ID, OWNER, { rating: "fair", tier: "nano" })).status).toBe(400);
    expect(db.writes).toEqual([]);
  });

  it("B4 — le niveau envoyé est enregistré, avec les chiffres recalculés à ce niveau par le serveur", async () => {
    // L'exemple est calculé au niveau par défaut (starter depuis fr-2026.3) : l'avis
    // porte sur un autre niveau, confirmé, dont la fourchette est plus haute.
    const expected = recomputeForTier(sampleAnalysis, "confirmed");
    expect(expected.estimate.total_low).toBeGreaterThan(sampleAnalysis.estimate.total_low!);
    expect((await post(CURRENT_ID, OWNER, { rating: "too_high", tier: "confirmed" })).status).toBe(200);
    expect(db.writes[0].row).toMatchObject({
      profile_tier: "confirmed",
      score: expected.score?.value,
      total_low: expected.estimate.total_low,
      total_high: expected.estimate.total_high,
    });
  });

  it("B4 — analyse calculée avec une ancienne table : le niveau enregistré est celui de ses chiffres", async () => {
    await post(ANON_ID, OWNER, { rating: "fair", tier: "experienced" });
    expect(db.writes[0].row).toMatchObject({ profile_tier: "confirmed", total_low: 510, total_high: 1100 });
  });

  it("colonne profile_tier absente (migration 017 non appliquée) : 503, jamais un avis sans niveau", async () => {
    db.missingColumn = true;
    const response = await post(CURRENT_ID, OWNER, { rating: "fair", tier: "starter" });
    expect(response.status).toBe(503);
    expect(db.writes).toEqual([]);
  });

  it("table absente (migration 016 non appliquée) : 503 et message honnête", async () => {
    db.missing = true;
    const response = await post(ANON_ID, OWNER, { rating: "fair", tier: "confirmed" });
    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain("n'a pas pu être enregistré");
  });
});

describe("accès : réservé à la personne qui a lancé l'analyse", () => {
  it("autre visiteur, sans cookie, identifiant inexistant : introuvable, rien n'est écrit", async () => {
    expect((await post(ANON_ID, "deal_anon_token=un-autre", { rating: "fair", tier: "confirmed" })).status).toBe(404);
    expect((await post(ANON_ID, null, { rating: "fair", tier: "confirmed" })).status).toBe(404);
    expect((await post(MISSING_ID, OWNER, { rating: "fair", tier: "confirmed" })).status).toBe(404);
    expect(db.writes).toEqual([]);
  });

  it("analyse rattachée à un compte : seul ce compte peut répondre", async () => {
    user.current = { id: "user-b", email: "b@example.com" };
    expect((await post(ACCOUNT_ID, null, { rating: "fair", tier: "confirmed" })).status).toBe(404);
    user.current = { id: "user-a", email: "a@example.com" };
    expect((await post(ACCOUNT_ID, null, { rating: "fair", tier: "confirmed" })).status).toBe(200);
    expect(db.writes).toHaveLength(1);
  });
});
