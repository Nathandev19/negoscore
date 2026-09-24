import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LegalNotice } from "@/components/result/analysis-blocks";
import { composeAnalysis } from "@/lib/analysis/compose";
import { recomputeForTier } from "@/lib/analysis/recompute";
import sampleExtraction from "@/lib/fixtures/sample-extraction.json";
import { missingClausesView, readableClause } from "@/lib/legal/fr";
import { extractionSchema, PRICE_PLACEHOLDER, type Extraction } from "@/lib/llm/prompt";
import {
  amountPhrase,
  carriesCounterOffer,
  completeMessage,
  inventedNumbers,
  messageCoverage,
  needsRewrite,
  pointCovered,
} from "@/lib/negotiation/coverage";
import { analysisSchema, type Analysis } from "@/lib/schema";

// Mission #115 — le message doit porter ce que l'analyse a établi, et plus
// aucune puce vide.

const base = () => extractionSchema.parse(structuredClone(sampleExtraction)) as Extraction;

// L'offre réelle du 24/09 : 2 vidéos TikTok, commission de 15 %, aucun fixe,
// droits pub 6 mois. Le message produit tenait en une phrase.
const AFFILIATION: Extraction = {
  ...base(),
  deal: {
    ...base().deal,
    brand: "Marque",
    deliverables: [{ type: "video", platform: "tiktok", quantity: 2, format: null }],
    usage: { organic: true, paid_ads: true, whitelisting: false, spark_ads: false, perpetual: false, duration_months: 6, territory: null },
    exclusivity: { present: false, duration_months: null, category: null },
    raw_footage: false,
    ip_transfer: "license",
    ai_training_rights: "absent",
    revisions: { count: 2, unlimited: false },
    payment: { amount_eur: null, currency: "EUR", terms_days: null, schedule: null },
    in_kind_value_eur: null,
  },
  negotiate: [
    { label: "Demander une rémunération fixe", why: "Une commission seule ne garantit aucun revenu.", priority: 1, topic: "other" },
    { label: "Préciser le territoire et les emplacements publicitaires", why: "Sans cadre, la marque diffuse partout.", priority: 2, topic: "territory" },
    { label: "Publication sur ton propre compte", why: "Ce n'est pas la même chose qu'une diffusion par la marque.", priority: 3, topic: "other" },
  ],
  ready_to_send_message: {
    tone: "cordial",
    text: "Merci pour ta proposition. Peux-tu me préciser quel budget est prévu par la marque pour ce partenariat ?",
  },
};

const PAUVRE = AFFILIATION.ready_to_send_message.text;

// ─── A1 — la fonction pure ──────────────────────────────────────────────────

describe("A1 — quels points le message laisse de côté", () => {
  it("le sujet décide, sur une dizaine de formes de message", () => {
    const cas: Array<[string, string, boolean]> = [
      ["Demander une rémunération fixe", "Peux-tu me préciser le budget prévu ?", true],
      ["Demander une rémunération fixe", "Mon tarif se situe entre 300 et 620 €.", true],
      ["Demander une rémunération fixe", "Quand penses-tu publier ?", false],
      ["Préciser le territoire", "Sur quels pays la diffusion est-elle prévue ?", true],
      ["Préciser le territoire", "Je te confirme les deux vidéos.", false],
      ["Encadrer les droits pub", "Les droits publicitaires sont-ils limités à 6 mois ?", true],
      ["Encadrer les droits pub", "Je suis partante pour ce projet.", false],
      ["Limiter l'exclusivité à 1 mois", "Une exclusivité d'un mois me va.", true],
      ["Limiter l'exclusivité à 1 mois", "Le paiement à 30 jours me convient.", false],
      ["Paiement à 30 jours", "Un acompte à la signature serait parfait.", true],
      ["Limiter les révisions", "Deux allers-retours de révision me semblent suffisants.", true],
      ["Publication sur ton propre compte", "La publication se fera sur mon compte.", true],
      ["Publication sur ton propre compte", "Merci pour ta proposition.", false],
    ];
    for (const [label, message, expected] of cas) {
      expect(pointCovered(label, message), `${label} / ${message}`).toBe(expected);
    }
  });

  it("l'offre d'affiliation : les trois points manquent au message d'origine", () => {
    const analysis = composeAnalysis(AFFILIATION);
    const coverage = messageCoverage(analysis, PAUVRE);
    expect(coverage.uncovered.map((point) => point.label)).toEqual([
      "Préciser le territoire et les emplacements publicitaires",
      "Publication sur ton propre compte",
    ]);
    // « budget » parle bien de rémunération : ce point-là, il le traitait.
    expect(pointCovered("Demander une rémunération fixe", PAUVRE)).toBe(true);
    expect(coverage.ok).toBe(false);
  });

  it("le chiffre de la contre-offre est cherché sous toutes ses formes", () => {
    const counter = { amount_low: 1150, amount_high: 2730, changes: [] };
    expect(carriesCounterOffer(counter, "entre 1 150 € et 2 730 €")).toBe(true);
    expect(carriesCounterOffer(counter, "between €1,150 and €2,730")).toBe(true);
    expect(carriesCounterOffer(counter, "de 1150 à 2730")).toBe(true);
    expect(carriesCounterOffer(counter, "je te dirai mon tarif")).toBe(false);
    // Sans contre-offre chiffrée, il n'y a rien à porter.
    expect(carriesCounterOffer({ amount_low: null, amount_high: null, changes: [] }, "rien")).toBe(true);
  });
});

// ─── A2 et A3 — la règle, et ce qui se passe quand elle n'est pas tenue ─────

describe("A2 et A3 — le message complété", () => {
  it("l'offre d'affiliation : le message porte le fixe, le territoire, la publication, et la fourchette", () => {
    const analysis = composeAnalysis(AFFILIATION);
    const text = analysis.ready_to_send_message.text;
    expect([analysis.estimate.total_low, analysis.estimate.total_high]).toEqual([300, 620]);
    expect(messageCoverage(analysis, text).ok).toBe(true);
    expect(text).toContain("budget");
    expect(text).toContain("territoire");
    expect(text.toLowerCase()).toContain("publication sur ton propre compte");
    expect(text.replace(/[\u202f\u00a0]/g, " ")).toContain("entre 300 € et 620 €");
  });

  it("le complément ne réécrit pas : ce que le modèle a produit reste en tête", () => {
    const analysis = composeAnalysis(AFFILIATION);
    expect(analysis.ready_to_send_message.text.startsWith(PAUVRE)).toBe(true);
  });

  it("A4 — un paragraphe, pas une liste à puces", () => {
    const text = composeAnalysis(AFFILIATION).ready_to_send_message.text;
    expect(text).not.toContain("\n-");
    expect(text).not.toContain("•");
    expect(text.split("\n").length).toBeLessThanOrEqual(2);
  });

  it("un message déjà complet n'est pas touché", () => {
    const complet: Extraction = {
      ...AFFILIATION,
      ready_to_send_message: {
        tone: "cordial",
        text: `Merci pour ta proposition. Je souhaiterais un fixe, mon tarif se situe ${PRICE_PLACEHOLDER}. Peux-tu préciser le territoire et les emplacements publicitaires, ainsi que la publication sur mon propre compte ?`,
      },
    };
    const analysis = composeAnalysis(complet);
    expect(messageCoverage(analysis, analysis.ready_to_send_message.text).ok).toBe(true);
    expect(analysis.ready_to_send_message.text).not.toContain("Avant d'aller plus loin");
  });

  it("A5 — le message ne cite aucun chiffre que l'analyse n'a pas produit", () => {
    const analysis = composeAnalysis(AFFILIATION);
    expect(inventedNumbers(analysis, analysis.ready_to_send_message.text)).toEqual([]);
    // Un chiffre glissé à la main est repéré.
    expect(inventedNumbers(analysis, "Je demande 4 200 € et 9 vidéos.")).toContain("4200");
  });

  it("la régénération est demandée quand le modèle a laissé un point de côté, et pas sinon", () => {
    const analysis = composeAnalysis(AFFILIATION);
    expect(needsRewrite(AFFILIATION, analysis)).toBe(true);
    const complet = { ready_to_send_message: { text: `Mon tarif se situe ${PRICE_PLACEHOLDER}, et je voudrais préciser le territoire et les emplacements publicitaires, ainsi que la publication sur mon propre compte.` } };
    expect(needsRewrite(complet, analysis)).toBe(false);
  });

  it("la route demande bien cette seconde version, et une seule", () => {
    const route = readFileSync("app/api/analyse/route.ts", "utf8");
    // Le déclencheur, l'appel, et le fait qu'il n'y en ait qu'un.
    expect(route).toContain("if (needsRewrite(result.extraction, analysis)) {");
    expect(route).toContain("await rewriteMessage(analysis)");
    expect(route.match(/rewriteMessage\(/g) ?? []).toHaveLength(1);
    // Un échec de la seconde version ne fait pas échouer l'analyse : le
    // complément déterministe a déjà fait le travail.
    expect(route).toContain("message_reecriture_impossible");
  });

  it("le montant ajouté suit le niveau : il est réécrit par le recalcul, pas laissé périmé", () => {
    const starter = composeAnalysis(AFFILIATION, { tier: "starter" });
    const confirmed = recomputeForTier(starter, "confirmed");
    const text = confirmed?.ready_to_send_message?.text ?? "";
    expect(text).not.toContain("entre 300");
    expect(messageCoverage(confirmed as Analysis, text).ok).toBe(true);
  });

  it("le complément parle la langue de l'analyse", () => {
    expect(amountPhrase({ amount_low: 300, amount_high: 620, changes: [] }, "en")).toContain("between");
    expect(amountPhrase({ amount_low: 300, amount_high: 620, changes: [] }, "fr")).toContain("entre");
    const anglais = {
      negotiate: [{ label: "Territory", why: "", eur_impact_low: null, eur_impact_high: null, priority: 1 }],
      counter_offer: { amount_low: null, amount_high: null, changes: [] },
      language: "en" as const,
    };
    expect(completeMessage(anglais, "Thanks!")).toContain("Before we move forward");
  });

  it("une offre chiffrée garde son comportement : rien n'est ajouté", () => {
    const chiffree = base();
    const analysis = composeAnalysis(chiffree);
    expect(analysis.evaluability).toBe("complete");
    expect(analysis.ready_to_send_message.text).not.toContain("Avant d'aller plus loin");
  });
});

// ─── B — les puces vides ────────────────────────────────────────────────────

describe("B — les mentions obligatoires absentes", () => {
  // Une analyse telle qu'elle revient de la BASE : le payload est relu par le
  // schéma, exactement comme lib/analysis/load.ts le fait, et non construit à
  // la main dans le test. C'est ce qui manquait à la mission #104.
  const fromDatabase = (clauses: string[]): Analysis => {
    const stored = { ...composeAnalysis(base()), fr_legal: { ...composeAnalysis(base()).fr_legal, missing_mandatory_clauses: clauses } };
    const parsed = analysisSchema.safeParse(JSON.parse(JSON.stringify(stored)));
    if (!parsed.success) throw new Error("payload refusé par le schéma");
    return parsed.data;
  };
  const render = (analysis: Analysis) =>
    renderToStaticMarkup(<LegalNotice legal={analysis.fr_legal} />).replaceAll("&#x27;", "'");
  const bullets = (html: string) => [...html.matchAll(/<li[^>]*>(.*?)<\/li>/g)].map((match) => match[1]);

  it("cinq mentions réelles : cinq puces, toutes avec leur libellé", () => {
    const html = render(fromDatabase([
      "Identification des parties",
      "Description des prestations",
      "Rémunération ou méthode de détermination",
      "Modalités de paiement",
      "Soumission au droit français",
    ]));
    expect(html).toContain("5 mentions obligatoires absentes");
    const items = bullets(html);
    expect(items).toHaveLength(5);
    for (const item of items) expect(item.trim()).not.toBe("");
  });

  it("cinq entrées INVISIBLES venues de la base : ni comptées, ni affichées", () => {
    const html = render(fromDatabase(["   ", "​​", "⁣", "⠀", "ㅤ"]));
    expect(html).toContain("Aucune mention obligatoire ne manque");
    expect(html).not.toContain("5 mentions");
    expect(bullets(html)).toEqual([]);
  });

  it("mélange de vraies mentions et d'entrées invisibles : le compte suit les puces", () => {
    const html = render(fromDatabase(["Identification des parties", "⁣", "  ", "Modalités de paiement", "﻿"]));
    expect(html).toContain("2 mentions obligatoires absentes");
    expect(bullets(html)).toHaveLength(2);
  });

  it("B1 — le compte et la liste sortent du MÊME objet", () => {
    for (const clauses of [[], ["A"], ["A", "⁣", "B"], ["​"], ["A", "B", "C", "D", "E", "F"]]) {
      const view = missingClausesView({ missing_mandatory_clauses: clauses });
      expect(view.count, clauses.join("|")).toBe(view.clauses.length);
      if (view.count > 1) expect(view.hint).toContain(`${view.count} mentions`);
    }
  });

  it("B2 — le filtre couvre tout le formatage invisible, pas une liste choisie à la main", () => {
    for (const invisible of ["­", "​", "‎", "⁠", "⁡", "⁣", "⁦", "⁩", "᠎", "⠀", "ㅤ", "﻿"]) {
      expect(readableClause(invisible), JSON.stringify(invisible)).toBe(false);
    }
    expect(readableClause("Identification des parties")).toBe(true);
    expect(readableClause("—")).toBe(true);
  });
});
