import { beforeEach, describe, expect, it, vi } from "vitest";

// Mission #068, partie C — la suppression de compte emporte les réclamations
// de connexion en cours à l'adresse du compte, et seulement celles-là.

type Claim = { id: string; email: string };

const db = vi.hoisted(() => ({ claims: [] as Claim[], order: [] as string[] }));

vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/server")>();
  return {
    ...actual,
    selectRows: async (table: string) => (table === "credits" ? [{ plan: "free", balance: 0, period_end: null, cancelled_at: null }] : []),
    countRows: async () => 0,
    removeDocuments: async () => [],
    rpc: async () => true,
    deleteRows: async (table: string) => void db.order.push(table),
    deleteRowsReturning: async (table: string, filter: string) => {
      db.order.push(table);
      if (table !== "login_claims") return [];
      const email = decodeURIComponent(filter.match(/email=eq\.([^&]*)/)?.[1] ?? "");
      const hit = db.claims.filter((c) => c.email === email);
      db.claims = db.claims.filter((c) => !hit.includes(c));
      return hit.map((c) => c.id);
    },
    deleteAuthUser: async () => void db.order.push("auth.users"),
  };
});
vi.mock("@/lib/billing/free-usage", () => ({ deleteFreeUsage: async () => undefined }));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  signOut: async () => undefined,
}));

const { deleteAccount } = await import("@/lib/account/deletion");

beforeEach(() => {
  db.claims = [
    { id: "c1", email: "nina@exemple.test" },
    { id: "c2", email: "nina@exemple.test" },
    { id: "c3", email: "malo@exemple.test" },
  ];
  db.order = [];
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

describe("suppression de compte et réclamations de connexion", () => {
  it("toutes les réclamations de l'adresse partent avec le compte, celles des autres restent", async () => {
    const result = await deleteAccount({ id: "u-nina", email: "Nina@Exemple.test" }, null);
    expect(result).toMatchObject({ deleted: true });
    expect(db.claims.map((c) => c.id)).toEqual(["c3"]);
    // Avant la suppression de l'identité : si elle échoue, rien n'est perdu à moitié.
    expect(db.order.indexOf("login_claims")).toBeLessThan(db.order.indexOf("auth.users"));
  });
});
