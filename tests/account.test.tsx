import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HeaderNav } from "@/components/header-nav";
import { deletionBlocker, isDeletionConfirmed } from "@/lib/account/deletion";
import { accountSummary } from "@/lib/account/summary";
import { accountDeletionEmail } from "@/lib/email/templates";

const state = vi.hoisted(() => ({
  viewer: null as { id: string; email: string | null } | null,
  credits: [] as unknown[],
}));

vi.mock("@/lib/auth/viewer", () => ({ getViewer: async () => state.viewer, getViewerAccessToken: async () => null }));
vi.mock("@/lib/supabase/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/server")>()),
  selectRows: async () => state.credits,
}));
// L'en-tête est testé à part : ici, seul le contenu de la page compte.
vi.mock("@/components/site-header", () => ({ SiteHeader: () => null }));

const DAY = 24 * 3600 * 1000;
const future = () => new Date(Date.now() + 10 * DAY).toISOString();
const past = "2026-09-01T05:37:47.007Z";

function hrefs(html: string): string[] {
  return [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
}

beforeEach(() => {
  state.viewer = null;
  state.credits = [];
});

describe("en-tête", () => {
  const PROTECTED = ["/historique", "/compte", "/resilier", "/merci", "/compte/supprimer"];

  it("déconnecté : lien de connexion, aucun lien vers une page protégée", () => {
    const links = hrefs(renderToStaticMarkup(<HeaderNav signedIn={false} />));
    expect(links).toContain("/connexion");
    for (const path of PROTECTED) expect(links).not.toContain(path);
  });

  it("connecté : accès aux analyses et au compte, sans initiale ni email", () => {
    const html = renderToStaticMarkup(<HeaderNav signedIn />);
    const links = hrefs(html);
    expect(links).toContain("/historique");
    expect(links).toContain("/compte");
    expect(links).not.toContain("/connexion");
    expect(html).toContain("Mes analyses");
    expect(html).toContain(">Compte<");
  });

  it("état inconnu (rendu statique) : aucun lien, hauteur réservée", () => {
    const html = renderToStaticMarkup(<HeaderNav signedIn={null} />);
    expect(hrefs(html)).toEqual(["/"]);
    expect(html).toContain('aria-hidden="true" class="h-8"');
  });
});

describe("/compte", () => {
  it("non connecté : redirection vers la connexion", async () => {
    const { default: AccountPage } = await import("@/app/compte/page");
    await expect(AccountPage()).rejects.toMatchObject({ digest: expect.stringContaining("/connexion?next=%2Fcompte") });
  });

  it("affiche le plan effectif : un Pro expiré n'est pas présenté Pro", async () => {
    const { default: AccountPage } = await import("@/app/compte/page");
    state.viewer = { id: "u1", email: "nina@example.com" };

    state.credits = [{ plan: "pro", balance: 0, period_end: past, cancelled_at: null }];
    let html = renderToStaticMarkup(await AccountPage());
    expect(html).toContain("nina@example.com");
    expect(html).toContain("Gratuit");
    expect(html).not.toMatch(/>Pro</);
    expect(hrefs(html)).not.toContain("/resilier");

    state.credits = [{ plan: "pro", balance: 2, period_end: past, cancelled_at: null }];
    html = renderToStaticMarkup(await AccountPage());
    expect(html).toContain("Pack Deal");
    expect(html).not.toMatch(/>Pro</);

    state.credits = [{ plan: "pro", balance: 1, period_end: future(), cancelled_at: null }];
    html = renderToStaticMarkup(await AccountPage());
    expect(html).toMatch(/>Pro</);
    expect(html).toContain("Période en cours");
    expect(hrefs(html)).toEqual(expect.arrayContaining(["/historique", "/offres", "/resilier", "/compte/supprimer"]));
    expect(html).toContain('action="/auth/deconnexion"');
  });

  it("résiliation enregistrée : date de fin d'accès, plus de lien de résiliation", async () => {
    const { default: AccountPage } = await import("@/app/compte/page");
    state.viewer = { id: "u1", email: "nina@example.com" };
    state.credits = [{ plan: "pro", balance: 0, period_end: future(), cancelled_at: new Date().toISOString() }];
    const html = renderToStaticMarkup(await AccountPage());
    expect(html).toContain("Résiliation enregistrée");
    expect(html).toContain("Accès jusqu&#x27;au");
    expect(hrefs(html)).not.toContain("/resilier");
  });
});

describe("accountSummary", () => {
  it("suit displayedPlan et period_end", () => {
    expect(accountSummary(null)).toMatchObject({ plan: "free", balance: 0, periodEnd: null, canCancel: false });
    expect(accountSummary({ plan: "pro", balance: 3, period_end: past })).toMatchObject({ plan: "pack", planLabel: "Pack Deal", periodEnd: null });
    const active = accountSummary({ plan: "pro", balance: 0, period_end: future(), cancelled_at: null });
    expect(active).toMatchObject({ plan: "pro", canCancel: true, accessEndsAt: null });
    expect(active.periodEnd).toBeInstanceOf(Date);
    const cancelled = accountSummary({ plan: "pro", balance: 0, period_end: future(), cancelled_at: past });
    expect(cancelled.canCancel).toBe(false);
    expect(cancelled.accessEndsAt).toBeInstanceOf(Date);
  });
});

describe("suppression de compte : règles", () => {
  it("confirmation active par saisie du mot", () => {
    expect(isDeletionConfirmed("SUPPRIMER")).toBe(true);
    expect(isDeletionConfirmed("  supprimer ")).toBe(true);
    expect(isDeletionConfirmed("oui")).toBe(false);
    expect(isDeletionConfirmed("on")).toBe(false);
    expect(isDeletionConfirmed(null)).toBe(false);
  });

  it("refusée tant qu'un abonnement Pro actif n'est pas résilié", () => {
    expect(deletionBlocker({ plan: "pro", balance: 0, period_end: future(), cancelled_at: null })).toBe("pro_active");
    expect(deletionBlocker({ plan: "pro", balance: 0, period_end: future(), cancelled_at: past })).toBeNull();
    expect(deletionBlocker({ plan: "pro", balance: 0, period_end: past, cancelled_at: null })).toBeNull();
    expect(deletionBlocker({ plan: "pack", balance: 3, period_end: null })).toBeNull();
    expect(deletionBlocker(null)).toBeNull();
  });

  it("l'email dit ce qui est supprimé et ce qui est conservé", () => {
    const email = accountDeletionEmail({ to: "nina@example.com", siteUrl: "https://www.negoscore.fr" });
    expect(email.subject).toBe("Suppression de ton compte Negoscore");
    expect(email.text).toContain("ne sont pas remboursés");
    expect(email.text).toContain("preuves de consentement au paiement");
  });
});
