import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CONSENT_LINK_LABEL, CONSENT_TEXT, CONSENT_VERSION } from "@/lib/billing/consent";
import { renderToStaticMarkup } from "react-dom/server";
import { purchaseConfirmationEmail } from "@/lib/email/templates";

const ROOT = process.cwd();

function read(file: string): string {
  return readFileSync(path.join(ROOT, file), "utf8");
}

function filesIn(dir: string): string[] {
  return readdirSync(path.join(ROOT, dir), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name));
}

// Le fichier est en .ts : la page est appelée comme une fonction, sans JSX.
const render = (Page: () => React.ReactElement) =>
  renderToStaticMarkup(Page()).replace(/&#x27;/g, "'").replace(/\s+/g, " ");

const legalPages = {
  "mentions-legales": read("app/mentions-legales/page.tsx"),
  confidentialite: read("app/confidentialite/page.tsx"),
  cgv: read("app/cgv/page.tsx"),
};

describe("pages légales", () => {
  it("reprennent l'identité du vendeur", () => {
    const identity = read("lib/legal/identity.ts");
    for (const value of ["Nathan Pakou Gakosso Owah", "77 rue François Arago, 93100 Montreuil", "99960042200011", "contact@negoscore.fr", "07 53 10 30 76", "TVA non applicable, article 293 B du CGI."]) {
      expect(identity).toContain(value);
    }
    expect(legalPages["mentions-legales"]).toContain("440 N Barranca Ave #4133, Covina, CA 91723");
    expect(legalPages["mentions-legales"]).toContain("Directeur de la publication");
  });

  it("confidentialité : traitements, sous-traitants, transferts et CNIL", () => {
    const page = legalPages.confidentialite;
    for (const value of [
      "Adresse IP sous forme hachée",
      "Documents déposés : supprimés 30 jours après l'analyse.",
      "OpenAI — analyse automatisée du contenu des offres — États-Unis.",
      "clauses\n          contractuelles types de la Commission européenne",
      "3 place de Fontenoy, TSA 80715, 75334 Paris Cedex",
      "www.cnil.fr",
    ]) {
      expect(page.replace(/\s+/g, " ")).toContain(value.replace(/\s+/g, " "));
    }
  });

  it("CGV : article L221-28 13°, ses trois conditions et la résiliation en ligne", () => {
    const page = legalPages.cgv.replace(/\s+/g, " ");
    expect(page).toContain("article L221-28 13° du code de la consommation");
    expect(page).toContain("le consommateur a donné préalablement son consentement exprès");
    expect(page).toContain("il a reconnu qu'il perdra son droit de rétractation");
    expect(page).toContain("le vendeur lui a fourni une confirmation de son accord sur support durable");
    expect(page).toContain("Résilier votre contrat");
    expect(page).toContain("Les négociations achetées séparément restent acquises.");
  });

  // Mission #122 — Whop est REVENDEUR (merchant of record) : réglage du compte
  // lu le 28/09, « Whop collecte et remet », « Type de taxe : Inclusif ». Deux
  // formulations sont désormais interdites dans les CGV, et les deux l'étaient
  // encore la veille.
  it("CGV : Whop n'est plus qualifié de prestataire de paiement", async () => {
    const { default: TermsPage } = await import("@/app/cgv/page");
    const rendu = render(TermsPage);
    // Ni à l'écran, ni dans la source : un commentaire qui la citerait ferait
    // croire à la formulation retirée en la relisant.
    for (const texte of [legalPages.cgv.replace(/\s+/g, " "), rendu]) {
      expect(texte).not.toMatch(/prestataire de paiement/i);
    }
    // Mission #123 — ce qui la remplace : Whop est merchant of record pour le
    // RÈGLEMENT et pour la TAXE, et le titre de la section redevient
    // « Vendeur », parce que le vendeur est bien l'éditeur.
    expect(rendu).toContain("merchant of record pour le règlement par carte");
    expect(rendu).toContain("Vendeur");
  });

  it("CGV : la franchise en base de TVA n'y figure plus", async () => {
    const { default: TermsPage } = await import("@/app/cgv/page");
    const rendu = render(TermsPage);
    for (const texte of [legalPages.cgv.replace(/\s+/g, " "), rendu]) {
      expect(texte).not.toMatch(/293\s*B/);
    }
    // Elle décrit le régime de l'éditeur : elle reste dans les mentions légales.
    const { default: LegalNoticePage } = await import("@/app/mentions-legales/page");
    expect(render(LegalNoticePage)).toContain("293 B");
  });

  it("plus aucun marqueur d'inachèvement : la section Médiation est écrite", () => {
    const withMarker = filesIn("app").filter((file) => readFileSync(file, "utf8").includes("<ToFill>"));
    expect(withMarker).toEqual([]);
    const cgv = legalPages.cgv.replace(/\s+/g, " ");
    expect(cgv).toContain("articles L612-1 et suivants du code de la consommation");
    expect(cgv).toContain("adhésion à un médiateur est en cours");
  });

  it("aucun renvoi vers la plateforme européenne de règlement en ligne des litiges", () => {
    const sources = [...filesIn("app"), ...filesIn("components"), ...filesIn("lib")];
    const offenders = sources.filter((file) => /ec\.europa\.eu\/consumers\/odr/i.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });
});

describe("case à cocher du paiement", () => {
  it("porte le texte fourni et la version du 16 septembre 2026", () => {
    expect(CONSENT_VERSION).toBe("2026-09-16");
    expect(CONSENT_TEXT).toBe(
      "J'accepte que l'exécution du service commence immédiatement, avant la fin du délai de rétractation de 14 jours, et je reconnais que je perdrai mon droit de rétractation une fois le service fourni. J'ai lu et j'accepte les conditions générales de vente.",
    );
    expect(CONSENT_TEXT).toContain(CONSENT_LINK_LABEL);
  });

  it("reste obligatoire, non pré-cochée, avec le lien vers les CGV", () => {
    const form = read("components/offers/plan-checkout-form.tsx");
    expect(form).toContain("useState(false)");
    expect(form).toContain('name="consent"');
    expect(form).toContain("required");
    expect(form).not.toContain("defaultChecked");
    expect(form).toContain('href="/cgv"');
    // Bouton indisponible sans la case cochée, et pendant l'envoi (mission #071).
    expect(form).toContain("aria-disabled={!accepted || sending}");
    // Le serveur revérifie la case avant de créer le checkout.
    expect(read("app/api/checkout/route.ts")).toContain('consent !== "on"');
  });
});

describe("email de confirmation d'achat", () => {
  const email = purchaseConfirmationEmail({
    to: "acheteuse@exemple.fr",
    plan: "pack",
    amount: 4.99,
    currency: "eur",
    date: new Date("2026-09-16T10:00:00Z"),
    siteUrl: "https://www.negoscore.fr",
  });

  it("reprend le contenu fourni, ligne par ligne", () => {
    expect(email.subject).toBe("Confirmation de ton achat Negoscore");
    expect(email.to).toBe("acheteuse@exemple.fr");
    for (const line of [
      "Bonjour,",
      "Ton paiement est confirmé.",
      "Formule : Pack Deal",
      "Montant : 4,99 €",
      "Date : 16 septembre 2026",
      "Ce que tu as obtenu : 3 négociations ajoutées à ton compte",
      "Tu as accepté, au moment du paiement, que l'exécution du service commence immédiatement, avant la fin du délai de rétractation de 14 jours, et tu as reconnu perdre ton droit de rétractation une fois le service fourni. Cet email constitue la confirmation de cet accord.",
      "Les conditions : https://www.negoscore.fr/cgv",
      "Une question : contact@negoscore.fr",
      "— Negoscore",
      "Nathan Pakou Gakosso Owah, EI — 77 rue François Arago, 93100 Montreuil",
      "SIRET 99960042200011",
    ]) {
      expect(email.text).toContain(line);
    }
  });

  it("décrit la formule Pro quand c'est un abonnement", () => {
    const pro = purchaseConfirmationEmail({
      to: "acheteuse@exemple.fr",
      plan: "pro",
      amount: 12.99,
      currency: "eur",
      date: new Date("2026-09-16T10:00:00Z"),
      siteUrl: "https://www.negoscore.fr",
    });
    expect(pro.text).toContain("Formule : Pro");
    expect(pro.text).toContain("Montant : 12,99 €");
    expect(pro.text).toContain("Ce que tu as obtenu : accès Pro, jusqu'à 30 négociations par mois");
  });
});
