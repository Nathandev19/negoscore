import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LinkSent } from "@/app/connexion/login-form";

const state = vi.hoisted(() => ({ viewer: null as { id: string; email: string | null } | null }));
vi.mock("@/lib/auth/viewer", () => ({ getViewer: async () => state.viewer }));
vi.mock("@/components/site-header", () => ({ SiteHeader: () => null }));

async function page(params: Record<string, string>) {
  const { default: LoginPage } = await import("@/app/connexion/page");
  return LoginPage({ searchParams: Promise.resolve(params) } as never);
}

beforeEach(() => {
  state.viewer = null;
});

describe("/connexion", () => {
  it("déjà connecté : renvoi vers le compte", async () => {
    state.viewer = { id: "u1", email: "nina@example.com" };
    await expect(page({})).rejects.toMatchObject({ digest: expect.stringMatching(/;\/compte;/) });
  });

  it("déjà connecté avec next : la destination demandée", async () => {
    state.viewer = { id: "u1", email: "nina@example.com" };
    await expect(page({ next: "/historique" })).rejects.toMatchObject({ digest: expect.stringMatching(/;\/historique;/) });
    await expect(page({ next: "/analyse/resultat/abc" })).rejects.toMatchObject({ digest: expect.stringMatching(/;\/analyse\/resultat\/abc;/) });
  });

  it("déjà connecté : jamais de redirection externe ni de boucle", async () => {
    state.viewer = { id: "u1", email: "nina@example.com" };
    await expect(page({ next: "https://exemple.test" })).rejects.toMatchObject({ digest: expect.stringMatching(/;\/compte;/) });
    await expect(page({ next: "//exemple.test" })).rejects.toMatchObject({ digest: expect.stringMatching(/;\/compte;/) });
    await expect(page({ next: "/connexion" })).rejects.toMatchObject({ digest: expect.stringMatching(/;\/compte;/) });
  });

  it("non connecté : le formulaire, inchangé", async () => {
    const html = renderToStaticMarkup(await page({ next: "/historique" }));
    expect(html).toContain("<h1");
    expect(html).toContain("Connexion");
    expect(html).toContain('name="email"');
    expect(html).toContain('value="/historique"');
    expect(html).toContain("Recevoir mon lien de connexion");
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
