import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AnalysisResult } from "@/components/result/analysis-result";
import { composeAnalysis } from "@/lib/analysis/compose";
import { priceCapNote } from "@/lib/display";
import { baseExtraction } from "@/lib/fixtures/preview-states";
import { computeEstimate } from "@/lib/rates/engine";
import {
  appliedPriceCap,
  bandFor,
  computeScore,
  PRICE_CAP_FREE_RATIO,
  priceRatio,
  priceScoreCap,
  uncappedScore,
} from "@/lib/rates/score";
import { TIERS } from "@/lib/rates/tier";

// Mission #050 — le score est plafonné par la part du plancher réellement
// payée. Le plafond ne retire aucun point : il borne le score par le haut.

// Offre volontairement bien notée par ailleurs (délai court, droits limités,
// pas d'exclusivité, révisions comptées) : seul le montant change.
function offerAt(amount: number | null) {
  const base = baseExtraction();
  return {
    ...base,
    deal: {
      ...base.deal,
      deliverables: [{ type: "video" as const, platform: "tiktok" as const, quantity: 1, format: null }],
      usage: { ...base.deal.usage, paid_ads: false, whitelisting: false, spark_ads: false, perpetual: false, organic: true, duration_months: null, territory: "France" },
      exclusivity: { present: false, duration_months: null, category: null },
      raw_footage: false,
      revisions: { count: 2, unlimited: false },
      payment: { ...base.deal.payment, amount_eur: amount, terms_days: 30 },
    },
  };
}

// Montant correspondant à une part visée du plancher, au niveau starter.
function dealAtRatio(ratio: number) {
  const floor = computeEstimate(composeAnalysis(offerAt(1000)).deal).total_low as number;
  const amount = Math.round(floor * ratio);
  const analysis = composeAnalysis(offerAt(amount));
  const estimate = computeEstimate(analysis.deal);
  return { analysis, deal: analysis.deal, estimate, floor, amount, ratio: (estimate.total_low as number) && amount / (estimate.total_low as number) };
}

const render = (analysis: ReturnType<typeof composeAnalysis>) =>
  renderToStaticMarkup(createElement(AnalysisResult, { analysis, unlockHref: "/connexion" })).replace(/&#x27;/g, "'");

describe("plafond du score par le prix", () => {
  it("r < 0,40 : 29 au plus, « Mauvais deal »", () => {
    const { deal, estimate, ratio } = dealAtRatio(0.3);
    expect(ratio).toBeLessThan(0.4);
    expect(uncappedScore(deal, estimate).value).toBeGreaterThan(29);
    expect(computeScore(deal, estimate).value).toBe(29);
    expect(bandFor(29)).toBe("bad");
  });

  it("0,40 ≤ r < 0,60 : 39 au plus, « Deal faible »", () => {
    const { deal, estimate, ratio } = dealAtRatio(0.5);
    expect(ratio).toBeGreaterThanOrEqual(0.4);
    expect(ratio).toBeLessThan(0.6);
    expect(uncappedScore(deal, estimate).value).toBeGreaterThan(39);
    expect(computeScore(deal, estimate).value).toBe(39);
    expect(bandFor(39)).toBe("weak");
  });

  it("0,60 ≤ r < 0,85 : 59 au plus, « Deal correct »", () => {
    const { deal, estimate, ratio } = dealAtRatio(0.7);
    expect(ratio).toBeGreaterThanOrEqual(0.6);
    expect(ratio).toBeLessThan(0.85);
    expect(uncappedScore(deal, estimate).value).toBeGreaterThan(59);
    expect(computeScore(deal, estimate).value).toBe(59);
    expect(bandFor(59)).toBe("fair");
  });

  it("r ≥ 0,85 : aucun plafond prix", () => {
    const { deal, estimate, ratio } = dealAtRatio(0.9);
    expect(ratio).toBeGreaterThanOrEqual(PRICE_CAP_FREE_RATIO);
    expect(priceScoreCap(ratio)).toBeNull();
    expect(computeScore(deal, estimate).value).toBe(uncappedScore(deal, estimate).value);
  });

  it("les bornes de la table sont celles décidées", () => {
    expect([priceScoreCap(0), priceScoreCap(0.399), priceScoreCap(0.4), priceScoreCap(0.599)]).toEqual([29, 29, 39, 39]);
    expect([priceScoreCap(0.6), priceScoreCap(0.849), priceScoreCap(0.85), priceScoreCap(2)]).toEqual([59, 59, null, null]);
  });

  it("A4 — sans fourchette exploitable ou sans montant, aucun plafond prix", () => {
    const noAmount = composeAnalysis(offerAt(null));
    const estimate = computeEstimate(noAmount.deal);
    expect(priceRatio(noAmount.deal, estimate)).toBeNull();
    expect(priceScoreCap(null)).toBeNull();
    expect(computeScore(noAmount.deal, estimate).value).toBe(uncappedScore(noAmount.deal, estimate).value);
    for (const total_low of [null, 0]) {
      const broken = { ...estimate, total_low } as typeof estimate;
      expect(priceRatio(composeAnalysis(offerAt(300)).deal, broken)).toBeNull();
      expect(computeScore(composeAnalysis(offerAt(300)).deal, broken).value).toBe(
        uncappedScore(composeAnalysis(offerAt(300)).deal, broken).value,
      );
    }
  });

  it("A2 — le plafond ne remonte jamais un score : il ne peut que le baisser", () => {
    for (const tier of TIERS) {
      for (const amount of [0, 40, 120, 300, 600, 900, 1500, 4000]) {
        const analysis = composeAnalysis(offerAt(amount), { tier });
        const estimate = computeEstimate(analysis.deal, { tier });
        expect(computeScore(analysis.deal, estimate).value).toBeLessThanOrEqual(uncappedScore(analysis.deal, estimate).value);
      }
    }
  });

  it("A5 — le score reste croissant avec le montant proposé, à offre identique", () => {
    for (const tier of TIERS) {
      let previous = -1;
      for (const amount of [0, 50, 100, 150, 200, 300, 450, 600, 800, 1000, 1400, 2000, 3000, 6000]) {
        const analysis = composeAnalysis(offerAt(amount), { tier });
        const value = computeScore(analysis.deal, computeEstimate(analysis.deal, { tier })).value;
        expect(value, `${tier} ${amount} €`).toBeGreaterThanOrEqual(previous);
        previous = value;
      }
    }
  });

  it("A3 — avec une quantité inconnue, le plus bas des deux plafonds l'emporte", () => {
    // Moitié du plancher : plafond prix à 39, plus bas que le plafond 69 de la
    // quantité inconnue.
    const floor = computeEstimate(composeAnalysis(offerAt(1000)).deal).total_low as number;
    const base = offerAt(Math.round(floor * 0.5));
    const vague = {
      ...base,
      deal: { ...base.deal, deliverables: [{ type: "video" as const, platform: "tiktok" as const, quantity: null, format: null }] },
    };
    const analysis = composeAnalysis(vague);
    const estimate = computeEstimate(analysis.deal);
    const ratio = priceRatio(analysis.deal, estimate) as number;
    const cap = priceScoreCap(ratio) as number;
    expect(cap).toBeLessThan(69);
    expect(computeScore(analysis.deal, estimate).value).toBe(cap);
  });
});

describe("explication du plafond sur la page de résultat", () => {
  it("B1 — la phrase donne la part réellement payée, arrondie à l'entier", () => {
    const { analysis, deal, estimate } = dealAtRatio(0.56);
    const applied = appliedPriceCap(deal, estimate);
    expect(applied?.percent).toBe(Math.round((priceRatio(deal, estimate) as number) * 100));
    const html = render(analysis);
    expect(html).toContain(priceCapNote(applied?.percent as number));
    expect(html).toContain("du bas de la fourchette. Le score ne peut pas monter plus haut.");
  });

  it("B2 — rien n'est affiché quand aucun plafond ne s'applique", () => {
    const { analysis, deal, estimate } = dealAtRatio(0.9);
    expect(appliedPriceCap(deal, estimate)).toBeNull();
    expect(render(analysis)).not.toContain("du bas de la fourchette");
  });

  it("B2 — rien n'est affiché quand le plafond ne mord pas", () => {
    // Offre mal notée par ailleurs : le score est déjà sous le plafond.
    const worse = (amount: number) => {
      const base = offerAt(amount);
      return {
        ...base,
        deal: {
          ...base.deal,
          usage: { ...base.deal.usage, paid_ads: true, organic: false, perpetual: true },
          revisions: { count: null, unlimited: true },
          payment: { ...base.deal.payment, terms_days: 90 },
        },
      };
    };
    const floor = computeEstimate(composeAnalysis(worse(1000)).deal).total_low as number;
    const analysis = composeAnalysis(worse(Math.round(floor * 0.5)));
    const estimate = computeEstimate(analysis.deal);
    const cap = priceScoreCap(priceRatio(analysis.deal, estimate));
    expect(cap).not.toBeNull();
    expect(uncappedScore(analysis.deal, estimate).value).toBeLessThanOrEqual(cap as number);
    expect(appliedPriceCap(analysis.deal, estimate)).toBeNull();
    expect(render(analysis)).not.toContain("du bas de la fourchette");
  });

  // Analyses enregistrées avant la mission #050 : leur score stocké ignore le
  // plafond. Afficher la phrase à côté d'un score plus haut que le plafond
  // dirait le contraire de ce que montre le chiffre.
  it("rien n'est affiché sur une analyse enregistrée avant le plafond", () => {
    const { analysis } = dealAtRatio(0.56);
    const ancienne = { ...analysis, score: { value: 50, band: bandFor(50) } };
    expect(ancienne.score.value).toBeGreaterThan(appliedPriceCap(ancienne.deal, ancienne.estimate)?.cap as number);
    expect(render(ancienne)).not.toContain("du bas de la fourchette");
  });

  it("B3 — la phrase n'apparaît ni sur la carte partageable ni sur l'aperçu", async () => {
    const { shareCardTexts } = await import("@/lib/share-card/element");
    const { analysis } = dealAtRatio(0.56);
    const texts = JSON.stringify(shareCardTexts(analysis));
    expect(texts).not.toContain("du bas de la fourchette");
    expect(texts).not.toMatch(/%/);
  });
});
