import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LinkSent } from "@/app/connexion/login-form";

// /connexion est statique depuis la mission #045 : la redirection d'une
// personne déjà connectée est faite par proxy.ts, après vérification de la
// session auprès de Supabase ; ?next= et ?erreur= sont lus dans le navigateur.

const state = vi.hoisted(() => ({
  validTokens: new Set<string>(),
  params: new URLSearchParams(),
}));

vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  accessTokenExpiresSoon: () => false,
  userFromAccessToken: async (token: string | null | undefined) =>
    token && state.validTokens.has(token) ? { id: "u1", email: "nina@example.com" } : null,
  refreshSession: async () => null,
  // Mission #070 : issues à trois états, même sens qu'avant.
  checkAccessToken: async (token: string) =>
    state.validTokens.has(token) ? { kind: "valid", user: { id: "u1", email: "nina@example.com" } } : { kind: "rejected", status: 401 },
  refreshSessionOutcome: async () => ({ kind: "rejected", status: 400 }),
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useSearchParams: () => state.params,
}));
vi.mock("@/components/site-header", () => ({ SiteHeader: () => null }));

const { proxy } = await import("@/proxy");

function visit(path: string, cookie: string | null) {
  return proxy(new NextRequest(`http://localhost:3000${path}`, { headers: cookie ? { cookie } : {} }));
}

const location = (response: Response) => {
  const value = response.headers.get("location");
  return value ? new URL(value).pathname + new URL(value).search : null;
};

beforeEach(() => {
  state.validTokens.clear();
  state.params = new URLSearchParams();
});

describe("/connexion : redirection d'une personne déjà connectée (proxy)", () => {
  it("déjà connectée : renvoi vers le compte", async () => {
    state.validTokens.add("jeton-valide");
    const response = await visit("/connexion", "sb_access_token=jeton-valide; sb_refresh_token=r");
    expect(response.status).toBe(307);
    expect(location(response)).toBe("/compte");
  });

  it("déjà connectée avec next : la destination demandée", async () => {
    state.validTokens.add("jeton-valide");
    expect(location(await visit("/connexion?next=%2Fhistorique", "sb_access_token=jeton-valide; sb_refresh_token=r"))).toBe("/historique");
    expect(location(await visit("/connexion?next=%2Fanalyse%2Fresultat%2Fabc", "sb_access_token=jeton-valide; sb_refresh_token=r"))).toBe(
      "/analyse/resultat/abc",
    );
  });

  it("jamais de redirection externe ni de boucle", async () => {
    state.validTokens.add("jeton-valide");
    const cookie = "sb_access_token=jeton-valide; sb_refresh_token=r";
    expect(location(await visit("/connexion?next=https%3A%2F%2Fexemple.test", cookie))).toBe("/compte");
    expect(location(await visit("/connexion?next=%2F%2Fexemple.test", cookie))).toBe("/compte");
    expect(location(await visit("/connexion?next=%2Fconnexion", cookie))).toBe("/compte");
  });

  it("cookie de session invalide, ou indicateur d'affichage seul : pas de redirection (sinon boucle avec /compte)", async () => {
    expect(location(await visit("/connexion", "sb_access_token=jeton-perime; sb_refresh_token=r"))).toBeNull();
    expect(location(await visit("/connexion", "ns_session=1"))).toBeNull();
    expect(location(await visit("/connexion", null))).toBeNull();
  });

  it("les autres pages ne sont pas redirigées", async () => {
    state.validTokens.add("jeton-valide");
    expect(location(await visit("/tarifs", "sb_access_token=jeton-valide; sb_refresh_token=r"))).toBeNull();
  });
});

describe("/connexion : page statique", () => {
  it("non connecté : le formulaire, avec le retour lu dans l'adresse", async () => {
    const { LoginFromUrl } = await import("@/app/connexion/login-from-url");
    state.params = new URLSearchParams("next=/historique");
    const html = renderToStaticMarkup(<LoginFromUrl />);
    expect(html).toContain('name="email"');
    expect(html).toContain('value="/historique"');
    expect(html).toContain("Recevoir mon lien de connexion");
    expect(html).not.toContain("Ce lien a expiré");
  });

  it("next externe filtré, erreur de lien affichée", async () => {
    const { LoginFromUrl } = await import("@/app/connexion/login-from-url");
    state.params = new URLSearchParams("next=https://exemple.test&erreur=lien");
    const html = renderToStaticMarkup(<LoginFromUrl />);
    expect(html).toContain('value="/historique"');
    expect(html).toContain("Ce lien a expiré ou a déjà servi.");
  });

  it("la page n'attend aucun paramètre de requête : elle peut être prérendue", async () => {
    const { default: LoginPage } = await import("@/app/connexion/page");
    expect(LoginPage.length).toBe(0);
    const html = renderToStaticMarkup(<LoginPage />);
    expect(html).toContain("Connexion");
  });
});

describe("après l'envoi du lien", () => {
  it("dit que le lien est parti, à quelle adresse, et de regarder les spams", () => {
    const html = renderToStaticMarkup(<LinkSent email="nina@example.com" next="/historique" />);
    expect(html).toContain("Regarde ta boîte mail");
    expect(html).toContain("nina@example.com");
    expect(html).toContain("spams");
    expect(html).toContain('href="/connexion?next=%2Fhistorique"');
  });
});
