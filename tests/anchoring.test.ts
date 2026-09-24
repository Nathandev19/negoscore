import { describe, expect, it } from "vitest";
import { counterOfferRange, POSITION_LABEL, rangePosition } from "@/lib/analysis/anchoring";
import { composeAnalysis } from "@/lib/analysis/compose";
import { BAND_LABEL } from "@/lib/display";
import sample from "@/lib/fixtures/analysis-legacy-1.0.json";
import { extractionSchema, PRICE_PLACEHOLDER, type Extraction } from "@/lib/llm/prompt";
import { formatEur } from "@/lib/money";
import { computeEstimate } from "@/lib/rates/engine";
import { computeScore, pricePoints, uncappedScore } from "@/lib/rates/score";
import type { Analysis } from "@/lib/schema";
import nova from "./fixtures/deal-26-nova-sportswear.json";

type Deal = Analysis["deal"];

// Fixture 26 — NOVA Sportswear, testée en production : 90/100 « Excellent deal »
// et un message annonçant « entre 460 € et 1 090 € » pour une offre à 600 €.
const NOVA = nova as Deal;

function extraction(deal: Deal): Extraction {
  return extractionSchema.parse({
    ...sample,
    deal,
    negotiate: [],
    counter_offer: { changes: ["Exclusivité limitée aux vêtements de sport"] },
    ready_to_send_message: { tone: "cordial", text: `Mon tarif pour ce projet se situe ${PRICE_PLACEHOLDER}.` },
  });
}

function withAmount(amount: number | null): Deal {
  return { ...NOVA, payment: { ...NOVA.payment, amount_eur: amount } };
}

describe("A — points prix gradués sur la position dans la fourchette", () => {
  it("0 sous 0,4 × bas, 18 au plancher, 30 au plafond, linéaire entre", () => {
    expect(pricePoints(100, 500, 1000)).toBe(0);
    expect(pricePoints(200, 500, 1000)).toBe(0);
    expect(pricePoints(350, 500, 1000)).toBe(9);
    expect(pricePoints(500, 500, 1000)).toBe(18);
    expect(pricePoints(750, 500, 1000)).toBe(24);
    expect(pricePoints(1000, 500, 1000)).toBe(30);
    expect(pricePoints(5000, 500, 1000)).toBe(30);
  });

  it("borne haute nulle ou égale à la basse : règle précédente, 30 dès la borne basse", () => {
    expect(pricePoints(500, 500, null)).toBe(30);
    expect(pricePoints(500, 500, 500)).toBe(30);
    expect(pricePoints(350, 500, 500)).toBe(15);
  });

  it("le maximum global reste 90", () => {
    const best: Deal = {
      ...NOVA,
      exclusivity: { present: false, duration_months: null, category: null },
      payment: { ...NOVA.payment, amount_eur: 100_000 },
    };
    expect(computeScore(best, computeEstimate(best))).toEqual({ value: 90, band: "excellent" });
  });

  // Cas NOVA (#019) mesuré au niveau confirmé, niveau par défaut jusqu'à fr-2026.2.
  // Le calcul du prix dans la fourchette y est gardé tel quel, au niveau explicite.
  // Mission #109, B — 600 € est au TIERS BAS de 460 – 1 090 € (22 %), et la
  // contre-offre demande 845 – 1 090 €. Le badge disait « Bon deal » au-dessus
  // d'une demande de +41 % : les deux ne racontaient pas la même chose. Le
  // plafond du tiers inférieur ramène la note à 69, « Deal correct ».
  it("NOVA au niveau confirmé : 600 € au tiers bas de 460–1 090 € vaut 69, « Deal correct »", () => {
    const estimate = computeEstimate(NOVA, { tier: "confirmed" });
    expect([estimate.total_low, estimate.total_high]).toEqual([460, 1090]);
    const score = computeScore(NOVA, estimate);
    expect(uncappedScore(NOVA, estimate).value).toBe(81);
    expect(score).toEqual({ value: 69, band: "fair" });
    expect(BAND_LABEL[score.band]).toBe("Deal correct");
  });

  it("NOVA au niveau par défaut (starter, fr-2026.3) : 600 € au-dessus de 180–400 € vaut 90, « Excellent deal »", () => {
    const estimate = computeEstimate(NOVA);
    expect([estimate.total_low, estimate.total_high]).toEqual([180, 400]);
    const score = computeScore(NOVA, estimate);
    // 50 + 30 (au-dessus de la borne haute) + 5 (paiement à 30 jours) + 5 (organique) = 90, le plafond de fait.
    expect(score).toEqual({ value: 90, band: "excellent" });
  });
});

describe("B — position par tiers", () => {
  it("dit où se situe le montant, bornes comprises", () => {
    expect(rangePosition(459, 460, 1090)).toBe("below");
    expect(rangePosition(460, 460, 1090)).toBe("bottom");
    expect(rangePosition(600, 460, 1090)).toBe("bottom");
    expect(rangePosition(700, 460, 1090)).toBe("middle");
    expect(rangePosition(900, 460, 1090)).toBe("top");
    expect(rangePosition(1090, 460, 1090)).toBe("above");
    expect(POSITION_LABEL.bottom).toBe("tout en bas de notre fourchette");
  });
});

describe("C — la contre-offre ancre au-dessus de l'offre", () => {
  it("montant absent ou sous la fourchette : toute la fourchette", () => {
    expect(counterOfferRange(null, 460, 1090)).toEqual({ low: 460, high: 1090 });
    expect(counterOfferRange(300, 460, 1090)).toEqual({ low: 460, high: 1090 });
  });

  it("dans la fourchette : du milieu entre l'offre et le haut, jusqu'au haut", () => {
    expect(counterOfferRange(600, 460, 1090)).toEqual({ low: 845, high: 1090 });
    expect(counterOfferRange(460, 460, 1090)).toEqual({ low: 775, high: 1090 });
    expect(counterOfferRange(1089, 460, 1090)).toEqual({ low: 1090, high: 1090 });
  });

  it("au-dessus de la fourchette, ou sans estimation : aucune contre-offre chiffrée", () => {
    expect(counterOfferRange(1090, 460, 1090)).toEqual({ low: null, high: null });
    expect(counterOfferRange(2000, 460, 1090)).toEqual({ low: null, high: null });
    expect(counterOfferRange(600, null, null)).toEqual({ low: null, high: null });
  });

  it("invariant : la borne basse n'est jamais inférieure ou égale au montant proposé", () => {
    const ranges: Array<[number, number]> = [
      [460, 1090],
      [250, 500],
      [3500, 7000],
      [100, 101],
      [1000, 1000],
    ];
    for (const [low, high] of ranges) {
      for (let amount = 0; amount <= high * 1.2; amount += 7.5) {
        const counter = counterOfferRange(amount, low, high);
        if (counter.low !== null) {
          expect(counter.low).toBeGreaterThan(amount);
          expect(counter.high).toBeGreaterThanOrEqual(counter.low);
        }
      }
    }
  });
});

describe("D — le message cite la contre-offre, jamais l'estimation", () => {
  // Au niveau confirmé : 600 € est DANS la fourchette, seul cas où la contre-offre
  // part du milieu entre le montant et la borne haute.
  it("NOVA au niveau confirmé : contre-offre au-dessus de 600 €, message aligné sur elle", () => {
    const analysis = composeAnalysis(extraction(NOVA), { tier: "confirmed" });
    expect(analysis.evaluability).toBe("complete");
    expect(analysis.score).toEqual({ value: 69, band: "fair" });
    expect(analysis.estimate.total_low).toBe(460);
    expect(analysis.counter_offer).toMatchObject({ amount_low: 845, amount_high: 1090 });
    expect(analysis.ready_to_send_message.text).toContain(`entre ${formatEur(845)} et ${formatEur(1090)}`);
    expect(analysis.ready_to_send_message.text).not.toContain(formatEur(460));
  });

  it("NOVA au niveau par défaut : 600 € au-dessus de 180–400 €, aucune contre-offre chiffrée", () => {
    const analysis = composeAnalysis(extraction(NOVA));
    expect(analysis.score).toEqual({ value: 90, band: "excellent" });
    expect(analysis.counter_offer).toMatchObject({ amount_low: null, amount_high: null });
    expect(analysis.ready_to_send_message.text).toContain("un tarif que je vous détaille dans mon devis");
  });

  it("offre au-dessus de la fourchette : aucun montant, repli du message", () => {
    const analysis = composeAnalysis(extraction(withAmount(1500)));
    expect(analysis.counter_offer.amount_low).toBeNull();
    expect(analysis.counter_offer.amount_high).toBeNull();
    expect(analysis.ready_to_send_message.text).toContain("un tarif que je vous détaille dans mon devis");
    expect(analysis.ready_to_send_message.text).not.toMatch(/€/);
  });

  it("sans montant proposé : la fourchette entière", () => {
    const analysis = composeAnalysis(extraction(withAmount(null)));
    // Fourchette NOVA au niveau par défaut (starter) : 180–400 €.
    expect(analysis.counter_offer).toMatchObject({ amount_low: 180, amount_high: 400 });
  });
});
