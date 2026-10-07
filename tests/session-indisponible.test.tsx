import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mission #089 bis — une authentification indisponible n'est pas une absence
// de session.
//
// Trois états, jamais deux : valide, absente, indisponible. « Absente » garde
// exactement le comportement d'aujourd'hui ; « indisponible » ne détruit rien,
// n'affirme rien, et n'ouvre rien.

const SUPABASE = "https://projet.supabase.test";
const fake = vi.hoisted(() => ({
  user: { status: 200 } as { status: number } | "network",
  refresh: { status: 200 } as { status: number } | "network",
  cookie: undefined as string | undefined,
  // Ce que la base rend pour l'analyse demandée. Le layout ne doit jamais y
  // toucher pendant une panne : c'est aussi ça, « ne rien conclure ».
  result: null as { unlocked: boolean } | null,
  loads: 0,
}));

vi.mock("@/lib/analysis/load", () => ({
  loadResultForViewer: async () => {
    fake.loads += 1;
    return fake.result;
  },
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "sb_access_token" && fake.cookie ? { name, value: fake.cookie } : undefined),
  }),
}));

function jwt(expiresInSeconds: number): string {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + expiresInSeconds })).toString("base64url");
  return `eyJhbGciOiJIUzI1NiJ9.${payload}.signature`;
}
const FRESH = jwt(3600);

function supabaseFetch(input: string | URL | Request): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const reply = url.includes("/token?grant_type=refresh_token") ? fake.refresh : fake.user;
  if (reply === "network") return Promise.reject(new TypeError("fetch failed"));
  if (reply.status !== 200) return Promise.resolve(Response.json({ msg: "non" }, { status: reply.status }));
  return Promise.resolve(Response.json({ id: "u1", email: "nina@exemple.test" }));
}

const { sessionStateFrom, sessionState, statusMeansUnavailable, mayDestroy, mayEnter } = await import("@/lib/auth/session-state");
const { draftSurvives } = await import("@/lib/negotiation/draft");

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "cle-anon-de-test");
  vi.stubGlobal("fetch", vi.fn(supabaseFetch));
  fake.user = { status: 200 };
  fake.refresh = { status: 200 };
  fake.cookie = undefined;
  fake.result = { unlocked: false };
  fake.loads = 0;
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// Les apostrophes typographiques sont échappées par renderToStaticMarkup.
const lisible = (html: string) => html.replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&amp;", "&").replaceAll("&nbsp;", " ");

describe("A1 — la décision, fonction pure", () => {
  it("l'authentification répond « aucune session » : absente, comme aujourd'hui", () => {
    expect(sessionStateFrom({ kind: "aucun-jeton" })).toBe("absente");
    expect(sessionStateFrom({ kind: "reponse", status: 401, user: false })).toBe("absente");
    expect(sessionStateFrom({ kind: "reponse", status: 403, user: false })).toBe("absente");
    expect(sessionStateFrom({ kind: "reponse", status: 400, user: false })).toBe("absente");
  });

  it("l'authentification lève une erreur réseau : indisponible, jamais absente", () => {
    expect(sessionStateFrom({ kind: "injoignable" })).toBe("indisponible");
  });

  it("l'authentification dépasse le délai, ou sature, ou tombe : indisponible", () => {
    for (const status of [408, 429, 500, 502, 503, 504, 522]) {
      expect(statusMeansUnavailable(status)).toBe(true);
      expect(sessionStateFrom({ kind: "reponse", status, user: false })).toBe("indisponible");
    }
    // Un refus n'est pas une panne.
    for (const status of [400, 401, 403, 404, 422]) expect(statusMeansUnavailable(status)).toBe(false);
  });

  it("réponse 200 dont on ne tire aucun utilisateur : indisponible, pas « pas de session »", () => {
    expect(sessionStateFrom({ kind: "reponse", status: 200, user: false })).toBe("indisponible");
    expect(sessionStateFrom({ kind: "reponse", status: 200, user: true })).toBe("valide");
  });

  it("indisponible ne détruit rien et n'ouvre rien ; absente n'ouvre rien mais autorise le ménage", () => {
    expect(mayDestroy("indisponible")).toBe(false);
    expect(mayEnter("indisponible")).toBe(false);
    expect(mayDestroy("absente")).toBe(true);
    expect(mayEnter("absente")).toBe(false);
    expect(mayDestroy("valide")).toBe(true);
    expect(mayEnter("valide")).toBe(true);
  });

  it("le vocabulaire en place se traduit sans rien confondre", () => {
    expect(sessionState({ kind: "valid" })).toBe("valide");
    expect(sessionState({ kind: "absent" })).toBe("absente");
    expect(sessionState({ kind: "rejected" })).toBe("absente");
    expect(sessionState({ kind: "unavailable" })).toBe("indisponible");
  });
});

describe("A1 — les issues réelles de Supabase passent par cette décision", () => {
  it("valide, refusée, injoignable : trois issues distinctes", async () => {
    const { sessionFromAccessToken } = await import("@/lib/auth/session");
    fake.user = { status: 200 };
    expect((await sessionFromAccessToken(FRESH)).kind).toBe("valid");
    fake.user = { status: 401 };
    expect((await sessionFromAccessToken(FRESH)).kind).toBe("rejected");
    fake.user = { status: 503 };
    expect((await sessionFromAccessToken(FRESH)).kind).toBe("unavailable");
    fake.user = "network";
    expect((await sessionFromAccessToken(FRESH)).kind).toBe("unavailable");
    // Aucun jeton : l'authentification n'a même pas été appelée.
    expect((await sessionFromAccessToken(null)).kind).toBe("absent");
  });

  it("le rafraîchissement partage la même règle : 5xx garde la session, 401 la refuse", async () => {
    const { refreshSessionOutcome } = await import("@/lib/auth/session");
    fake.refresh = { status: 503 };
    expect((await refreshSessionOutcome("r")).kind).toBe("unavailable");
    fake.refresh = "network";
    expect((await refreshSessionOutcome("r")).kind).toBe("unavailable");
    fake.refresh = { status: 401 };
    expect((await refreshSessionOutcome("r")).kind).toBe("rejected");
  });
});

describe("A3 — les pages de résultat pendant une panne", () => {
  const params = Promise.resolve({ id: "22222222-2222-4222-8222-222222222222" });

  it("indisponible : l'écran dit que c'est nous, jamais « introuvable » ni « connecte-toi »", async () => {
    fake.cookie = FRESH;
    fake.user = "network";
    const { default: Layout } = await import("@/app/analyse/resultat/[id]/layout");
    const html = lisible(renderToStaticMarkup(await Layout({ children: <p>analyse</p>, params })));
    expect(html).toContain("Ton compte est momentanément injoignable");
    expect(html).toContain("recharge la page");
    expect(html).not.toContain("introuvable");
    expect(html.toLowerCase()).not.toContain("connecte-toi");
    // Le contenu de l'analyse n'est pas rendu non plus : indisponible n'ouvre rien.
    expect(html).not.toContain("analyse</p>");
    // Rien n'a même été demandé à la base : on ne conclut pas, on n'interroge pas.
    expect(fake.loads).toBe(0);
  });

  it("absente : rien ne change, la page suit son cours", async () => {
    fake.cookie = undefined;
    const { default: Layout } = await import("@/app/analyse/resultat/[id]/layout");
    const html = renderToStaticMarkup(await Layout({ children: <p>analyse</p>, params }));
    expect(html).toContain("analyse");
    expect(html).not.toContain("momentanément injoignable");
    expect(fake.loads).toBe(1);
  });

  it("la 404 des résultats n'affirme pas que la session est ouverte quand elle n'a pas pu demander", async () => {
    fake.cookie = FRESH;
    fake.user = "network";
    const { default: NotFound } = await import("@/app/analyse/resultat/not-found");
    const html = lisible(renderToStaticMarkup(await NotFound()));
    expect(html).not.toContain("Ta session est bien ouverte");
  });
});

describe("A4 — les gardes restent fermées, sans rien détruire", () => {
  const visit = async (path: string, cookies: Record<string, string>) => {
    const { proxy } = await import("@/proxy");
    return proxy(
      new NextRequest(`http://localhost:3000${path}`, {
        headers: { cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ") },
      }),
    );
  };
  const session = { sb_access_token: FRESH, sb_refresh_token: "r", ns_session: "1", ns_owner: "1" };

  it("/admin : indisponible ne l'ouvre pas, et n'efface aucun cookie", async () => {
    vi.stubEnv("OWNER_EMAIL", "nina@exemple.test");
    fake.user = { status: 503 };
    const r = await visit("/admin", session);
    expect(new URL(String(r.headers.get("x-middleware-rewrite"))).pathname).toBe("/_introuvable");
    expect(r.headers.get("location")).toBeNull();
    expect(r.headers.getSetCookie().filter((c) => /Max-Age=0/.test(c))).toEqual([]);
  });

  it("/dev/retours : idem", async () => {
    vi.stubEnv("OWNER_EMAIL", "nina@exemple.test");
    fake.user = "network";
    const r = await visit("/dev/retours", session);
    expect(new URL(String(r.headers.get("x-middleware-rewrite"))).pathname).toBe("/_introuvable");
    expect(r.headers.getSetCookie().filter((c) => /Max-Age=0/.test(c))).toEqual([]);
  });

  it("le propriétaire y entre toujours quand l'authentification répond", async () => {
    vi.stubEnv("OWNER_EMAIL", "nina@exemple.test");
    fake.user = { status: 200 };
    const r = await visit("/admin", session);
    expect(r.headers.get("x-middleware-rewrite")).toBeNull();
  });

  it("côté route : adminAccess refuse sur indisponible, avec 503 et non 401", async () => {
    const { adminAccess } = await import("@/lib/admin/access");
    vi.stubEnv("OWNER_EMAIL", "nina@exemple.test");
    const request = new Request("http://localhost:3000/api/admin/x", { headers: { cookie: `sb_access_token=${FRESH}` } });
    fake.user = { status: 503 };
    expect(await adminAccess(request)).toEqual({ ok: false, status: 503, reason: "unavailable" });
    fake.user = { status: 401 };
    expect(await adminAccess(request)).toEqual({ ok: false, status: 401, reason: "signed_out" });
  });
});

describe("A5 — une seconde tentative rétablit l'état, sans rien avoir perdu", () => {
  it("panne puis réponse : la même requête, le même cookie, la session retrouvée", async () => {
    const { sessionFromAccessToken } = await import("@/lib/auth/session");
    fake.user = "network";
    expect((await sessionFromAccessToken(FRESH)).kind).toBe("unavailable");
    fake.user = { status: 200 };
    expect(await sessionFromAccessToken(FRESH)).toEqual({ kind: "valid", user: { id: "u1", email: "nina@exemple.test" } });
  });

  it("un brouillon de tour survit à une panne, et n'est abandonné que sur un refus définitif", () => {
    // 503 d'authentification injoignable : le texte ET la clé restent.
    expect(draftSurvives(503)).toBe(true);
    expect(draftSurvives(500)).toBe(true);
    // Refus définitif : la clé est abandonnée (le texte, lui, reste dans la zone).
    expect(draftSurvives(400)).toBe(false);
    expect(draftSurvives(401)).toBe(false);
    expect(draftSurvives(422)).toBe(false);
  });
});
