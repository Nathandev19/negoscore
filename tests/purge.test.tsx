import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COOKIES } from "@/lib/legal/cookies";
import { purgeCutoffs } from "@/lib/privacy/purge";

const purge = vi.hoisted(() => ({ run: vi.fn() }));
// Rattrapage des paiements branché sur le même cron (mission #060).
const recovery = vi.hoisted(() => ({ run: vi.fn(), settle: vi.fn() }));
// Mission #099 : le même cron reprend les analyses non décomptées (audit A1)
// et dit depuis combien de temps il ne passait plus (audit A5).
const debits = vi.hoisted(() => ({ run: vi.fn() }));
const runs = vi.hoisted(() => ({ late: vi.fn(), mark: vi.fn() }));
vi.mock("@/lib/analysis/debit-recovery", () => ({ recoverPendingDebits: debits.run }));
vi.mock("@/lib/privacy/job-runs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/privacy/job-runs")>()),
  reportLateness: runs.late,
  markSuccess: runs.mark,
}));
// Mission #092 : la même purge règle aussi les paiements encaissés sans
// contrepartie (Pro sans activation, paiement sans compte).
vi.mock("@/lib/billing/webhook-recovery", () => ({
  recoverPendingWhopEvents: recovery.run,
  settleUnpaidCounterparts: recovery.settle,
}));
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
  recovery.run.mockReset();
  recovery.settle.mockReset();
  recovery.run.mockResolvedValue({ repris: 0, traites: 0, echecs: 0, en_attente: 0 });
  recovery.settle.mockResolvedValue({ pro_ouverts: 0, abandons: 0 });
  purge.run.mockResolvedValue({ documents: 0, files_removed: 0, source_texts: 0, usage_guard: 0, whop_events: 0, checkout_consents: 0 });
  debits.run.mockReset();
  runs.late.mockReset();
  runs.mark.mockReset();
  debits.run.mockResolvedValue({ decomptes: 0, supprimees: 0, echecs: 0 });
  runs.late.mockResolvedValue(null);
  runs.mark.mockResolvedValue(undefined);
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
    expect(recovery.run).not.toHaveBeenCalled();
  });

  it("refuse tout appel si CRON_SECRET n'est pas défini", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await call("Bearer ")).status).toBe(401);
    expect((await call("Bearer undefined")).status).toBe(401);
    expect(purge.run).not.toHaveBeenCalled();
  });

  it("avec le secret Vercel Cron : purge et renvoie ce qui a été supprimé", async () => {
    purge.run.mockResolvedValue({ documents: 2, files_removed: 2, source_texts: 3, usage_guard: 5, whop_events: 0, checkout_consents: 0 });
    const response = await call("Bearer secret-de-test");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      documents: 2,
      files_removed: 2,
      source_texts: 3,
      usage_guard: 5,
      whop_events: 0,
      checkout_consents: 0,
      paiements: { repris: 0, traites: 0, echecs: 0, en_attente: 0 },
      contreparties: { pro_ouverts: 0, abandons: 0 },
      decomptes: { decomptes: 0, supprimees: 0, echecs: 0 },
      retard_heures: null,
    });
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"event":"purge"'));
    // Mission #099 : le passage réussi est enregistré, pour que le suivant
    // sache depuis combien de temps le cron ne passait plus.
    expect(runs.mark).toHaveBeenCalled();
  });
});

describe("durées de conservation", () => {
  // Durées annoncées dans la politique : 30 jours pour les documents ET pour les
  // IP hachées. La purge ne tourne qu'une fois par jour : couper à 29 jours est
  // ce qui garantit qu'aucune des deux ne dépasse jamais 30 jours réels.
  it("documents et IP hachées purgés dès 29 jours (jamais plus de 30 avec une purge quotidienne), paiements 5 ans", () => {
    const cutoffs = purgeCutoffs(new Date("2026-09-17T03:00:00.000Z"));
    expect(cutoffs.documents).toBe("2026-08-19T03:00:00.000Z");
    expect(cutoffs.usageGuard).toBe("2026-08-19T03:00:00.000Z");
    expect(cutoffs.paymentRecords).toBe("2021-09-17T03:00:00.000Z");
  });
});

describe("politique de confidentialité", () => {
  it("annonce tous les cookies posés par le produit", async () => {
    const { ACCESS_COOKIE, REFRESH_COOKIE, VERIFIER_COOKIE } = await import("@/lib/auth/session");
    const { SESSION_HINT_COOKIE } = await import("@/lib/auth/session-hint");
    const { FLASH_COOKIE } = await import("@/lib/auth/flash");
    const { RIGHT_HINT_COOKIE } = await import("@/lib/billing/right-hint");
    const { TIER_COOKIE } = await import("@/lib/rates/tier");
    const { ANON_COOKIE } = await import("@/lib/security/request");
    const announced = COOKIES.join(" ");
    const known = [ACCESS_COOKIE, REFRESH_COOKIE, VERIFIER_COOKIE, SESSION_HINT_COOKIE, FLASH_COOKIE, RIGHT_HINT_COOKIE, TIER_COOKIE, ANON_COOKIE];
    for (const name of known) expect(announced, name).toContain(name);
    // Aucun autre nom de cookie défini dans le code sans être annoncé.
    const sources = ["app", "components", "lib"].flatMap((dir) =>
      readdirSync(path.join(process.cwd(), dir), { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
        .map((entry) => readFileSync(path.join(entry.parentPath, entry.name), "utf8")),
    );
    const defined = sources.flatMap((text) => [...text.matchAll(/_COOKIE = "([a-z_]+)"/g)].map((match) => match[1]));
    expect(defined.length).toBeGreaterThanOrEqual(8);
    for (const name of defined) expect(announced, name).toContain(name);
  });

  // Mission #049 : la mesure d'audience ne dépose plus rien. Si un cookie ou un
  // stockage PostHog revient, la page ne l'annonce plus : ce test échoue avant.
  it("la mesure d'audience tourne sans rien écrire sur l'appareil", () => {
    const client = readFileSync(path.join(process.cwd(), "lib/analytics/client.ts"), "utf8");
    expect(client).toContain('cookieless_mode: "always"');
    // Aucune option qui rétablirait un stockage : persistence, cookie, opt-in.
    expect(client).not.toMatch(/persistence\s*:|set_cookie|opt_in_capturing|cookieless_mode:\s*"on_reject"/);
    expect(COOKIES.join(" ")).not.toMatch(/ph_|posthog/i);
  });

  it("reprend le texte fourni", async () => {
    const { default: PrivacyPage } = await import("@/app/confidentialite/page");
    const html = renderToStaticMarkup(<PrivacyPage />).replace(/&#x27;/g, "'");
    for (const text of [
      "Email de l'acheteur, montant et formule achetée — preuve de la transaction et suivi des paiements — obligation légale et intérêt légitime.",
      "Coordonnées bancaires — traitées exclusivement par Whop, jamais reçues ni conservées par Negoscore.",
      "Adresse IP sous forme hachée — limitation des abus et de l'usage gratuit — intérêt légitime — conservée 30 jours au maximum.",
      "Documents déposés : supprimés 30 jours après l'analyse.",
      "Texte des offres collé dans le champ d'analyse : supprimé 30 jours après l'analyse. L'analyse, elle, reste disponible et conserve la marque, les montants et des phrases rédigées par l'outil d'analyse, qui peuvent citer le prénom de ton interlocuteur. Supprimer l'analyse efface tout.",
      "Compte et analyses : jusqu'à la suppression du compte par l'utilisateur. Une analyse lancée sans compte est supprimée au bout de 30 jours au maximum, avec l'offre qui l'a produite : c'est aussi la durée pendant laquelle ce navigateur peut la consulter et la supprimer lui-même.",
      "Avis sur une estimation (réponse et commentaire facultatif de 200 caractères au plus, que tu rédiges toi-même) : conservés tant que l'analyse existe, et supprimés avec elle, que tu supprimes l'analyse ou ton compte.",
      "Journal des paiements et preuves de consentement : 5 ans, y compris après la suppression du compte.",
      "Adresses IP hachées : 30 jours au maximum.",
      "Données de facturation détenues par Whop : selon ses propres durées.",
      "Suppression de ton compte",
      // Mission #099 (audit B7) : la réserve du Pro actif est écrite, et elle dit vrai — la suppression est possible dès la résiliation.
      "Tu peux supprimer ton compte depuis la page Mon compte, sans justification. Une seule réserve : un abonnement Pro encore actif et non résilié doit d'abord être résilié, parce que supprimer le compte ne l'arrêterait pas et qu'il continuerait à être prélevé. La résiliation est gratuite et en ligne ; dès qu'elle est enregistrée, la suppression est possible, sans attendre la fin de la période déjà payée. Sont supprimés immédiatement : ton identifiant de connexion, ton adresse email, les offres que tu as déposées, les documents téléversés et les analyses produites. Sont conservés : le journal des paiements et les preuves de consentement liées à tes achats, pendant 5 ans, afin de pouvoir justifier d'une transaction en cas de litige. Les négociations non utilisées sont perdues et ne sont pas remboursées.",
      "Avec ou sans compte, tu peux aussi supprimer une analyse depuis sa page de résultat, avec le navigateur ou le compte qui l'a lancée : l'analyse, le texte de l'offre et le fichier déposé sont supprimés immédiatement.",
      "17 septembre 2026",
      // Mission #047 : cookies et brouillon local.
      "Cookies et stockage dans ton navigateur",
      // Mission #049 : mesure d'audience sans stockage, donc sans bannière.
      "La mesure d'audience ne dépose ni ne lit rien sur ton appareil : aucun cookie, aucun stockage local, aucun identifiant conservé d'une visite à l'autre. C'est pourquoi aucune bannière de consentement ne t'est présentée.",
      "Il ne quitte pas ton appareil tant que tu ne lances pas l'analyse. Il est effacé dès qu'une analyse aboutit, ou au bout de 24 heures.",
      ...COOKIES,
    ]) {
      expect(html.replace(/\s+/g, " "), text).toContain(text);
    }
    expect(html).not.toContain("Données de paiement");
    expect(html).not.toContain("durée de prescription");
    expect(html.indexOf("Durées de conservation")).toBeLessThan(html.indexOf("Suppression de ton compte"));
    expect(html.indexOf("Suppression de ton compte")).toBeLessThan(html.indexOf("Sous-traitants"));
  });
});
