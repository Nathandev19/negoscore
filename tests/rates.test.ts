import { describe, expect, it } from "vitest";
import { computeEscalation } from "@/lib/legal/escalate";
import { computeFrLegal } from "@/lib/legal/fr";
import {
  computeEstimate,
  isFarAboveOffer,
  UPLIFT_CAPPED_ASSUMPTION,
  upliftCap,
  volumeDiscountFactor,
} from "@/lib/rates/engine";
import rates from "@/lib/rates/fr-2026.1.json";
import { computeScore } from "@/lib/rates/score";
import type { Analysis } from "@/lib/schema";
import extracted17 from "./fixtures/deal-17-contrat-boisson.json";

type Deal = Analysis["deal"];

// Deal extrait par le modèle sur la fixture 17 (#002), figé ici pour que le
// test ne dépende pas d'une régénération des sorties du pipeline.
const FIXTURE_17_DEAL = extracted17 as Deal;

// Deal neutre : 1 vidéo TikTok, 300 €, usage organique, rien d'autre.
function makeDeal(overrides: Partial<Deal> = {}): Deal {
  return {
    brand: "Marque Test",
    deliverables: [{ type: "video", platform: "tiktok", quantity: 1, format: null }],
    publication_required: false,
    usage: {
      organic: true,
      paid_ads: false,
      whitelisting: false,
      spark_ads: false,
      duration_months: null,
      territory: null,
      perpetual: false,
    },
    exclusivity: { present: false, duration_months: null, category: null },
    raw_footage: false,
    ip_transfer: "none",
    ai_training_rights: "absent",
    revisions: { count: 2, unlimited: false },
    payment: { amount_eur: 300, currency: "EUR", terms_days: null, schedule: null },
    in_kind_value_eur: null,
    deadlines: [],
    kill_fee: null,
    termination: null,
    governing_law: null,
    ...overrides,
  };
}

const base = rates.base_rates_eur.confirmed;
const m = rates.multipliers;

function lineFor(deal: Deal, topic: string) {
  return computeEstimate(deal).lines.find((l) => l.topic === topic);
}

describe("computeEstimate", () => {
  it("multiplie la base du palier par défaut par le nombre de livrables, avec la dégressivité", () => {
    const deal = makeDeal({
      deliverables: [{ type: "video", platform: "tiktok", quantity: 3, format: null }],
    });
    const estimate = computeEstimate(deal);
    expect(estimate.base_low).toBe(Math.round(base.low * 3 * volumeDiscountFactor(3)));
    expect(estimate.base_high).toBe(Math.round(base.high * 3 * volumeDiscountFactor(3)));
    expect(estimate.lines).toEqual([]);
    expect(estimate.rate_table_version).toBe(rates.version);
    expect(estimate.assumptions.some((a) => a.includes("confirmé"))).toBe(true);
  });

  it("utilise le palier demandé", () => {
    const estimate = computeEstimate(makeDeal(), { tier: "starter" });
    expect(estimate.base_low).toBe(rates.base_rates_eur.starter.low);
    expect(estimate.base_high).toBe(rates.base_rates_eur.starter.high);
  });

  it.each([
    [1, "paid_ads_1m"],
    [3, "paid_ads_3m"],
    [6, "paid_ads_6m"],
    [12, "paid_ads_12m"],
  ] as const)("droits pub %i mois → %s", (months, key) => {
    const deal = makeDeal({ usage: { ...makeDeal().usage, paid_ads: true, duration_months: months } });
    const line = lineFor(deal, "paid_ads");
    expect(line?.eur_low).toBe(Math.round(base.low * m[key].low));
    expect(line?.eur_high).toBe(Math.round(base.high * m[key].high));
  });

  it("droits pub à vie → paid_ads_perpetual", () => {
    const deal = makeDeal({ usage: { ...makeDeal().usage, paid_ads: true, perpetual: true } });
    const line = lineFor(deal, "paid_ads");
    expect(line?.eur_low).toBe(Math.round(base.low * m.paid_ads_perpetual.low));
  });

  it("whitelisting et Spark Ads sont facturés par mois", () => {
    const deal = makeDeal({
      usage: { ...makeDeal().usage, whitelisting: true, spark_ads: true, duration_months: 2 },
    });
    expect(lineFor(deal, "whitelisting")?.eur_high).toBe(Math.round(base.high * m.whitelisting_per_month.high * 2));
    expect(lineFor(deal, "spark_ads")?.eur_low).toBe(Math.round(base.low * m.spark_ads_per_month.low * 2));
  });

  it.each([
    [1, "exclusivity_1m"],
    [3, "exclusivity_3m"],
    [9, "exclusivity_6m_plus"],
  ] as const)("exclusivité %i mois → %s", (months, key) => {
    const deal = makeDeal({ exclusivity: { present: true, duration_months: months, category: "beauté" } });
    expect(lineFor(deal, "exclusivity")?.eur_low).toBe(Math.round(base.low * m[key].low));
  });

  it("raw footage, territoire mondial, plateforme en plus, cession totale, variantes d'accroche", () => {
    const deal = makeDeal({
      deliverables: [
        { type: "video", platform: "tiktok", quantity: 1, format: "3 hooks" },
        { type: "video", platform: "instagram", quantity: 1, format: null },
      ],
      raw_footage: true,
      ip_transfer: "full_assignment",
      usage: { ...makeDeal().usage, territory: "tous les territoires" },
    });
    const estimate = computeEstimate(deal);
    const lowBase = base.low * 2;
    const byTopic = Object.fromEntries(estimate.lines.map((l) => [l.topic, l]));
    expect(byTopic.raw_footage.eur_low).toBe(Math.round(lowBase * m.raw_footage.low));
    expect(byTopic.territory.eur_low).toBe(Math.round(lowBase * m.territory_worldwide.low));
    expect(byTopic.extra_platform.eur_low).toBe(Math.round(lowBase * m.extra_platform.low));
    expect(byTopic.ip_transfer.eur_low).toBe(Math.round(lowBase * m.ip_full_assignment.low));
    expect(byTopic.extra_hooks.eur_high).toBe(rates.flat_eur.extra_hook_or_cta.high * 3);

    const sumLow = lowBase + estimate.lines.reduce((s, l) => s + l.eur_low, 0);
    expect(estimate.total_low).toBe(Math.floor(sumLow / 10) * 10);
    expect((estimate.total_high ?? 0) % 10).toBe(0);
  });

  it("pondère les livrables : une story ou une photo pèse moins qu'une vidéo", () => {
    const w = rates.deliverable_weights;
    const deal = makeDeal({
      deliverables: [
        { type: "video", platform: "instagram", quantity: 2, format: null },
        { type: "story", platform: "instagram", quantity: 3, format: null },
        { type: "photo", platform: "instagram", quantity: 1, format: null },
      ],
    });
    const units = 2 * w.video.weight + 3 * w.story.weight + 1 * w.photo.weight;
    const estimate = computeEstimate(deal);
    expect(estimate.base_low).toBe(Math.round(base.low * units * volumeDiscountFactor(units)));
    expect(estimate.base_high).toBe(Math.round(base.high * units * volumeDiscountFactor(units)));
    expect(w.story.weight).toBeLessThan(w.video.weight);
    expect(w.photo.weight).toBeLessThan(w.video.weight);
  });

  it("fixture 17 (offre 3 500 €, 4 Reels + 4 stories, cession totale) : fourchette défendable", () => {
    const deal = FIXTURE_17_DEAL;
    const w = rates.deliverable_weights;
    const units = 4 * w.video.weight + 4 * w.story.weight;
    const estimate = computeEstimate(deal);
    // #002 : 7 900–23 400 €. #003 : 4 930–14 630 €. Plafond heavy + dégressivité.
    expect(estimate.base_low).toBe(Math.round(base.low * units * volumeDiscountFactor(units)));
    expect(estimate.total_low).toBe(3500);
    expect(estimate.total_high).toBe(7000);
    expect(estimate.assumptions).toContain(UPLIFT_CAPPED_ASSUMPTION);
    expect(estimate.total_low! / deal.payment.amount_eur!).toBeLessThanOrEqual(3);
  });

  it("dégressivité aux quatre paliers", () => {
    const tiers = rates.volume_discount.tiers;
    expect(volumeDiscountFactor(1)).toBe(tiers[0].factor);
    expect(volumeDiscountFactor(2)).toBe(tiers[0].factor);
    expect(volumeDiscountFactor(2.25)).toBe(tiers[1].factor);
    expect(volumeDiscountFactor(4)).toBe(tiers[1].factor);
    expect(volumeDiscountFactor(5)).toBe(tiers[2].factor);
    expect(volumeDiscountFactor(8)).toBe(tiers[2].factor);
    expect(volumeDiscountFactor(9)).toBe(tiers[3].factor);
    expect(new Set(tiers.map((t) => t.factor)).size).toBe(4);

    const tenVideos = computeEstimate(
      makeDeal({ deliverables: [{ type: "video", platform: "tiktok", quantity: 10, format: null }] }),
    );
    expect(tenVideos.base_low).toBe(Math.round(base.low * 10 * tiers[3].factor));
    expect(tenVideos.assumptions.some((a) => a.includes("volume"))).toBe(true);
  });

  it("plafond standard : la majoration cumulée ne dépasse pas le plafond, lignes réduites en proportion", () => {
    // Pub 12 mois + exclusivité 6 mois et plus + rushes + monde + plateforme en plus, sans perpétuité ni cession totale.
    const deal = makeDeal({
      deliverables: [
        { type: "video", platform: "tiktok", quantity: 1, format: null },
        { type: "video", platform: "instagram", quantity: 1, format: null },
      ],
      usage: { ...makeDeal().usage, paid_ads: true, duration_months: 12, territory: "monde" },
      exclusivity: { present: true, duration_months: 12, category: null },
      raw_footage: true,
    });
    const cap = rates.uplift_caps.standard.max_cumulative_uplift;
    expect(upliftCap(deal)).toBe(cap);
    const estimate = computeEstimate(deal);
    const upliftLow = estimate.lines.reduce((s, l) => s + l.eur_low, 0);
    const upliftHigh = estimate.lines.reduce((s, l) => s + l.eur_high, 0);
    expect(upliftLow).toBeCloseTo(estimate.base_low! * cap, -1);
    expect(upliftHigh).toBeCloseTo(estimate.base_high! * cap, -1);
    expect(estimate.assumptions).toContain(UPLIFT_CAPPED_ASSUMPTION);
    const paid = estimate.lines.find((l) => l.topic === "paid_ads");
    const excl = estimate.lines.find((l) => l.topic === "exclusivity");
    // Proportions conservées entre lignes.
    expect(paid!.low / excl!.low).toBeCloseTo(m.paid_ads_12m.low / m.exclusivity_6m_plus.low, 1);
  });

  it("plafond heavy : perpétuité ou cession totale relèvent le plafond", () => {
    const heavyCap = rates.uplift_caps.heavy.max_cumulative_uplift;
    const perpetual = makeDeal({ usage: { ...makeDeal().usage, paid_ads: true, perpetual: true, territory: "monde" } });
    const assignment = makeDeal({ ip_transfer: "full_assignment" });
    expect(upliftCap(perpetual)).toBe(heavyCap);
    expect(upliftCap(assignment)).toBe(heavyCap);

    const heavy = computeEstimate(
      makeDeal({
        usage: { ...makeDeal().usage, paid_ads: true, perpetual: true, territory: "monde" },
        ip_transfer: "full_assignment",
        raw_footage: true,
      }),
    );
    expect(heavy.lines.reduce((s, l) => s + l.eur_high, 0)).toBeCloseTo(heavy.base_high! * heavyCap, -1);
    expect(heavy.assumptions).toContain(UPLIFT_CAPPED_ASSUMPTION);

    // Sous le plafond : aucune réduction, aucune mention.
    const light = computeEstimate(makeDeal({ usage: { ...makeDeal().usage, paid_ads: true, duration_months: 3 } }));
    expect(light.assumptions).not.toContain(UPLIFT_CAPPED_ASSUMPTION);
  });

  it("contrôle de vraisemblance : écart signalé sans toucher la fourchette", () => {
    const fair = computeEstimate(makeDeal());
    const lowball = computeEstimate(makeDeal({ payment: { amount_eur: 50, currency: "EUR", terms_days: null, schedule: null } }));
    expect(lowball.total_low).toBe(fair.total_low);
    expect(lowball.total_high).toBe(fair.total_high);
    expect(lowball.assumptions.some((a) => a.includes("trois fois"))).toBe(true);
    expect(fair.assumptions.some((a) => a.includes("trois fois"))).toBe(false);
    expect(isFarAboveOffer(100, 300)).toBe(false);
    expect(isFarAboveOffer(100, 310)).toBe(true);
    expect(isFarAboveOffer(null, 310)).toBe(false);
  });

  it("sans montant proposé : même fourchette qu'avec un montant, sans écart signalé", () => {
    const deal = makeDeal({ payment: { amount_eur: null, currency: "EUR", terms_days: null, schedule: null } });
    const estimate = computeEstimate(deal);
    const withAmount = computeEstimate(makeDeal({ payment: { amount_eur: 50, currency: "EUR", terms_days: null, schedule: null } }));
    expect(estimate.total_low).not.toBeNull();
    expect(estimate.total_low).toBe(withAmount.total_low);
    expect(estimate.total_high).toBe(withAmount.total_high);
    expect(estimate.lines).toEqual(withAmount.lines);
    expect(estimate.assumptions.some((a) => a.includes("Aucun montant proposé"))).toBe(false);
    expect(estimate.assumptions.some((a) => a.includes("trois fois"))).toBe(false);
    expect(withAmount.assumptions.some((a) => a.includes("trois fois"))).toBe(true);
  });

  it("renvoie un total null si moins de 3 champs sont renseignés", () => {
    const deal = makeDeal({
      brand: null,
      deliverables: [],
      usage: { ...makeDeal().usage, organic: false },
      revisions: { count: null, unlimited: false },
    });
    const estimate = computeEstimate(deal);
    expect(estimate.total_low).toBeNull();
    expect(estimate.total_high).toBeNull();
  });
});

describe("computeScore", () => {
  it("borne basse : un deal très défavorable tombe à 0", () => {
    const deal = makeDeal({
      usage: { ...makeDeal().usage, organic: false, paid_ads: true, perpetual: true },
      ip_transfer: "full_assignment",
      ai_training_rights: "present",
      exclusivity: { present: true, duration_months: 12, category: null },
      payment: { amount_eur: 50, currency: "EUR", terms_days: 90, schedule: null },
      revisions: { count: null, unlimited: true },
      raw_footage: true,
    });
    const score = computeScore(deal, computeEstimate(deal));
    expect(score).toEqual({ value: 0, band: "bad" });
  });

  it("borne haute : prix au-dessus de l'estimation, paiement rapide, organique", () => {
    const deal = makeDeal({ payment: { amount_eur: 1000, currency: "EUR", terms_days: 15, schedule: null } });
    const score = computeScore(deal, computeEstimate(deal));
    expect(score).toEqual({ value: 90, band: "excellent" });
  });

  it("sous la borne basse : 0 à 18 points, linéaire entre 0,4 × bas et bas", () => {
    // Fourchette 250–500 €. 175 € : à mi-chemin entre 100 et 250 → +9.
    const deal = makeDeal({ payment: { amount_eur: 175, currency: "EUR", terms_days: null, schedule: null } });
    const estimate = computeEstimate(deal);
    expect([estimate.total_low, estimate.total_high]).toEqual([250, 500]);
    expect(computeScore(deal, estimate).value).toBe(50 + 9 + 5);
  });
});

describe("computeFrLegal", () => {
  it("threshold yes au-delà de 1 000 € avec les avantages en nature", () => {
    const legal = computeFrLegal(
      makeDeal({ payment: { amount_eur: 800, currency: "EUR", terms_days: 30, schedule: null }, in_kind_value_eur: 250 }),
    );
    expect(legal.threshold_1000_reached).toBe("yes");
    expect(legal.written_contract_required).toBe(true);
    expect(legal.applicable).toBe(true);
  });

  it("threshold no sous 1 000 €", () => {
    const legal = computeFrLegal(makeDeal());
    expect(legal.threshold_1000_reached).toBe("no");
    expect(legal.written_contract_required).toBe(false);
    expect(legal.missing_mandatory_clauses).toContain("Modalités de paiement");
    expect(legal.missing_mandatory_clauses).toContain("Soumission au droit français");
    expect(legal.note).toContain("pas un conseil juridique");
  });

  it("threshold unknown sans montant, non applicable sous un droit étranger", () => {
    const unknown = computeFrLegal(
      makeDeal({ payment: { amount_eur: null, currency: "EUR", terms_days: null, schedule: null } }),
    );
    expect(unknown.threshold_1000_reached).toBe("unknown");
    const foreign = computeFrLegal(
      makeDeal({
        governing_law: "Droit de l'État de New York",
        payment: { amount_eur: 5000, currency: "EUR", terms_days: null, schedule: null },
      }),
    );
    expect(foreign.applicable).toBe(false);
    expect(foreign.written_contract_required).toBe(false);
    expect(computeFrLegal(makeDeal({ governing_law: "Droit français" })).missing_mandatory_clauses).not.toContain(
      "Soumission au droit français",
    );
  });
});

describe("computeEscalation", () => {
  it("déclenche les six règles", () => {
    const deal = makeDeal({
      payment: { amount_eur: 3000, currency: "EUR", terms_days: null, schedule: null },
      ip_transfer: "full_assignment",
      usage: { ...makeDeal().usage, perpetual: true, territory: "worldwide" },
      exclusivity: { present: true, duration_months: 7, category: null },
      ai_training_rights: "present",
    });
    const escalation = computeEscalation(deal);
    expect(escalation.required).toBe(true);
    expect(escalation.reasons).toHaveLength(6);
  });

  it("ne déclenche rien sur un deal simple", () => {
    expect(computeEscalation(makeDeal())).toEqual({ required: false, reasons: [] });
  });
});
