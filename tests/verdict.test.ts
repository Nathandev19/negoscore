import { describe, expect, it } from "vitest";
import { verdictForm, verdictSentence } from "@/lib/analysis/verdict";
import { previewAnalysis } from "@/lib/fixtures/preview-states";
import sample from "@/lib/fixtures/analysis-sample.json";
import { analysisSchema, type Analysis } from "@/lib/schema";

// Phrase de verdict écrite par le moteur : six formes, figées ici mot pour mot.
// Les espaces insécables du formateur (« 1 100 ») sont ramenées à des espaces
// ordinaires pour la comparaison.
const plain = (text: string) => text.replace(/[  ]/g, " ");

function analysis(overrides: { evaluability?: Analysis["evaluability"]; amount?: number | null; inKind?: number | null; low?: number | null; high?: number | null }): Analysis {
  const base = analysisSchema.parse(sample);
  return {
    ...base,
    evaluability: overrides.evaluability ?? "complete",
    deal: {
      ...base.deal,
      payment: { ...base.deal.payment, amount_eur: overrides.amount === undefined ? 300 : overrides.amount },
      in_kind_value_eur: overrides.inKind ?? null,
    },
    estimate: {
      ...base.estimate,
      total_low: overrides.low === undefined ? 510 : overrides.low,
      total_high: overrides.high === undefined ? 1100 : overrides.high,
    },
  };
}

describe("les six formes de la phrase de verdict", () => {
  it("complete, sous la fourchette", () => {
    expect(plain(verdictSentence(analysis({ amount: 300 })))).toBe("300 € proposés. Ces droits en valent 510 à 1 100.");
  });

  it("complete, dans la fourchette", () => {
    expect(plain(verdictSentence(analysis({ amount: 800 })))).toBe("800 € proposés. C'est dans les prix pour ces droits.");
  });

  it("complete, au-dessus", () => {
    expect(plain(verdictSentence(analysis({ amount: 1400 })))).toBe("1 400 € proposés. C'est au-dessus de ce que ces droits valent.");
  });

  it("unpriced", () => {
    expect(verdictSentence(analysis({ evaluability: "unpriced", amount: null }))).toBe(
      "Aucun montant dans cette offre. C'est la première chose à demander.",
    );
  });

  it("incomplete", () => {
    expect(verdictSentence(analysis({ evaluability: "incomplete", low: null, high: null }))).toBe(
      "Trop peu d'informations pour chiffrer. Voilà ce qui manque.",
    );
  });

  it("terms_unknown", () => {
    expect(verdictSentence(analysis({ evaluability: "terms_unknown" }))).toBe(
      "Le prix est là, les conditions non. C'est là-dessus qu'il faut poser des questions.",
    );
  });
});

describe("bornes et cas limites", () => {
  it("un montant égal à une borne est dans les prix", () => {
    expect(verdictForm(analysis({ amount: 510 }))).toBe("complete_within");
    expect(verdictForm(analysis({ amount: 1100 }))).toBe("complete_within");
    expect(verdictForm(analysis({ amount: 509 }))).toBe("complete_below");
    expect(verdictForm(analysis({ amount: 1101 }))).toBe("complete_above");
  });

  it("offre payée en produits : dit que ce sont des produits", () => {
    expect(plain(verdictSentence(analysis({ amount: null, inKind: 89 })))).toBe("89 € en produits proposés. Ces droits en valent 510 à 1 100.");
  });

  it("montants réels uniquement : la phrase ne cite que le montant et la fourchette de l'analyse", () => {
    const text = plain(verdictSentence(analysis({ amount: 437, low: 612, high: 1789 })));
    expect(text).toBe("437 € proposés. Ces droits en valent 612 à 1 789.");
  });
});

describe("sur les fixtures passées par le vrai moteur", () => {
  it("chaque état de prévisualisation produit la forme attendue", () => {
    expect(verdictForm(previewAnalysis("debloque").analysis)).toBe("complete_below");
    expect(verdictForm(previewAnalysis("complete").analysis)).toBe("complete_within");
    expect(verdictForm(previewAnalysis("au-dessus").analysis)).toBe("complete_above");
    expect(verdictForm(previewAnalysis("unpriced").analysis)).toBe("unpriced");
    expect(verdictForm(previewAnalysis("incomplete").analysis)).toBe("incomplete");
    expect(verdictForm(previewAnalysis("terms_unknown").analysis)).toBe("terms_unknown");
  });
});
