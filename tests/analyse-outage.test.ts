import { beforeEach, describe, expect, it, vi } from "vitest";

// Mission #088 — aucune réponse vide sur la route d'analyse. Incident du
// 19/09 : Supabase en 522 pendant la vérification d'idempotence, qui
// s'exécutait hors du filet de la route : 500 sans corps, page blanche au
// premier clic sur « Analyser mon deal ».
//
// La route réelle est appelée ; la base est simulée en panne. Aucun appel au
// modèle : on vérifie justement qu'il n'est jamais atteint.

const calls = vi.hoisted(() => ({ model: 0, guard: 0, reserve: 0, queries: [] as string[] }));
const outage = vi.hoisted(() => ({ error: null as unknown }));

vi.mock("@/lib/llm/extract", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/llm/extract")>()),
  extractDeal: async () => {
    calls.model += 1;
    throw new Error("le modèle ne doit pas être appelé");
  },
}));
vi.mock("@/lib/auth/request-user", () => ({ getRequestUser: async () => null }));
vi.mock("@/lib/security/usage-guard", () => ({
  hitUsageGuard: async () => {
    calls.guard += 1;
    return { allowed: true, count: 1, retryInMinutes: 0 };
  },
  releaseUsageGuard: async () => undefined,
}));
vi.mock("@/lib/billing/entitlement", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/billing/entitlement")>()),
  reserveAnalysis: async () => {
    calls.reserve += 1;
    throw new Error("aucun droit ne doit être réservé");
  },
}));
vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/server")>();
  return {
    ...actual,
    selectRows: async (table: string, query: string) => {
      calls.queries.push(`${table}?${query}`);
      // La vérification d'idempotence : la base ne répond pas.
      if (table === "deals" && query.includes("idempotency_key=")) throw outage.error;
      return [];
    },
  };
});

const { POST } = await import("@/app/api/analyse/route");
const { SupabaseRequestError } = await import("@/lib/supabase/server");

const TEXT = "Bonjour ! On aimerait 2 vidéos TikTok pour notre sérum, 300 € pour le tout, droits pub 6 mois.";
const KEY = "cle-idempotence-0123456789";

function analyse(body: Record<string, unknown>) {
  return POST(
    new Request("http://localhost:3000/api/analyse", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.7" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  calls.model = 0;
  calls.guard = 0;
  calls.reserve = 0;
  calls.queries = [];
  outage.error = new SupabaseRequestError("<html>522: Connection timed out</html>", 522, null);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.stubEnv("IP_HASH_SALT", "sel-de-test");
});

describe("E — la vérification d'idempotence échoue (Supabase en 522)", () => {
  it("un message lisible, jamais une réponse vide", async () => {
    const response = await analyse({ text: TEXT, idempotencyKey: KEY });
    expect(response.status).toBe(503);
    expect(response.headers.get("content-type")).toContain("application/json");
    const body = (await response.json()) as { error?: string; reason?: string };
    expect(body.reason).toBe("service_unavailable");
    // C — une panne passagère, pas une erreur de la personne, et rien n'est pris.
    expect(body.error).toBe("L'analyse est momentanément indisponible. Rien n'a été décompté, réessaie dans quelques minutes.");
  });

  it("B — la route S'ARRÊTE : ni filet horaire, ni droit réservé, ni modèle", async () => {
    await analyse({ text: TEXT, idempotencyKey: KEY });
    expect(calls.queries.some((q) => q.includes("idempotency_key="))).toBe(true);
    expect(calls.guard).toBe(0);
    expect(calls.reserve).toBe(0);
    expect(calls.model).toBe(0);
  });

  it("une panne qui n'est pas une erreur Supabase (réseau coupé) : même message lisible", async () => {
    outage.error = new TypeError("fetch failed");
    const response = await analyse({ text: TEXT, idempotencyKey: KEY });
    expect(response.status).toBe(500);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toContain("momentanément indisponible");
    expect(body.error).toContain("Rien n'a été décompté");
    expect(calls.reserve).toBe(0);
    expect(calls.model).toBe(0);
  });

  it("C — une erreur de la personne garde son propre message, sans parler de panne", async () => {
    const response = await analyse({ text: "trop court", idempotencyKey: KEY });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toBe("Colle au moins 20 caractères du message de la marque.");
    expect(calls.queries).toEqual([]);
  });
});

describe("D — autre étape qui s'exécutait hors du filet : le hachage de l'IP", () => {
  it("sel serveur absent : un message lisible, rien de compté", async () => {
    vi.stubEnv("IP_HASH_SALT", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    outage.error = null;
    const response = await analyse({ text: TEXT });
    expect(response.status).toBe(500);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toContain("momentanément indisponible");
    expect(calls.guard).toBe(0);
    expect(calls.model).toBe(0);
  });
});
