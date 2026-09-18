import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_PAGES, requiresAccount } from "@/lib/auth/account-pages";

// Mission #048 D : un visiteur non connecté qui demande une page de compte
// reçoit une redirection 307 vers /connexion, décidée par proxy.ts AVANT tout
// rendu. Régression corrigée : depuis loading.tsx (#045), ces pages répondaient
// 200 et la redirection n'arrivait qu'au milieu du flux.

const auth = vi.hoisted(() => ({
  valid: new Set<string>(),
  refreshable: new Set<string>(),
}));

vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  accessTokenExpiresSoon: (token: string) => token === "expire-bientot",
  userFromAccessToken: async (token: string | null | undefined) => (token && auth.valid.has(token) ? { id: "u1", email: "nina@example.com" } : null),
  refreshSession: async (token: string) =>
    auth.refreshable.has(token)
      ? { accessToken: "jeton-rafraichi", refreshToken: "nouveau-refresh", expiresIn: 3600, user: { id: "u1", email: "nina@example.com" } }
      : null,
  // Mission #070 : le proxy lit les issues à trois états. Même sens qu'avant :
  // un jeton inconnu est REFUSÉ par Supabase.
  checkAccessToken: async (token: string) =>
    auth.valid.has(token) ? { kind: "valid", user: { id: "u1", email: "nina@example.com" } } : { kind: "rejected", status: 401 },
  refreshSessionOutcome: async (token: string) =>
    auth.refreshable.has(token)
      ? {
          kind: "refreshed",
          session: { accessToken: "jeton-rafraichi", refreshToken: "nouveau-refresh", expiresIn: 3600, user: { id: "u1", email: "nina@example.com" } },
        }
      : { kind: "rejected", status: 400 },
}));

const { proxy } = await import("@/proxy");

function visit(pathWithSearch: string, cookie: string | null) {
  return proxy(new NextRequest(`http://localhost:3000${pathWithSearch}`, { headers: cookie ? { cookie } : {} }));
}

function location(response: Response): string | null {
  const value = response.headers.get("location");
  if (!value) return null;
  const url = new URL(value);
  return `${url.pathname}${url.search}`;
}

beforeEach(() => {
  auth.valid.clear();
  auth.refreshable.clear();
});

// Toutes les pages protégées, sous-pages comprises.
const PROTECTED = ["/compte", "/compte/supprimer", "/historique", "/merci", "/resilier"] as const;

describe.each(PROTECTED)("page protégée %s", (page) => {
  const expected = `/connexion?next=${encodeURIComponent(page)}`;

  it("visiteur sans cookie : 307 vers /connexion, avant tout rendu, sans corps", async () => {
    const response = await visit(page, null);
    expect(response.status).toBe(307);
    expect(location(response)).toBe(expected);
    expect(response.headers.get("x-middleware-next")).toBeNull();
    expect(await response.text()).toBe("");
  });

  it("indicateur d'affichage seul, ou jeton invalide : 307 aussi", async () => {
    expect((await visit(page, "ns_session=1")).status).toBe(307);
    const invalid = await visit(page, "sb_access_token=jeton-invalide; sb_refresh_token=r");
    expect(invalid.status).toBe(307);
    expect(location(invalid)).toBe(expected);
  });

  it("session expirée impossible à rafraîchir : 307, et les cookies de session sont effacés", async () => {
    const response = await visit(page, "sb_access_token=expire-bientot; sb_refresh_token=perime; ns_session=1");
    expect(response.status).toBe(307);
    expect(location(response)).toBe(expected);
    const cookies = response.headers.getSetCookie();
    expect(cookies.some((c) => c.startsWith("sb_access_token=;"))).toBe(true);
    expect(cookies.some((c) => c.startsWith("ns_session=;"))).toBe(true);
  });

  it("visiteur connecté : la requête continue vers le rendu (l'écran de chargement reste)", async () => {
    auth.valid.add("jeton-valide");
    const response = await visit(page, "sb_access_token=jeton-valide; sb_refresh_token=r");
    expect(response.status).toBe(200);
    expect(location(response)).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("session rafraîchie juste avant : la requête continue avec le nouveau jeton", async () => {
    auth.refreshable.add("refresh-valide");
    auth.valid.add("jeton-rafraichi");
    const response = await visit(page, "sb_access_token=expire-bientot; sb_refresh_token=refresh-valide");
    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie().some((c) => c.startsWith("sb_access_token=jeton-rafraichi;"))).toBe(true);
  });
});

describe("liste des pages protégées", () => {
  it("le retour demandé garde les paramètres (résiliation avant suppression de compte)", async () => {
    const response = await visit("/resilier?motif=suppression", null);
    expect(location(response)).toBe(`/connexion?next=${encodeURIComponent("/resilier?motif=suppression")}`);
  });

  it("les pages publiques ne sont pas redirigées", async () => {
    for (const page of ["/", "/tarifs", "/analyse", "/connexion", "/analyse/demo", "/comptes-rendus"]) {
      expect((await visit(page, null)).status, page).toBe(200);
    }
    expect(requiresAccount("/comptes-rendus")).toBe(false);
  });

  it("toute page qui renvoie elle-même vers /connexion est couverte par le proxy", () => {
    const APP = path.join(process.cwd(), "app");
    const pages = readdirSync(APP, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name === "page.tsx")
      .filter((entry) => /redirect\(\s*[`"]\/connexion/.test(readFileSync(path.join(entry.parentPath, entry.name), "utf8")))
      .map((entry) => `/${path.relative(APP, entry.parentPath).split(path.sep).join("/")}`);
    expect(pages.length).toBeGreaterThanOrEqual(5);
    for (const page of pages) expect(requiresAccount(page), page).toBe(true);
    expect([...ACCOUNT_PAGES]).toEqual(["/compte", "/historique", "/merci", "/resilier"]);
  });
});
