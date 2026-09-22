import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mission #089 — une panne d'authentification n'est pas une absence de
// session. Supabase Auth est simulé au niveau HTTP (fetch), comme pour la
// mission #070 : la classification part du code de réponse de Supabase.

const SUPABASE = "https://projet.supabase.test";
const fake = vi.hoisted(() => ({
  user: { status: 200 } as { status: number } | "network",
  refresh: { status: 200 } as { status: number } | "network",
  cookie: undefined as string | undefined,
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "sb_access_token" && fake.cookie ? { name, value: fake.cookie } : undefined) }),
}));

function jwt(expiresInSeconds: number): string {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + expiresInSeconds })).toString("base64url");
  return `eyJhbGciOiJIUzI1NiJ9.${payload}.signature`;
}
const FRESH = jwt(3600);
const EXPIRED = jwt(-60);

function supabaseFetch(input: string | URL | Request): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const reply = url.includes("/token?grant_type=refresh_token") ? fake.refresh : fake.user;
  if (reply === "network") return Promise.reject(new TypeError("fetch failed"));
  if (reply.status !== 200) return Promise.resolve(Response.json({ msg: "non" }, { status: reply.status }));
  if (url.includes("/token")) {
    return Promise.resolve(Response.json({ access_token: FRESH, refresh_token: "r2", expires_in: 3600, user: { id: "u1", email: "nina@exemple.test" } }));
  }
  return Promise.resolve(Response.json({ id: "u1", email: "nina@exemple.test" }));
}

const { sessionFromAccessToken, AuthUnavailableError } = await import("@/lib/auth/session");
const { getRequestSession, getRequestUser } = await import("@/lib/auth/request-user");
const { proxy } = await import("@/proxy");

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "cle-anon-de-test");
  vi.stubGlobal("fetch", vi.fn(supabaseFetch));
  fake.user = { status: 200 };
  fake.refresh = { status: 200 };
  fake.cookie = undefined;
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const withCookie = (token?: string) => new Request("http://localhost:3000/api/x", { headers: token ? { cookie: `sb_access_token=${token}` } : {} });

describe("A — trois issues, dans le vocabulaire de la mission #070", () => {
  it("session valide", async () => {
    expect(await sessionFromAccessToken(FRESH)).toEqual({ kind: "valid", user: { id: "u1", email: "nina@exemple.test" } });
  });

  it("pas de session : aucun cookie, ou jeton refusé par Supabase", async () => {
    expect(await sessionFromAccessToken(undefined)).toEqual({ kind: "absent" });
    fake.user = { status: 401 };
    expect((await sessionFromAccessToken(FRESH)).kind).toBe("rejected");
  });

  it.each([[{ status: 522 }], [{ status: 503 }], [{ status: 429 }], ["network" as const]])("authentification injoignable (%s)", async (reply) => {
    fake.user = reply;
    expect((await sessionFromAccessToken(FRESH)).kind).toBe("unavailable");
  });

  it("côté route : getRequestSession distingue la panne, getRequestUser (usages sans risque) reste à null", async () => {
    fake.user = { status: 522 };
    expect((await getRequestSession(withCookie(FRESH))).kind).toBe("unavailable");
    expect(await getRequestUser(withCookie(FRESH))).toBeNull();
    fake.user = { status: 200 };
    expect(await getRequestSession(withCookie(FRESH))).toMatchObject({ kind: "valid" });
    expect(await getRequestSession(withCookie())).toEqual({ kind: "absent" });
  });
});

describe("C — pages : getViewer ne dit plus « pas connectée » pendant une panne", () => {
  it("valide : l'utilisateur ; sans session : null (comme avant) ; injoignable : erreur explicite", async () => {
    const load = async () => (await import("@/lib/auth/viewer")).getViewer();
    fake.cookie = FRESH;
    await expect(load()).resolves.toMatchObject({ id: "u1" });
    vi.resetModules();
    fake.cookie = undefined;
    await expect(load()).resolves.toBeNull();
    vi.resetModules();
    fake.cookie = FRESH;
    fake.user = { status: 522 };
    await expect(load()).rejects.toMatchObject({ name: "AuthUnavailableError" });
    expect(new AuthUnavailableError().name).toBe("AuthUnavailableError");
  });
});

describe("C — proxy : une page de compte pendant une panne", () => {
  const visit = (path: string, cookies: Record<string, string>) =>
    proxy(
      new NextRequest(`http://localhost:3000${path}`, {
        headers: { cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ") },
      }),
    );

  it("injoignable à la vérification : pas de « connecte-toi », la page dit que c'est momentané, rien n'est effacé", async () => {
    fake.user = { status: 522 };
    const r = await visit("/historique", { sb_access_token: FRESH, sb_refresh_token: "r", ns_session: "1" });
    expect(r.status).toBe(200);
    expect(r.headers.get("location")).toBeNull();
    expect(new URL(String(r.headers.get("x-middleware-rewrite"))).pathname).toBe("/session-indisponible");
    expect(r.headers.getSetCookie().filter((c) => /Max-Age=0/.test(c))).toEqual([]);
  });

  it("injoignable au rafraîchissement : même chose", async () => {
    fake.refresh = "network";
    fake.user = "network";
    const r = await visit("/compte", { sb_access_token: EXPIRED, sb_refresh_token: "r", ns_session: "1" });
    expect(new URL(String(r.headers.get("x-middleware-rewrite"))).pathname).toBe("/session-indisponible");
  });

  it("chemin normal inchangé : sans session, redirection vers /connexion ; session refusée, idem et cookies effacés ; valide, la page", async () => {
    const none = await visit("/historique", {});
    expect(r307(none)).toBe("/connexion");
    fake.user = { status: 401 };
    const refused = await visit("/historique", { sb_access_token: FRESH, sb_refresh_token: "r", ns_session: "1" });
    expect(r307(refused)).toBe("/connexion");
    fake.user = { status: 200 };
    const valid = await visit("/historique", { sb_access_token: FRESH, sb_refresh_token: "r", ns_session: "1" });
    expect(valid.status).toBe(200);
    expect(valid.headers.get("x-middleware-rewrite")).toBeNull();
  });
});

function r307(response: Response): string | null {
  expect(response.status).toBe(307);
  return new URL(String(response.headers.get("location"))).pathname;
}
