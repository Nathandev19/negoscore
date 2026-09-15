import { describe, expect, it } from "vitest";
import { computeEscalation } from "@/lib/legal/escalate";
import { computeFrLegal } from "@/lib/legal/fr";
import { computeEstimate } from "@/lib/rates/engine";
import rates from "@/lib/rates/fr-2026.1.json";
import { computeScore } from "@/lib/rates/score";
import type { Analysis } from "@/lib/schema";

type Deal = Analysis["deal"];

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
  it("multiplie la base du palier par défaut par le nombre de livrables", () => {
    const deal = makeDeal({
      deliverables: [{ type: "video", platform: "tiktok", quantity: 3, format: null }],
    });
    const estimate = computeEstimate(deal);
    expect(estimate.base_low).toBe(base.low * 3);
    expect(estimate.base_high).toBe(base.high * 3);
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

  it("renvoie un total null si aucun montant n'est proposé", () => {
    const deal = makeDeal({ payment: { amount_eur: null, currency: "EUR", terms_days: null, schedule: null } });
    const estimate = computeEstimate(deal);
    expect(estimate.total_low).toBeNull();
    expect(estimate.total_high).toBeNull();
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

  it("ratio linéaire entre 0,4 et 1", () => {
    // Base 250 € → total_low 250. 175 € = ratio 0,7 → +15.
    const deal = makeDeal({ payment: { amount_eur: 175, currency: "EUR", terms_days: null, schedule: null } });
    const estimate = computeEstimate(deal);
    expect(estimate.total_low).toBe(250);
    expect(computeScore(deal, estimate).value).toBe(50 + 15 + 5);
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
