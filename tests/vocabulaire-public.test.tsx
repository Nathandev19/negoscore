import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PLANS, PRICE } from "@/lib/billing/plans";
import { FAQ, STEPS, TRUST } from "@/lib/content/home";
import { NEGOTIATION_TURNS, NEGOTIATIONS, negotiations } from "@/lib/content/vocabulaire";
import { LAST_TURN } from "@/lib/negotiation/types";
import {
  CANONICAL_ORIGIN,
  PRIVATE_PREFIXES,
  PUBLIC_PAGES,
  faqJsonLd,
  organizationJsonLd,
  publicPageMetadata,
  softwareApplicationJsonLd,
  webSiteJsonLd,
} from "@/lib/seo";

// Mission #093 — l'unité vendue est la NÉGOCIATION, et elle porte le même nom
// et les mêmes nombres partout : copie, métadonnées, données structurées.
// Ces tests échouent si la cohérence se casse à nouveau.

// Le contenu SANS les commentaires : ils expliquent la règle (et citent donc
// les mots interdits) sans jamais s'afficher.
const read = (file: string) =>
  readFileSync(path.join(process.cwd(), file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");

// Fichiers qui portent de la copie destinée à la personne. Le code métier
// (base, webhook, moteur) garde son vocabulaire : « crédit » y reste permis.
const PUBLIC_COPY_FILES = [
  "lib/content/home.ts",
  "lib/content/vocabulaire.ts",
  "lib/billing/plans.ts",
  "lib/seo.ts",
  "app/manifest.ts",
  "app/page.tsx",
  "app/tarifs/page.tsx",
  "app/cgv/page.tsx",
  "components/offers/offers-list.tsx",
  "components/account/account-view.tsx",
  "components/merci/credits-waiter.tsx",
  "lib/billing/right-hint.ts",
] as const;

describe("1 et 8 — les nombres viennent du code", () => {
  it("le prix de chaque offre du JSON-LD est celui de la constante de prix", () => {
    const offers = softwareApplicationJsonLd().offers;
    const schemaPrice = (displayed: string) => displayed.replace(/\s|€/g, "").replace(",", ".");
    expect(offers.map((offer) => offer.price)).toEqual([PRICE.free, PRICE.pack, PRICE.pro].map(schemaPrice));
    for (const offer of offers) expect(offer.priceCurrency).toBe("EUR");
  });

  it("le nombre de négociations du pack, dans la copie et dans le JSON-LD, est la constante", () => {
    const pack = PLANS.find((plan) => plan.id === "pack");
    expect(pack?.summary).toBe(`${NEGOTIATIONS.pack} négociations complètes`);
    expect(NEGOTIATIONS.pack).toBe(3);
    const offer = softwareApplicationJsonLd().offers.find((entry) => entry.name === "Pack Deal");
    expect(offer?.description).toBe(pack?.summary);
    // Aucun nombre de négociations écrit à la main dans la copie publique.
    for (const file of PUBLIC_COPY_FILES) {
      // « une négociation » en toutes lettres est une tournure, pas un compte :
      // seuls les nombres écrits à la main sont interdits.
      const written = read(file).match(/\b(?:deux|trois|quatre|cinq|dix|trente|\d+)\s+négociations?\b/gi) ?? [];
      expect(written, file).toEqual([]);
    }
  });

  it("le nombre de tours annoncé est celui du code", () => {
    expect(NEGOTIATION_TURNS).toBe(LAST_TURN);
    const step = STEPS.find((entry) => entry.text.includes("tours"));
    expect(step?.text).toContain(`${LAST_TURN} tours`);
  });
});

describe("2 et 3 — un seul vocabulaire dans la copie publique", () => {
  // « Analyse » reste légitime quand il désigne l'ÉTAPE (on analyse l'offre),
  // jamais l'unité vendue. Ces tournures-là sont interdites.
  const UNIT_PATTERNS: ReadonlyArray<{ pattern: RegExp; quoi: string }> = [
    { pattern: /\d+\s*analyses?\b/i, quoi: "un nombre d'analyses vendues" },
    { pattern: /analyses?\s+(?:supplémentaires|ajoutées|restantes|disponibles|par mois)/i, quoi: "un solde d'analyses" },
    { pattern: /(?:ton|ta|une|la)\s+(?:première\s+)?analyse\s+(?:gratuite|est gratuite)/i, quoi: "l'analyse comme unité offerte" },
    { pattern: /crédits?\s+d['’]analyse/i, quoi: "des crédits d'analyse" },
    { pattern: /crédit/i, quoi: "le mot « crédit », réservé au code" },
  ];

  it("aucune formulation ne vend une « analyse » ni un « crédit »", () => {
    for (const file of PUBLIC_COPY_FILES) {
      const contenu = read(file);
      for (const { pattern, quoi } of UNIT_PATTERNS) {
        expect(pattern.test(contenu), `${file} : ${quoi}`).toBe(false);
      }
    }
  });

  it("les textes affichés emploient « négociation »", () => {
    const pack = PLANS.find((plan) => plan.id === "pack");
    expect(pack?.summary).toContain("négociations");
    expect(FAQ.some((item) => item.question === "Qu'est-ce qu'une négociation ?")).toBe(true);
    expect(TRUST.some((point) => point.text.includes("copilote de négociation"))).toBe(true);
    // Le compteur du compte dit « négociations restantes ».
    expect(read("components/account/account-view.tsx")).toContain("Négociations restantes");
  });

  it("aucune promesse de gain, aucun avis, aucun compteur d'utilisateurs", () => {
    const interdits = /garanti|jusqu'à \+?\d+\s*%|témoign|avis client|★|\d[\d\s]*\s*(?:créateurs|utilisateurs|clients)\b/i;
    for (const file of PUBLIC_COPY_FILES) expect(interdits.test(read(file)), file).toBe(false);
  });
});

describe("4, 5 — sitemap et adresses canoniques", () => {
  it("le sitemap ne contient aucune route privée ni la zone propriétaire", async () => {
    const { default: sitemap } = await import("@/app/sitemap");
    const urls = sitemap().map((entry) => entry.url);
    expect(urls.length).toBe(PUBLIC_PAGES.length);
    for (const url of urls) {
      expect(url.startsWith(CANONICAL_ORIGIN)).toBe(true);
      const chemin = url.slice(CANONICAL_ORIGIN.length) || "/";
      for (const prefixe of PRIVATE_PREFIXES) expect(chemin.startsWith(prefixe), `${chemin} / ${prefixe}`).toBe(false);
      expect(chemin).not.toContain("/dev");
    }
  });

  it("chaque page publique expose un canonical absolu sur le domaine servi", () => {
    for (const page of PUBLIC_PAGES) {
      const meta = publicPageMetadata(page.path);
      const canonical = String(meta.alternates?.canonical ?? "");
      // metadataBase (app/layout.tsx) rend l'adresse absolue au rendu ; la
      // valeur déclarée reste le chemin, et le domaine est celui servi.
      expect(new URL(canonical, CANONICAL_ORIGIN).href).toBe(
        `${CANONICAL_ORIGIN}${page.path === "/" ? "/" : page.path}`,
      );
      expect(CANONICAL_ORIGIN.startsWith("https://")).toBe(true);
      expect(meta.description?.length).toBeGreaterThanOrEqual(140);
      expect(meta.description?.length).toBeLessThanOrEqual(160);
      expect(meta.description).toMatch(/négociation/i);
    }
  });
});

describe("6, 7 — données structurées", () => {
  const blocs = [organizationJsonLd(), webSiteJsonLd(), softwareApplicationJsonLd(), faqJsonLd()];

  it("aucun aggregateRating, aucun review", () => {
    const json = JSON.stringify(blocs);
    expect(json).not.toMatch(/aggregateRating|"review"|ratingValue|reviewCount/i);
  });

  it("la FAQ balisée est mot pour mot celle qui est affichée", () => {
    const questions = faqJsonLd().mainEntity;
    expect(questions).toHaveLength(FAQ.length);
    for (const [index, entry] of questions.entries()) {
      expect(entry.name).toBe(FAQ[index].question);
      expect(entry.acceptedAnswer.text).toBe(FAQ[index].answer);
    }
    // Même source pour l'écran et pour le balisage : la page affiche CE
    // tableau, question et réponse, sans le réécrire (le rendu est vérifié par
    // tests/site-layout.test.tsx).
    const page = read("app/page.tsx");
    expect(page).toContain("{FAQ.map((item) =>");
    expect(page).toContain("{item.question}");
    expect(page).toContain("{item.answer}");
  });

  it("l'application déclare la langue, la catégorie et le support", () => {
    const app = softwareApplicationJsonLd();
    expect(app.inLanguage).toBe("fr-FR");
    expect(app.operatingSystem).toBe("Web");
    expect(app.applicationCategory).toBe("BusinessApplication");
    expect(app.description).toBe(PUBLIC_PAGES.find((page) => page.path === "/")?.description);
    expect(app.offers.map((offer) => offer.name)).toEqual(PLANS.map((plan) => plan.name));
  });

  it("le résumé d'une négociation est le même partout", () => {
    expect(negotiations(1)).toBe("1 négociation");
    expect(negotiations(3)).toBe("3 négociations");
  });
});
