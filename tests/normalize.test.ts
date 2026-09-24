import { describe, expect, it } from "vitest";
import { composeAnalysis } from "@/lib/analysis/compose";
import { evaluability } from "@/lib/analysis/evaluability";
import { normalizeDeal } from "@/lib/analysis/normalize";
import sample from "@/lib/fixtures/analysis-legacy-1.0.json";
import { extractionSchema, type Extraction } from "@/lib/llm/prompt";
import { computeEstimate } from "@/lib/rates/engine";
import { computeScore } from "@/lib/rates/score";
import { analysisSchema, type Analysis } from "@/lib/schema";

type Deal = Analysis["deal"];

const NO_USAGE: Deal["usage"] = {
  organic: false,
  paid_ads: false,
  whitelisting: false,
  spark_ads: false,
  duration_months: null,
  territory: null,
  perpetual: false,
};

// Deal extrait en production pour « Tu postes 1 vidéo sur ton TikTok, on te paie 250 € ».
const POSTS_ON_OWN_ACCOUNT: Deal = {
  // Mission #116 — relu par le schéma : les champs ajoutés depuis prennent
  // leur valeur par défaut, comme pour une analyse enregistrée.
  ...analysisSchema.shape.deal.parse(sample.deal),
  brand: null,
  deliverables: [{ type: "video", platform: "tiktok", quantity: 1, format: null }],
  publication_required: true,
  usage: NO_USAGE,
  exclusivity: { present: false, duration_months: null, category: null },
  raw_footage: false,
  ip_transfer: "none",
  revisions: { count: null, unlimited: false },
  payment: { amount_eur: 250, currency: "EUR", terms_days: null, schedule: null },
};

function extraction(deal: Deal): Extraction {
  return extractionSchema.parse({
    ...sample,
    deal,
    negotiate: [],
    counter_offer: { changes: [] },
    ready_to_send_message: { tone: "cordial", text: "Merci !" },
  });
}

describe("normalizeDeal", () => {
  it("publier sur son compte implique un usage organique", () => {
    const deal = normalizeDeal(POSTS_ON_OWN_ACCOUNT);
    expect(deal.usage.organic).toBe(true);
    expect(POSTS_ON_OWN_ACCOUNT.usage.organic).toBe(false);
  });

  it("ne déduit aucun autre drapeau, ni durée, ni territoire", () => {
    const deal = normalizeDeal(POSTS_ON_OWN_ACCOUNT);
    expect(deal.usage).toEqual({ ...NO_USAGE, organic: true });
    expect({ ...deal, usage: NO_USAGE }).toEqual(POSTS_ON_OWN_ACCOUNT);
  });

  it("sans publication sur le compte, rien ne change", () => {
    const deal = { ...POSTS_ON_OWN_ACCOUNT, publication_required: false };
    // Depuis la mission #058, la normalisation reconstruit toujours le deal
    // (quantités et durées à 0 ramenées à null) : c'est l'égalité des valeurs
    // qui compte, plus celle des références.
    expect(normalizeDeal(deal)).toStrictEqual(deal);
  });

  it("ne passe jamais un drapeau de vrai à faux", () => {
    const rich: Deal = {
      ...POSTS_ON_OWN_ACCOUNT,
      publication_required: false,
      usage: { organic: true, paid_ads: true, whitelisting: true, spark_ads: true, duration_months: 6, territory: "France", perpetual: true },
    };
    expect(normalizeDeal(rich)).toEqual(rich);
    const published = { ...rich, publication_required: true };
    expect(normalizeDeal(published)).toEqual(published);
  });
});

describe("composeAnalysis sur un deal normalisé", () => {
  it("la fixture 22 quitte « incomplete » et tout lit la même donnée", () => {
    expect(evaluability(POSTS_ON_OWN_ACCOUNT)).toBe("incomplete");
    const analysis = composeAnalysis(extraction(POSTS_ON_OWN_ACCOUNT));
    const normalized = normalizeDeal(POSTS_ON_OWN_ACCOUNT);
    // Périmètre et prix connus ; ses conditions ne le sont pas (mission #017).
    expect(analysis.evaluability).toBe("terms_unknown");
    expect(analysis.deal.usage.organic).toBe(true);
    expect(analysis.estimate.total_low).toBe(computeEstimate(normalized).total_low);
    const withTerms: Deal = { ...POSTS_ON_OWN_ACCOUNT, usage: { ...NO_USAGE, duration_months: 3 }, revisions: { count: 2, unlimited: false } };
    const complete = composeAnalysis(extraction(withTerms));
    const normalizedWithTerms = normalizeDeal(withTerms);
    expect(complete.evaluability).toBe("complete");
    expect(complete.score).toEqual(computeScore(normalizedWithTerms, computeEstimate(normalizedWithTerms)));
  });
});
