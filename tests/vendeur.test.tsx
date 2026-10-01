import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MERCHANT } from "@/lib/billing/merchant";
import { purchaseConfirmationEmail } from "@/lib/email/templates";
import { SELLER } from "@/lib/legal/identity";
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

// Mission #123 — LA CORRECTION DE #122, figée.
//
// #122 avait été écrite sur une consigne fausse : elle faisait dire aux CGV que
// Whop concluait la vente. Les conditions de Whop disent l'inverse — merchant
// of record « for the purpose of card network rules and payment settlement
// only », et l'acheteur voit le VENDEUR sur le reçu et au paiement. Ces deux
// tests échouent si cette erreur revient, sous l'une ou l'autre de ses deux
// formulations.
describe("les CGV n'attribuent jamais la vente à Whop", () => {
  const source = readFileSync("app/cgv/page.tsx", "utf8").replace(/\s+/g, " ");

  it("ni « conclue par Whop », ni « en son nom », dans la source comme à l'écran", async () => {
    const { default: TermsPage } = await import("@/app/cgv/page");
    const rendu = texte(renderToStaticMarkup(TermsPage()));
    for (const lieu of [source, rendu]) {
      expect(lieu).not.toMatch(/conclue? par Whop/i);
      expect(lieu).not.toMatch(/en son nom/i);
      // Les deux autres façons de le dire, tant qu'on y est.
      expect(lieu).not.toMatch(/Whop[^.]{0,40}revendeur/i);
      expect(lieu).not.toMatch(/Whop[^.]{0,30}(?:vend|émet le reçu)/i);
    }
  });

  it("la section « Vendeur » porte le nom du vendeur, et c'est l'éditeur", async () => {
    const { default: TermsPage } = await import("@/app/cgv/page");
    const html = renderToStaticMarkup(TermsPage());
    // Le titre, puis l'identité, dans cet ordre et dans la même section.
    const debut = html.indexOf(">Vendeur<");
    expect(debut, "titre « Vendeur » absent").toBeGreaterThan(-1);
    const section = texte(html.slice(debut, html.indexOf("Objet", debut)));
    expect(section).toContain(SELLER.name);
    expect(section).toContain(SELLER.siret);
    // Et ce qu'il fallait dire de Whop y est, sans lui attribuer la vente.
    expect(section).toContain("merchant of record pour le règlement par carte");
    expect(section).toContain(`le contrat est conclu avec ${SELLER.name}`);
  });

  it("l'objet régit bien une VENTE, pas une simple fourniture", async () => {
    const { default: TermsPage } = await import("@/app/cgv/page");
    const rendu = texte(renderToStaticMarkup(TermsPage()));
    expect(rendu).toContain(
      "Les présentes conditions régissent la vente des négociations proposées sur negoscore.fr à des consommateurs.",
    );
  });

  it("le reçu est transmis VIA Whop, il n'est pas émis par lui", async () => {
    const { default: TermsPage } = await import("@/app/cgv/page");
    const rendu = texte(renderToStaticMarkup(TermsPage()));
    expect(rendu).toContain("le reçu, qui t'est transmis via Whop, en détaille la composition");
    expect(rendu).not.toMatch(/reçu émis par Whop/i);
  });

  // L'entité qui contracte change selon la région de l'acheteur (Whop, Inc.,
  // Whop Canada Inc., Whop UK, Whop (EU)) : en nommer une serait faux pour une
  // partie des lecteurs. #122 écrivait « Whop Inc. » sur deux pages publiques.
  it("aucune entité juridique Whop n'est nommée dans une page publique", async () => {
    expect(MERCHANT.name).toBe("Whop");
    const pages = await Promise.all(
      ["@/app/cgv/page", "@/app/confidentialite/page", "@/app/tarifs/page", "@/app/mentions-legales/page"].map(
        async (chemin) => {
          const { default: Page } = (await import(chemin)) as { default: () => React.ReactElement };
          return [chemin, texte(renderToStaticMarkup(Page()))] as const;
        },
      ),
    );
    for (const [chemin, rendu] of pages) {
      expect(rendu, chemin).not.toMatch(/Whop[ ,]+(?:Inc|LLC|Ltd|Limited|Canada|UK|\(EU\))/i);
    }
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
    const phrase = "Le reçu de cet achat t'est transmis via Whop, qui opère le paiement.";
    for (const amount of [4.99, null]) {
      const { text, html } = email(amount);
      expect(text, String(amount)).toContain(phrase);
      expect(texte(html ?? ""), String(amount)).toContain(phrase);
    }
  });

  // Mission #123 — l'inverse de ce que figeait #122 : l'éditeur EST le vendeur
  // (whop.com/seller-terms : « you will be identified to the Buyer as the
  // supplier on the receipt and at checkout »). Ce qu'on interdit désormais,
  // c'est d'attribuer la vente à Whop.
  it("il n'attribue jamais la vente à Whop", () => {
    const { text, html } = email(4.99);
    for (const version of [text, texte(html ?? "")]) {
      expect(version).not.toMatch(/conclu la vente|vendu par Whop|Whop.{0,20}vendeur/i);
    }
    // L'identité du vendeur reste en signature.
    expect(text).toContain("Nathan Pakou, EI");
  });
});

describe("la politique de confidentialité", () => {
  it("Whop ne figure plus parmi les sous-traitants", async () => {
    const { default: PrivacyPage } = await import("@/app/confidentialite/page");
    const html = renderToStaticMarkup(<PrivacyPage />);
    expect(texte(html)).not.toContain("Whop — encaissement des paiements");
    expect(texte(html)).not.toContain("PostHog");
    // Les vrais sous-traitants, eux, sont toujours là.
    // Mission #142 — PostHog est sorti de la liste : la bibliothèque est
    // retirée du produit. Déclarer un sous-traitant qui n'existe plus est
    // aussi faux que d'en oublier un.
    for (const reste of ["Supabase —", "Vercel —", "OpenAI —", "Resend —"]) {
      expect(texte(html), reste).toContain(reste);
    }
  });

  it("il est requalifié en responsable de traitement distinct", async () => {
    const { default: PrivacyPage } = await import("@/app/confidentialite/page");
    const page = texte(renderToStaticMarkup(<PrivacyPage />));
    expect(page).toContain("n'est pas un sous-traitant");
    expect(page).toContain("responsable de traitement à part entière");
    // Mission #123 — ce qu'il fait pour son propre compte, c'est le PAIEMENT et
    // la TAXE. #122 écrivait ici qu'il vendait ; c'était faux.
    expect(page).toContain("il opère le paiement et la taxe pour son propre compte");
    expect(page).not.toMatch(/vend l'accès|en son propre nom/i);
    // Et la phrase se lit : pas de mot collé au nom de la marque.
    expect(page).toContain("sur laquelle Negoscore n'a pas la main");
  });
});
