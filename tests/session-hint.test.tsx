import { renderToString } from "react-dom/server";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  expiredSessionHintCookieHeader,
  hasSessionHint,
  SESSION_HINT_COOKIE,
  sessionHintCookieHeader,
} from "@/lib/auth/session-hint";

const auth = vi.hoisted(() => ({
  session: {
    accessToken: "eyJhbGciOiJIUzI1NiJ9.eyJlbWFpbCI6Im5pbmFAZXhhbXBsZS5jb20ifQ.sig",
    refreshToken: "refresh-token-secret",
    expiresIn: 3600,
    user: { id: "7b1f2c9e-3d4a-4b5c-8d6e-0f1a2b3c4d5e", email: "nina@example.com" },
  },
  cookies: new Map<string, string>(),
}));

vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  exchangeCode: async () => auth.session,
  refreshSession: async (token: string) => (token === "valide" ? auth.session : null),
  // Mission #070 : issues à trois états, même sens qu'avant.
  refreshSessionOutcome: async (token: string) =>
    token === "valide" ? { kind: "refreshed", session: auth.session } : { kind: "rejected", status: 400 },
  signOut: async () => undefined,
}));
vi.mock("@/lib/auth/account", () => ({
  ensureAccount: async () => undefined,
  attachAnonDeals: async () => ({ attached: 0, refused: false }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (auth.cookies.has(name) ? { value: auth.cookies.get(name) } : undefined) }),
}));

const HINT_ONLY = `${SESSION_HINT_COOKIE}=1`;

function setCookies(response: Response): string[] {
  return response.headers.getSetCookie();
}

beforeEach(() => {
  auth.cookies.clear();
});

describe("cookie indicateur de session", () => {
  it("ne contient aucune donnée personnelle ni aucun jeton", () => {
    const header = sessionHintCookieHeader();
    const value = header.split(";")[0].split("=").slice(1).join("=");
    expect(value).toBe("1");
    expect(header).not.toContain("HttpOnly");
    expect(header).not.toMatch(/@|eyJ|[0-9a-f]{8}-[0-9a-f]{4}/i);
    expect(header).not.toContain(auth.session.accessToken);
    expect(header).not.toContain(auth.session.refreshToken);
    expect(header).not.toContain(auth.session.user.id);
    expect(header).toContain("Path=/");
  });

  it("lu uniquement sur sa valeur exacte", () => {
    expect(hasSessionHint("")).toBe(false);
    expect(hasSessionHint("autre=1")).toBe(false);
    expect(hasSessionHint(`${SESSION_HINT_COOKIE}=0`)).toBe(false);
    expect(hasSessionHint(`a=b; ${SESSION_HINT_COOKIE}=1; c=d`)).toBe(true);
  });

  it("posé avec la session au retour du magic link, sans rien de l'utilisateur", async () => {
    const { GET } = await import("@/app/auth/callback/route");
    const response = await GET(
      new Request("http://localhost:3000/auth/callback?code=abc", { headers: { cookie: "sb_pkce_verifier=v" } }),
    );
    const cookies = setCookies(response);
    // Mission #046 : bandeau « Connexion réussie » sur la page d'arrivée, sans email.
    expect(cookies.some((c) => c.startsWith("ns_flash=connexion;") && !c.includes("HttpOnly"))).toBe(true);
    expect(cookies.find((c) => c.startsWith("ns_flash="))).not.toContain("@");
    expect(cookies.some((c) => c.startsWith("sb_access_token=") && c.includes("HttpOnly"))).toBe(true);
    const hint = cookies.find((c) => c.startsWith(`${SESSION_HINT_COOKIE}=`));
    expect(hint).toBe(sessionHintCookieHeader());
  });

  it("effacé à la déconnexion", async () => {
    const { POST } = await import("@/app/auth/deconnexion/route");
    const response = await POST(new Request("http://localhost:3000/auth/deconnexion", { method: "POST", headers: { cookie: HINT_ONLY } }));
    expect(setCookies(response)).toContain(expiredSessionHintCookieHeader());
    // Mission #046 : bandeau « Déconnexion réussie ».
    expect(setCookies(response).some((c) => c.startsWith("ns_flash=deconnexion;"))).toBe(true);
    expect(expiredSessionHintCookieHeader()).toContain("Max-Age=0");
  });

  it("prolongé au rafraîchissement, effacé si la session n'est plus valide", async () => {
    const { proxy } = await import("@/proxy");
    const refreshed = await proxy(new NextRequest("http://localhost:3000/", { headers: { cookie: "sb_refresh_token=valide" } }));
    expect(refreshed.headers.getSetCookie()).toContain(sessionHintCookieHeader());
    const invalid = await proxy(new NextRequest("http://localhost:3000/", { headers: { cookie: `sb_refresh_token=perime; ${HINT_ONLY}` } }));
    expect(invalid.headers.getSetCookie()).toContain(expiredSessionHintCookieHeader());
  });
});

describe("le cookie indicateur seul ne donne accès à rien", () => {
  it("pages protégées : redirection vers la connexion", async () => {
    auth.cookies.set(SESSION_HINT_COOKIE, "1");
    const pages = [
      ["@/app/compte/page", "/connexion?next=%2Fcompte"],
      ["@/app/compte/supprimer/page", "/connexion?next=%2Fcompte%2Fsupprimer"],
      ["@/app/historique/page", "/connexion?next=%2Fhistorique"],
    ] as const;
    for (const [modulePath, target] of pages) {
      const { default: Page } = (await import(modulePath)) as { default: (props: unknown) => Promise<unknown> };
      await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toMatchObject({ digest: expect.stringContaining(target) });
    }
  });

  it("routes protégées : aucune action, renvoi vers la connexion", async () => {
    const { POST: supprimer } = await import("@/app/api/compte/supprimer/route");
    const { POST: resilier } = await import("@/app/api/resilier/route");
    const init = { method: "POST", headers: { cookie: HINT_ONLY, "content-type": "application/x-www-form-urlencoded" }, body: "confirmation=SUPPRIMER" };
    expect((await supprimer(new Request("http://localhost:3000/api/compte/supprimer", init))).headers.get("location")).toBe(
      `/connexion?next=${encodeURIComponent("/compte/supprimer")}`,
    );
    expect((await resilier(new Request("http://localhost:3000/api/resilier", { method: "POST", headers: { cookie: HINT_ONLY } }))).headers.get("location")).toBe(
      `/connexion?next=${encodeURIComponent("/resilier")}`,
    );
  });
});

describe("en-tête client", () => {
  // Mission #071 : le rendu serveur ne sait pas qui regarde. Il n'affirme ni
  // « connecté » ni « déconnecté » : l'emplacement du lien de compte est
  // réservé, invisible et inerte, jusqu'à l'hydratation.
  it("rendu serveur : aucun lien de compte, ni « Se connecter » cliquable, même avec le cookie", async () => {
    const { SiteHeader } = await import("@/components/site-header");
    auth.cookies.set(SESSION_HINT_COOKIE, "1");
    const html = renderToString(<SiteHeader />);
    // Hors <noscript> : rien n'affirme un état du compte.
    const withJs = html.replace(/<noscript[\s\S]*?<\/noscript>/g, "");
    expect(withJs).not.toContain('href="/connexion"');
    expect(withJs).not.toContain('href="/compte"');
    expect(withJs).not.toContain('href="/historique"');
    expect(html).toContain("data-account-pending");
    expect(html).toMatch(/<span aria-hidden="true" data-account-pending="true" class="[^"]*invisible/);
  });

  // Mission #073 : sans JavaScript, l'état ne sera jamais connu. Le chemin vers
  // /connexion existe quand même, dans <noscript>, à sa place habituelle
  // (ordinateur) et à côté du bouton Menu (mobile, où le menu ne s'ouvre pas).
  it("rendu serveur : « Se connecter » offert sans JavaScript, dans <noscript>, et seulement là", async () => {
    const { SiteHeader } = await import("@/components/site-header");
    const html = renderToString(<SiteHeader />);
    const blocks = html.match(/<noscript[\s\S]*?<\/noscript>/g) ?? [];
    expect(blocks).toHaveLength(2);
    for (const block of blocks) {
      expect(block).toContain('href="/connexion"');
      expect(block).toContain(">Se connecter</a>");
    }
  });
});
