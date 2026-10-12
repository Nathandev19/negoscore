import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PLANS, PRICE } from "@/lib/billing/plans";
import { FAQ, STEPS, TRUST } from "@/lib/content/home";
import { NEGOTIATION_EXCHANGES, NEGOTIATION_TURNS, NEGOTIATIONS, negociationsCount, negotiations, WHAT_IS_A_NEGOTIATION } from "@/lib/content/vocabulaire";
import { flashMessage } from "@/lib/auth/flash";
import { navItems } from "@/components/header-nav";
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
  // Mission #183 — les surfaces de COMPTE entrent dans la garde. Elles
  // portaient « analyses » là où le reste du produit dit « négociations » :
  // le compteur de /historique sous un titre « Tes négociations », les
  // bandeaux d'arrivée, et la page de suppression. L'admin n'y est pas : il
  // garde son propre vocabulaire (lib/content/vocabulaire.ts, #176).
  "lib/content/labels.ts",
  "components/account/history-view.tsx",
  "components/solde-negociations.tsx",
  "lib/auth/flash.ts",
  "app/compte/supprimer/page.tsx",
  "app/compte/supprime/page.tsx",
  "components/account/cancel-view.tsx",
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

  it("le nombre d'échanges annoncé est celui du code", () => {
    // Mission #099 (audit B13) — le tour 1 est l'analyse : côté client on
    // compte des ÉCHANGES avec la marque, jamais des tours.
    expect(NEGOTIATION_TURNS).toBe(LAST_TURN);
    expect(NEGOTIATION_EXCHANGES).toBe(LAST_TURN - 1);
    const step = STEPS.find((entry) => entry.text.includes("échanges"));
    expect(step?.text).toContain(`${NEGOTIATION_EXCHANGES} échanges`);
    expect(WHAT_IS_A_NEGOTIATION).toContain(`${NEGOTIATION_EXCHANGES} échanges avec la marque`);
    // Plus aucun texte public ne compte des « tours ».
    for (const file of PUBLIC_COPY_FILES) expect(/\d+\s+tours/.test(read(file)), file).toBe(false);
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
    // ─── Mission #183 — « ANALYSE » NE NOMME PLUS UN ÉLÉMENT DE LA LISTE ───
    //
    // Trois formes relevées, et toutes les trois accentuées à la fin : c'est
    // là que \b ne marche PAS (missions #158 et #177 — une limite de mot
    // après « é » ne se déclenche jamais, parce que les lettres accentuées
    // sont hors de \w). Le motif se termine donc par (?![a-zà-ÿ]).
    {
      pattern: /analyses?\s+(?:enregistrées?|utilisées?|achetées?|consommées?|listées?)(?![a-zà-ÿ])/i,
      quoi: "un nombre d'analyses là où la page dit « négociations »",
    },
    // L'ensemble des éléments de la personne : « tes analyses », « Mes
    // analyses », « toutes tes analyses ».
    {
      pattern: /(?:mes|tes|ses|toutes\s+(?:mes|tes|ses))\s+analyses(?![a-zà-ÿ])/i,
      quoi: "l'ensemble des négociations appelé « analyses »",
    },
    // L'état vide de la liste.
    { pattern: /aucune\s+analyse(?![a-zà-ÿ])/i, quoi: "la liste vide appelée « analyse »" },
  ];

  // Les trois motifs posés par la #183, nommés : le test ci-dessous vérifie
  // qu'ils ne s'appuient pas sur \b et qu'ils portent le terminateur sûr.
  const MOTIFS_183 = [
    "un nombre d'analyses là où la page dit « négociations »",
    "l'ensemble des négociations appelé « analyses »",
    "la liste vide appelée « analyse »",
  ] as const;

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
    // Mission #183 — et le compteur de /historique dit le mot de son titre.
    expect(negociationsCount(2)).toBe("2 négociations enregistrées.");
    expect(negociationsCount(0)).toContain("Aucune négociation");
    expect(flashMessage("connexion", "/historique").text).toBe("Voici toutes tes négociations.");
    expect(flashMessage("connexion", "/autre").link?.label).toBe("Mes négociations");
    // Au mot près celui de la barre de navigation : les deux mènent au même
    // endroit, ils ne peuvent pas s'appeler autrement.
    expect(navItems(true).main.map((item) => item.label)).toContain("Mes négociations");
  });

  // Le piège des missions #158 et #177, vérifié sur la garde elle-même : un
  // motif écrit avec \b après une lettre accentuée ne se déclenche JAMAIS.
  // Sans ce test, la garde ci-dessus pourrait être réécrite « proprement » et
  // cesser silencieusement de garder quoi que ce soit.
  it("la garde se déclenche sur le mot ACCENTUÉ, pas seulement sur sa racine", () => {
    const motif = UNIT_PATTERNS.find((p) => p.quoi === "un nombre d'analyses là où la page dit « négociations »")?.pattern;
    expect(motif).toBeDefined();
    if (!motif) return;
    // Les formes réelles, toutes terminées par une voyelle accentuée ou par
    // un « s » qui la suit.
    for (const phrase of [
      "2 analyses enregistrées.",
      "1 analyse enregistrée.",
      "des analyses utilisées",
      "tes analyses achetées",
      "les analyses listées",
    ]) {
      expect(motif.test(phrase), phrase).toBe(true);
    }
    // LE PIÈGE, MESURÉ PLUTÔT QUE SUPPOSÉ. \b n'échoue PAS sur « enregistrées » :
    // le mot finit par « s », une lettre de \w. Il échoue sur un mot qui finit
    // PAR l'accent — et c'est exactement ce qui avait fait passer la #177 à
    // côté de « noté » : entre « é » et un non-mot, il n'y a pas de limite de
    // mot, parce qu'aucun des deux côtés n'est dans \w.
    expect(/\bnoté\b/.test("noté.")).toBe(false);
    expect(/\bnoté(?![a-zà-ÿ])/.test("noté.")).toBe(true);
// D'où le terminateur des trois motifs de cette mission : aucun ne
    // s'appuie sur \b, donc aucun ne peut être mis en échec par une finale
    // accentuée, aujourd'hui ou après une reformulation.
    for (const quoi of MOTIFS_183) {
      const trouve = UNIT_PATTERNS.find((p) => p.quoi === quoi);
      expect(trouve, quoi).toBeDefined();
      expect(trouve?.pattern.source.includes("\\b"), `${quoi} s'appuie sur \b`).toBe(false);
      expect(trouve?.pattern.source.includes("(?![a-zà-ÿ])"), `${quoi} n'a pas de terminateur sûr`).toBe(true);
    }
    // Et la RACINE seule ne suffirait pas : elle attraperait « cette analyse »,
    // qui est l'étape et reste permise.
    expect(/analyses?(?![a-zà-ÿ])/i.test("Supprimer cette analyse")).toBe(true);
    expect(motif.test("Supprimer cette analyse")).toBe(false);
    // L'étape, elle, reste permise : « analyse » suivi d'autre chose passe.
    for (const permis of ["Supprimer cette analyse", "une analyse éducative", "l'analyse continue"]) {
      expect(motif.test(permis), permis).toBe(false);
    }
  });

  it("l'ensemble des éléments de la personne ne s'appelle plus « analyses »", () => {
    const motif = UNIT_PATTERNS.find((p) => p.quoi.startsWith("l'ensemble"))?.pattern;
    expect(motif).toBeDefined();
    if (!motif) return;
    for (const phrase of ["Mes analyses", "tes analyses", "Voici toutes tes analyses."]) {
      expect(motif.test(phrase), phrase).toBe(true);
    }
    for (const permis of ["tes négociations", "Mes négociations", "cette analyse"]) {
      expect(motif.test(permis), permis).toBe(false);
    }
  });

  // Mission #183 — LA COUVERTURE DE LA GARDE EST GARDÉE.
  //
  // Relevé par la batterie de mutation : sortir un fichier de
  // PUBLIC_COPY_FILES ne faisait échouer aucun test. Les motifs étaient
  // verrouillés, la LISTE sur laquelle ils s'appliquent ne l'était pas.
  it("toutes les surfaces destinées à la créatrice sont surveillées", () => {
    const SURFACES = [
      // Copie publique (mission #093).
      "lib/content/home.ts",
      "lib/content/vocabulaire.ts",
      "lib/billing/plans.ts",
      "app/page.tsx",
      "app/tarifs/page.tsx",
      "app/cgv/page.tsx",
      // Écrans de compte (mission #183).
      "lib/content/labels.ts",
      "components/account/account-view.tsx",
      "components/account/history-view.tsx",
      "components/account/cancel-view.tsx",
      "components/solde-negociations.tsx",
      "lib/auth/flash.ts",
      "app/compte/supprimer/page.tsx",
      "app/compte/supprime/page.tsx",
    ];
    for (const surface of SURFACES) {
      expect(PUBLIC_COPY_FILES as readonly string[], `${surface} n'est plus surveillée`).toContain(surface);
    }
    // L'admin n'y est pas, et ne doit pas y entrer : il garde son propre
    // vocabulaire (mission #176, exception nommée dans vocabulaire.ts).
    for (const file of PUBLIC_COPY_FILES) expect(file, file).not.toMatch(/admin/);
  });

  it("la liste vide ne s'appelle plus « aucune analyse »", () => {
    const motif = UNIT_PATTERNS.find((p) => p.quoi.startsWith("la liste vide"))?.pattern;
    expect(motif).toBeDefined();
    if (!motif) return;
    expect(motif?.test("Aucune analyse pour l'instant.")).toBe(true);
    expect(motif?.test("Aucune analyse enregistrée pour l'instant.")).toBe(true);
    expect(motif?.test("Aucune négociation pour l'instant.")).toBe(false);
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
