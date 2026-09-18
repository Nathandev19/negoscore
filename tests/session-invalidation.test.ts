import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mission #070 — l'en-tête ne prétend jamais une session que le serveur refuse.
// Supabase Auth est simulé au niveau HTTP (fetch), pour que la classification
// « refusée / indisponible / à rafraîchir » soit testée de bout en bout, du
// code de réponse de Supabase jusqu'aux en-têtes Set-Cookie du proxy.

const SUPABASE = "https://projet.supabase.test";

const fake = vi.hoisted(() => ({
  // Réponse de POST /auth/v1/token?grant_type=refresh_token
  refresh: { status: 200 } as { status: number } | "network",
  // Réponse de GET /auth/v1/user
  user: { status: 200 } as { status: number } | "network",
  calls: [] as string[],
}));

// Jeton d'accès non signé : seule son expiration est lue par le proxy pour
// décider d'un rafraîchissement ; l'autorisation vient toujours de Supabase.
function jwt(expiresInSeconds: number): string {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + expiresInSeconds })).toString("base64url");
  return `eyJhbGciOiJIUzI1NiJ9.${payload}.signature`;
}

const FRESH = jwt(3600);
const EXPIRED = jwt(-60);
const NEW_ACCESS = jwt(3600);

function supabaseFetch(input: string | URL | Request): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  fake.calls.push(url.replace(SUPABASE, ""));
  const reply = url.includes("/token?grant_type=refresh_token") ? fake.refresh : fake.user;
  if (reply === "network") return Promise.reject(new TypeError("fetch failed"));
  if (reply.status !== 200) {
    const code = url.includes("/token") ? "refresh_token_not_found" : "user_not_found";
    return Promise.resolve(Response.json({ code: reply.status, error_code: code, msg: "refus" }, { status: reply.status }));
  }
  if (url.includes("/token")) {
    return Promise.resolve(
      Response.json({ access_token: NEW_ACCESS, refresh_token: "nouveau-refresh", expires_in: 3600, user: { id: "u1", email: "nina@exemple.test" } }),
    );
  }
  return Promise.resolve(Response.json({ id: "u1", email: "nina@exemple.test" }));
}

const { proxy } = await import("@/proxy");

function visit(path: string, cookies: Record<string, string>) {
  const cookie = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  return proxy(new NextRequest(`http://localhost:3000${path}`, { headers: cookie ? { cookie } : {} }));
}

// Cookies effacés par la réponse (Max-Age=0), et cookies posés (valeur non vide).
const cleared = (r: Response) =>
  r.headers
    .getSetCookie()
    .filter((c) => /Max-Age=0/.test(c))
    .map((c) => c.split("=")[0])
    .sort();
const written = (r: Response) =>
  r.headers
    .getSetCookie()
    .filter((c) => !/Max-Age=0/.test(c))
    .map((c) => c.split("=")[0])
    .sort();

const ALL_THREE = ["ns_session", "sb_access_token", "sb_refresh_token"];

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "cle-anon-de-test");
  vi.stubGlobal("fetch", vi.fn(supabaseFetch));
  fake.refresh = { status: 200 };
  fake.user = { status: 200 };
  fake.calls = [];
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("session INVALIDE : tout est effacé par la réponse qui le constate", () => {
  it("compte supprimé (jeton d'accès encore dans ses dates, Supabase le refuse) : 307 vers /connexion, deux cookies et indicateur effacés", async () => {
    fake.user = { status: 403 };
    const r = await visit("/historique", { sb_access_token: FRESH, sb_refresh_token: "refresh", ns_session: "1" });
    expect(r.status).toBe(307);
    expect(new URL(String(r.headers.get("location"))).pathname).toBe("/connexion");
    expect(cleared(r)).toEqual(ALL_THREE);
  });

  it("jeton de rafraîchissement expiré ou révoqué : effacé même sur une page publique", async () => {
    fake.refresh = { status: 400 };
    const r = await visit("/", { sb_access_token: EXPIRED, sb_refresh_token: "refresh-perime", ns_session: "1" });
    expect(r.status).toBe(200);
    expect(cleared(r)).toEqual(ALL_THREE);
    expect(written(r)).toEqual([]);
  });

  it("jeton d'accès périmé sans jeton de rafraîchissement, sur une page de compte : effacé", async () => {
    fake.user = { status: 401 };
    const r = await visit("/compte", { sb_access_token: EXPIRED, ns_session: "1" });
    expect(r.status).toBe(307);
    expect(cleared(r)).toEqual(ALL_THREE);
  });
});

describe("A3 — /connexion ne laisse pas l'indicateur derrière elle", () => {
  it("indicateur seul, sans aucun cookie de session : effacé, sans appel à Supabase", async () => {
    const r = await visit("/connexion", { ns_session: "1" });
    expect(r.status).toBe(200);
    expect(cleared(r)).toEqual(["ns_session"]);
    expect(fake.calls).toEqual([]);
  });

  it("session présentée mais refusée : tout est effacé, et la page s'affiche", async () => {
    fake.user = { status: 403 };
    const r = await visit("/connexion", { sb_access_token: FRESH, sb_refresh_token: "refresh", ns_session: "1" });
    expect(r.status).toBe(200);
    expect(cleared(r)).toEqual(ALL_THREE);
  });

  it("indicateur orphelin sur n'importe quelle page : effacé", async () => {
    const r = await visit("/tarifs", { ns_session: "1" });
    expect(cleared(r)).toEqual(["ns_session"]);
  });
});

describe("NON-RÉGRESSION — « à rafraîchir » n'est pas « invalide »", () => {
  it("jeton d'accès périmé, jeton de rafraîchissement valable : la session est rafraîchie et survit", async () => {
    const r = await visit("/historique", { sb_access_token: EXPIRED, sb_refresh_token: "refresh-valable", ns_session: "1" });
    // Pas de redirection : la page de compte s'affiche.
    expect(r.status).toBe(200);
    expect(r.headers.get("location")).toBeNull();
    expect(cleared(r)).toEqual([]);
    expect(written(r)).toEqual(ALL_THREE);
    expect(r.headers.getSetCookie().find((c) => c.startsWith("sb_access_token="))).toContain(NEW_ACCESS);
  });

  it("session valide dont le jeton d'accès est encore bon : rien n'est touché", async () => {
    const r = await visit("/historique", { sb_access_token: FRESH, sb_refresh_token: "refresh", ns_session: "1" });
    expect(r.status).toBe(200);
    expect(r.headers.getSetCookie()).toEqual([]);
  });

  it.each([{ status: 503 }, { status: 500 }, "network" as const])(
    "Supabase indisponible au rafraîchissement (%s) : on ne sait rien, on ne détruit rien",
    async (reply) => {
      fake.refresh = reply;
      fake.user = reply;
      const r = await visit("/historique", { sb_access_token: EXPIRED, sb_refresh_token: "refresh-valable", ns_session: "1" });
      expect(cleared(r)).toEqual([]);
    },
  );

  it("Supabase indisponible à la vérification d'un jeton en cours de validité : rien n'est effacé", async () => {
    fake.user = { status: 502 };
    const r = await visit("/historique", { sb_access_token: FRESH, sb_refresh_token: "refresh", ns_session: "1" });
    expect(cleared(r)).toEqual([]);
  });
});
