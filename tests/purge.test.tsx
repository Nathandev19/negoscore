import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { purgeCutoffs } from "@/lib/privacy/purge";

const purge = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("@/lib/privacy/purge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/privacy/purge")>()),
  runPurge: purge.run,
}));
vi.mock("@/components/site-header", () => ({ SiteHeader: () => null }));

const { GET } = await import("@/app/api/purge/route");

function call(authorization?: string) {
  return GET(new Request("http://localhost:3000/api/purge", { headers: authorization ? { authorization } : {} }));
}

beforeEach(() => {
  purge.run.mockReset();
  purge.run.mockResolvedValue({ documents: 0, files_removed: 0, usage_guard: 0, whop_events: 0, checkout_consents: 0 });
  vi.stubEnv("CRON_SECRET", "secret-de-test");
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("/api/purge", () => {
  it("refuse un appel sans le bon secret, sans rien purger", async () => {
    for (const header of [undefined, "Bearer mauvais", "secret-de-test", "Bearer secret-de-tes", "Bearer secret-de-test2"]) {
      expect((await call(header)).status, String(header)).toBe(401);
    }
    expect(purge.run).not.toHaveBeenCalled();
  });

  it("refuse tout appel si CRON_SECRET n'est pas défini", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await call("Bearer ")).status).toBe(401);
    expect((await call("Bearer undefined")).status).toBe(401);
    expect(purge.run).not.toHaveBeenCalled();
  });

  it("avec le secret Vercel Cron : purge et renvoie ce qui a été supprimé", async () => {
    purge.run.mockResolvedValue({ documents: 2, files_removed: 2, usage_guard: 5, whop_events: 0, checkout_consents: 0 });
    const response = await call("Bearer secret-de-test");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ documents: 2, files_removed: 2, usage_guard: 5, whop_events: 0, checkout_consents: 0 });
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"event":"purge"'));
  });
});

describe("durées de conservation", () => {
  it("documents purgés dès 29 jours (jamais plus de 30 avec une purge quotidienne), IP 30 jours, paiements 5 ans", () => {
    const cutoffs = purgeCutoffs(new Date("2026-09-17T03:00:00.000Z"));
    expect(cutoffs.documents).toBe("2026-08-19T03:00:00.000Z");
    expect(cutoffs.usageGuard).toBe("2026-08-18T03:00:00.000Z");
    expect(cutoffs.paymentRecords).toBe("2021-09-17T03:00:00.000Z");
  });
});

describe("politique de confidentialité", () => {
  it("reprend le texte fourni", async () => {
    const { default: PrivacyPage } = await import("@/app/confidentialite/page");
    const html = renderToStaticMarkup(<PrivacyPage />).replace(/&#x27;/g, "'");
    for (const text of [
      "Email de l'acheteur, montant et offre achetée — preuve de la transaction et suivi des paiements — obligation légale et intérêt légitime.",
      "Coordonnées bancaires — traitées exclusivement par Whop, jamais reçues ni conservées par Negoscore.",
      "Adresse IP sous forme hachée — limitation des abus et de l'usage gratuit — intérêt légitime — conservée 30 jours au maximum.",
      "Documents déposés : supprimés 30 jours après l'analyse.",
      "Compte et analyses : jusqu'à la suppression du compte par l'utilisateur.",
      "Journal des paiements et preuves de consentement : 5 ans, y compris après la suppression du compte.",
      "Adresses IP hachées : 30 jours au maximum.",
      "Données de facturation détenues par Whop : selon ses propres durées.",
      "Suppression de ton compte",
      "Tu peux supprimer ton compte depuis la page Mon compte, à tout moment et sans justification. Sont supprimés immédiatement : ton identifiant de connexion, ton adresse email, les offres que tu as déposées, les documents téléversés et les analyses produites. Sont conservés : le journal des paiements et les preuves de consentement liées à tes achats, pendant 5 ans, afin de pouvoir justifier d'une transaction en cas de litige. Les crédits d'analyse non utilisés sont perdus et ne sont pas remboursés.",
      "17 septembre 2026",
    ]) {
      expect(html.replace(/\s+/g, " "), text).toContain(text);
    }
    expect(html).not.toContain("Données de paiement");
    expect(html).not.toContain("durée de prescription");
    expect(html.indexOf("Durées de conservation")).toBeLessThan(html.indexOf("Suppression de ton compte"));
    expect(html.indexOf("Suppression de ton compte")).toBeLessThan(html.indexOf("Sous-traitants"));
  });
});
