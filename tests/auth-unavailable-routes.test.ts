import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mission #089, B, C et E — sur chaque route qui lit la session, une
// authentification injoignable n'est jamais traitée comme une absence de
// session : 503 ou le message de panne de la route, rien de réservé, rien de
// compté, rien de rattaché au navigateur, aucune lecture de la base.

const state = vi.hoisted(() => ({
  session: null as { id: string; email: string } | null | "unavailable",
  db: [] as string[],
  reserved: [] as Array<{ user: unknown; anonToken: unknown; commitAnonToken: unknown }>,
}));

vi.mock("@/lib/auth/request-user", async () => (await import("./helpers/request-session")).requestSessionMock(() => state.session));
vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/server")>();
  const record = (name: string) => async (...args: unknown[]) => {
    state.db.push(`${name}:${String(args[0])}`);
    return name === "insertRow" ? { id: "d1" } : [];
  };
  return { ...actual, selectRows: record("selectRows"), insertRow: record("insertRow"), updateRows: record("updateRows"), upsertRow: record("upsertRow") };
});
vi.mock("@/lib/security/usage-guard", () => ({
  hitUsageGuard: async () => {
    state.db.push("usage_guard");
    return { allowed: true, count: 1, retryInMinutes: 0 };
  },
  releaseUsageGuard: async () => undefined,
}));
vi.mock("@/lib/billing/entitlement", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/billing/entitlement")>()),
  // Réservation observée, puis refusée : on s'arrête là, sans modèle.
  reserveAnalysis: async (owner: { user: unknown; anonToken: unknown; commitAnonToken: unknown }) => {
    state.reserved.push(owner);
    return { allowed: false, reason: "rate_limited", message: "arrêt du test" };
  },
}));
vi.mock("@/lib/analysis/load", () => ({ loadResultForViewer: async () => null }));

const USER = { id: "11111111-1111-4111-8111-111111111111", email: "pro@exemple.test" };
const ID = "22222222-2222-4222-8222-222222222222";
const TEXT = "Bonjour ! On aimerait 2 vidéos TikTok pour notre sérum, 300 € pour le tout, droits pub 6 mois.";
const params = Promise.resolve({ id: ID });
const post = (url: string, body?: unknown, form?: Record<string, string>) =>
  new Request(`http://localhost:3000${url}`, {
    method: "POST",
    headers: form ? {} : { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" },
    body: form ? new URLSearchParams(form) : JSON.stringify(body ?? {}),
  });

beforeEach(() => {
  state.session = null;
  state.db = [];
  state.reserved = [];
  vi.stubEnv("IP_HASH_SALT", "sel-de-test");
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("E — /api/analyse : les trois issues", () => {
  const analyse = async () => (await import("@/app/api/analyse/route")).POST(post("/api/analyse", { text: TEXT }));

  it("session valide : comme aujourd'hui, l'analyse est réservée sur le compte", async () => {
    state.session = USER;
    const response = await analyse();
    expect(state.reserved).toEqual([{ user: USER, anonToken: null, commitAnonToken: null, ip: "203.0.113.9" }]);
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("pas de session : comme aujourd'hui, visiteuse anonyme, jeton posé sur le navigateur", async () => {
    state.session = null;
    const response = await analyse();
    expect(state.reserved).toHaveLength(1);
    expect(state.reserved[0].user).toBeNull();
    expect(state.reserved[0].commitAnonToken).toEqual(expect.any(String));
    expect(response.headers.getSetCookie().some((c) => c.startsWith("deal_anon_token="))).toBe(true);
  });

  it("B — authentification injoignable : 503, message de panne, rien de réservé ni compté, rien rattaché au navigateur", async () => {
    state.session = "unavailable";
    const response = await analyse();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "L'analyse est momentanément indisponible. Rien n'a été décompté, réessaie dans quelques minutes.",
      reason: "service_unavailable",
    });
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(state.reserved).toEqual([]);
    expect(state.db).toEqual([]);
  });
});

describe("E — /api/analyses/[id]/tours : les trois issues", () => {
  const tour = async () => (await import("@/app/api/analyses/[id]/tours/route")).POST(post(`/api/analyses/${ID}/tours`, { reply: "ok pour nous", tier: "starter" }), { params });

  it("session valide : la route continue (analyse lue)", async () => {
    state.session = USER;
    const response = await tour();
    expect(response.status).toBe(404);
  });

  it("pas de session : « Connecte-toi », comme aujourd'hui", async () => {
    state.session = null;
    const response = await tour();
    expect(response.status).toBe(401);
    expect(((await response.json()) as { error: string }).error).toBe("Connecte-toi pour suivre l'échange avec la marque.");
  });

  it("B — injoignable : 503 et le message de panne du suivi, jamais « Connecte-toi »", async () => {
    state.session = "unavailable";
    const response = await tour();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Le suivi de l'échange n'est pas disponible pour le moment. Réessaie plus tard.", reason: "unavailable" });
    expect(state.db).toEqual([]);
  });
});

describe("C — les autres routes corrigées, pendant une panne d'authentification", () => {
  beforeEach(() => {
    state.session = "unavailable";
  });
  // Aucune de ces routes ne lit ni n'écrit la base, ni ne compte quoi que ce
  // soit, quand on ne sait pas qui fait la demande.
  afterEach(() => {
    expect(state.db).toEqual([]);
  });

  it("conclusion : 503, pas « Connecte-toi pour conclure »", async () => {
    const { POST } = await import("@/app/api/analyses/[id]/conclusion/route");
    const response = await POST(post(`/api/analyses/${ID}/conclusion`, { tier: "starter" }), { params });
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("Connecte-toi");
  });

  it("avis : 503, pas « Analyse introuvable »", async () => {
    const { POST } = await import("@/app/api/analyses/[id]/avis/route");
    const response = await POST(post(`/api/analyses/${ID}/avis`, { rating: "fair", tier: "starter" }), { params });
    expect(response.status).toBe(503);
    expect(((await response.json()) as { error: string }).error).toBe("Ton avis n'a pas pu être enregistré pour le moment. Réessaie plus tard.");
  });

  it("suppression d'une analyse : la page de confirmation dit « indisponible », pas « introuvable »", async () => {
    const { POST } = await import("@/app/api/analyses/[id]/supprimer/route");
    const response = await POST(post(`/api/analyses/${ID}/supprimer`, undefined, { confirmation: "oui" }), { params });
    expect(response.headers.get("location")).toBe(`/analyse/resultat/${ID}/supprimer?erreur=indisponible`);
  });

  it("paiement : « le paiement n'est pas disponible », pas la page de connexion", async () => {
    const { POST } = await import("@/app/api/checkout/route");
    const response = await POST(post("/api/checkout", undefined, { plan: "pack", consent: "on" }));
    expect(response.headers.get("location")).toBe("/tarifs?erreur=indisponible");
  });

  it("suppression du compte : « indisponible », pas la page de connexion", async () => {
    const { POST } = await import("@/app/api/compte/supprimer/route");
    const response = await POST(post("/api/compte/supprimer", undefined, { confirmation: "SUPPRIMER" }));
    expect(response.headers.get("location")).toBe("/compte/supprimer?erreur=indisponible");
  });

  it("résiliation : « indisponible », pas la page de connexion", async () => {
    const { POST } = await import("@/app/api/resilier/route");
    const response = await POST(post("/api/resilier", undefined, {}));
    expect(response.headers.get("location")).toBe("/resilier?erreur=indisponible");
  });

  it("crédits : 503 (« illisible » pour la page), pas 401 (« visiteuse »)", async () => {
    const { GET } = await import("@/app/api/credits/route");
    const response = await GET(new Request("http://localhost:3000/api/credits"));
    expect(response.status).toBe(503);
  });

  it("droit d'analyser : inconnu, le formulaire reste ouvert, jamais « plus d'analyse gratuite »", async () => {
    const { GET } = await import("@/app/api/droits/route");
    const response = await GET(new Request("http://localhost:3000/api/droits"));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ allowed: true, unknown: true });
  });

  it("dépôt de fichier : 503, rien rattaché au navigateur", async () => {
    const { POST } = await import("@/app/api/upload-url/route");
    const response = await POST(post("/api/upload-url", { kind: "pdf", mime: "application/pdf", bytes: 1000 }));
    expect(response.status).toBe(503);
    expect(response.headers.getSetCookie()).toEqual([]);
  });

});
