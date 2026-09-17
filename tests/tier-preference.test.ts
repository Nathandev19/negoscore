import { beforeEach, describe, expect, it, vi } from "vitest";

// A4 — le niveau choisi est mémorisé pour les analyses suivantes : sur le compte
// (autre appareil) et dans un cookie du navigateur (avec ou sans compte).

const db = vi.hoisted(() => ({
  rateTier: null as string | null,
  missingColumn: false,
  updates: [] as Array<{ table: string; filter: string; patch: Record<string, unknown> }>,
}));
const user = vi.hoisted(() => ({ current: null as { id: string; email: string } | null }));

vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/server")>();
  return {
    ...actual,
    selectRows: async (table: string) => {
      if (db.missingColumn) throw new actual.SupabaseRequestError("colonne absente", 400, "42703");
      return table === "profiles" ? [{ rate_tier: db.rateTier }] : [];
    },
    updateRows: async (table: string, filter: string, patch: Record<string, unknown>) => {
      if (db.missingColumn) throw new actual.SupabaseRequestError("colonne absente", 400, "PGRST204");
      db.updates.push({ table, filter, patch });
      return [];
    },
  };
});
vi.mock("@/lib/auth/request-user", () => ({ getRequestUser: async () => user.current }));

const { preferredTier } = await import("@/lib/rates/tier-preference");
const { POST } = await import("@/app/api/niveau/route");

const ACCOUNT = { id: "user-a", email: "a@example.com" };

function request(cookie: string | null, body?: unknown) {
  return new Request("http://localhost:3000/api/niveau", {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  db.rateTier = null;
  db.missingColumn = false;
  db.updates = [];
  user.current = null;
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("niveau utilisé pour une nouvelle analyse", () => {
  it("sans choix : le défaut de la table", async () => {
    expect(await preferredTier(request(null), null)).toBe("confirmed");
  });

  it("visiteur anonyme : le cookie du navigateur", async () => {
    expect(await preferredTier(request("negoscore_niveau=starter"), null)).toBe("starter");
  });

  it("cookie trafiqué : ignoré", async () => {
    expect(await preferredTier(request("negoscore_niveau=nano"), null)).toBe("confirmed");
  });

  it("compte : le niveau du compte passe avant le cookie", async () => {
    db.rateTier = "experienced";
    expect(await preferredTier(request("negoscore_niveau=starter"), ACCOUNT)).toBe("experienced");
  });

  it("compte sans niveau enregistré : le cookie", async () => {
    expect(await preferredTier(request("negoscore_niveau=starter"), ACCOUNT)).toBe("starter");
  });

  it("colonne absente (migration 017 non appliquée) : le cookie, sans bloquer l'analyse", async () => {
    db.missingColumn = true;
    expect(await preferredTier(request("negoscore_niveau=starter"), ACCOUNT)).toBe("starter");
  });
});

describe("/api/niveau", () => {
  it("compte connecté : le niveau est enregistré sur son profil, et rien d'autre", async () => {
    user.current = ACCOUNT;
    expect((await POST(request(null, { tier: "starter" }))).status).toBe(204);
    expect(db.updates).toEqual([{ table: "profiles", filter: "id=eq.user-a", patch: { rate_tier: "starter" } }]);
  });

  it("sans compte : rien n'est écrit (le cookie suffit)", async () => {
    expect((await POST(request(null, { tier: "starter" }))).status).toBe(204);
    expect(db.updates).toEqual([]);
  });

  it("niveau inconnu : refusé", async () => {
    user.current = ACCOUNT;
    expect((await POST(request(null, { tier: "nano" }))).status).toBe(400);
    expect((await POST(request(null))).status).toBe(400);
    expect(db.updates).toEqual([]);
  });

  it("colonne absente : 503, sans erreur non gérée", async () => {
    user.current = ACCOUNT;
    db.missingColumn = true;
    expect((await POST(request(null, { tier: "starter" }))).status).toBe(503);
  });
});
