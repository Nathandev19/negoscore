import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MERCHANT } from "@/lib/billing/merchant";
import { purchaseConfirmationEmail } from "@/lib/email/templates";
import { softwareApplicationJsonLd } from "@/lib/seo";

// Mission #122 — qui vend au client final.
//
// Réglage du compte Whop lu le 28/09 : « Collecte de taxes : Whop collecte et
// remet », « Type de taxe : Inclusif ». Whop est REVENDEUR (merchant of
// record) : il conclut la vente en son nom, émet le reçu, collecte et reverse
// la taxe. L'éditeur fournit le service acheté.
//
// Le produit disait le contraire partout : CGV (« prestataire de paiement »,
// section « Vendeur », mention 293 B collée à un prix), politique de
// confidentialité (Whop rangé parmi les sous-traitants), email de confirmation
// signé de l'éditeur sans dire d'où vient le reçu. Chaque correction est figée
// ici.

// Le routeur n'est pas monté hors de Next : /tarifs lit ?erreur= côté client.
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined, prefetch: () => undefined }),
  usePathname: () => "/tarifs",
  useSearchParams: () => new URLSearchParams(),
}));

const texte = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#xE9;/g, "é")
    .replace(/[\s  ]+/g, " ")
    .trim();

describe("la page qui vend dit ce que couvre le prix", () => {
  it("/tarifs l'affiche À L'ÉCRAN, et plus seulement dans sa balise meta", async () => {
    const { default: PlansPage } = await import("@/app/tarifs/page");
    const page = texte(renderToStaticMarkup(PlansPage()));
    expect(page).toContain("Les prix affichés incluent la taxe applicable, collectée et reversée par Whop selon ton pays.");
    expect(page).toContain(`sous le libellé « ${MERCHANT.statementDescriptor} »`);
    expect(page).toContain("conditions de vente");
  });

  it("le libellé du relevé est celui de la constante, jamais réécrit à la main", async () => {
    const { default: PlansPage } = await import("@/app/tarifs/page");
    const { default: TermsPage } = await import("@/app/cgv/page");
    for (const Page of [PlansPage, TermsPage]) {
      expect(texte(renderToStaticMarkup(Page()))).toContain(MERCHANT.statementDescriptor);
    }
    // Il est fixé dans le compte Whop : renommer la marque ne le renomme pas.
    expect(MERCHANT.statementDescriptor).toBe("WHOP NEGOSCORE");
  });
});

describe("le balisage structuré", () => {
  const offers = softwareApplicationJsonLd().offers;

  it("chaque offre déclare que le prix inclut la taxe", () => {
    expect(offers.length).toBeGreaterThan(0);
    for (const offer of offers) {
      expect(offer, offer.name).toHaveProperty("valueAddedTaxIncluded", true);
    }
  });

  it("aucune offre ne déclare de vendeur : une absence n'affirme rien", () => {
    // Un `seller` pointant vers l'organisation serait FAUX depuis que Whop est
    // revendeur, et il serait publié sur une page publique.
    for (const offer of offers) {
      expect(Object.keys(offer), offer.name).not.toContain("seller");
    }
    expect(JSON.stringify(softwareApplicationJsonLd())).not.toContain('"seller"');
  });
});

describe("l'email de confirmation n'est pas un reçu", () => {
  const email = (amount: number | null) =>
    purchaseConfirmationEmail({
      to: "a@b.fr",
      plan: "pack",
      amount,
      currency: amount === null ? null : "eur",
      date: new Date("2026-09-28T10:00:00Z"),
      siteUrl: "https://www.negoscore.fr",
    });

  it("il dit d'où vient le reçu, dans les deux versions", () => {
    const phrase = "Le reçu de cet achat t'est adressé par Whop, qui a conclu la vente.";
    for (const amount of [4.99, null]) {
      const { text, html } = email(amount);
      expect(text, String(amount)).toContain(phrase);
      expect(texte(html ?? ""), String(amount)).toContain(phrase);
    }
  });

  it("il n'affirme nulle part que l'éditeur est le vendeur", () => {
    const { text, html } = email(4.99);
    for (const version of [text, texte(html ?? "")]) {
      expect(version).not.toMatch(/vendeur|vendu par|nous te vendons/i);
    }
    // L'identité reste en signature : c'est l'éditeur, pas le vendeur.
    expect(text).toContain("Nathan Pakou, EI");
  });
});

describe("la politique de confidentialité", () => {
  it("Whop ne figure plus parmi les sous-traitants", async () => {
    const { default: PrivacyPage } = await import("@/app/confidentialite/page");
    const html = renderToStaticMarkup(<PrivacyPage />);
    expect(texte(html)).not.toContain("Whop — encaissement des paiements");
    // Les vrais sous-traitants, eux, sont toujours là.
    for (const reste of ["Supabase —", "Vercel —", "OpenAI —", "Resend —", "PostHog —"]) {
      expect(texte(html), reste).toContain(reste);
    }
  });

  it("il est requalifié en responsable de traitement distinct", async () => {
    const { default: PrivacyPage } = await import("@/app/confidentialite/page");
    const page = texte(renderToStaticMarkup(<PrivacyPage />));
    expect(page).toContain("n'est pas un sous-traitant");
    expect(page).toContain("responsable de traitement à part entière");
    // Et la phrase se lit : pas de mot collé au nom de la marque.
    expect(page).toContain("sur laquelle Negoscore n'a pas la main");
  });
});
