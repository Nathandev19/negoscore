import { describe, expect, it } from "vitest";
import { FAR_BELOW_RATIO, verdictForm, verdictSentence } from "@/lib/analysis/verdict";
import { previewAnalysis } from "@/lib/fixtures/preview-states";
import { recomputeForTier } from "@/lib/analysis/recompute";
import sample from "@/lib/fixtures/analysis-legacy-1.0.json";
import { RATIO_ZERO } from "@/lib/rates/score";
import { analysisSchema, type Analysis } from "@/lib/schema";

// Phrase de verdict écrite par le moteur, figée ici mot pour mot. Les espaces
// insécables du formateur (« 1 100 ») sont ramenées à des espaces ordinaires
// pour la comparaison (\s les couvre en JavaScript).
const plain = (text: string) => text.replace(/\s/g, " ");

type Band = NonNullable<Analysis["score"]>["band"];

function analysis(overrides: {
  evaluability?: Analysis["evaluability"];
  amount?: number | null;
  inKind?: number | null;
  low?: number | null;
  high?: number | null;
  band?: Band | null;
}): Analysis {
  const base = analysisSchema.parse(sample);
  const evaluability = overrides.evaluability ?? "complete";
  const band = overrides.band === undefined ? "good" : overrides.band;
  return {
    ...base,
    evaluability,
    score: evaluability === "complete" && band !== null ? { value: 75, band } : null,
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

describe("formes de la phrase de verdict", () => {
  it("complete, sous la fourchette", () => {
    expect(plain(verdictSentence(analysis({ amount: 300, band: "bad" })))).toBe("300 € proposés. Ces droits en valent 510 à 1 100.");
  });

  // Mission #109, A — 800 € dans 510 – 1 100 € est au tiers MÉDIAN : la phrase
  // ne dit plus seulement « dedans », elle dit où.
  it("complete, au milieu de la fourchette, bon deal", () => {
    expect(plain(verdictSentence(analysis({ amount: 800, band: "good" })))).toBe("800 € proposés. C'est dans les prix.");
  });

  it("complete, au-dessus, bon deal", () => {
    expect(plain(verdictSentence(analysis({ amount: 1400, band: "excellent" })))).toBe(
      "1 400 € proposés. C'est au-dessus de ce que ces droits valent.",
    );
  });

  it("B1 — dans la fourchette mais deal sous « good » : la phrase nomme les conditions", () => {
    for (const band of ["bad", "weak", "fair"] as const) {
      expect(plain(verdictSentence(analysis({ amount: 800, band })))).toBe(
        "800 € proposés. C'est dans les prix. Mais les conditions demandées posent problème.",
      );
    }
  });

  it("B1 — au-dessus mais deal sous « good » : la phrase nomme les conditions", () => {
    expect(plain(verdictSentence(analysis({ amount: 2800, low: 1070, high: 2500, band: "fair" })))).toBe(
      "2 800 € proposés. C'est au-dessus de ce que ces droits valent. Mais les conditions demandées posent problème.",
    );
  });

  it("B1 ne s'applique pas sous la fourchette : le prix est déjà la raison", () => {
    expect(verdictForm(analysis({ amount: 300, band: "bad" }))).toBe("complete_below");
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

  it("terms_unknown, montant pas très en dessous", () => {
    expect(verdictSentence(analysis({ evaluability: "terms_unknown", amount: 400, low: 820, high: 1950 }))).toBe(
      "Le prix est là, les conditions non. C'est là-dessus qu'il faut poser des questions.",
    );
  });

  it("B2 — terms_unknown, montant très en dessous : la phrase le dit", () => {
    expect(plain(verdictSentence(analysis({ evaluability: "terms_unknown", amount: 300, low: 820, high: 1950 })))).toBe(
      "300 € proposés, très en dessous de la valeur de ces droits. Et les conditions ne sont pas écrites.",
    );
  });
});

describe("seuil « très en dessous »", () => {
  it("est le seuil du score où le prix ne rapporte plus aucun point : 40 % de la borne basse", () => {
    expect(FAR_BELOW_RATIO).toBe(0.4);
    expect(FAR_BELOW_RATIO).toBe(RATIO_ZERO);
  });

  it("strictement sous 40 % de la borne basse, pas à 40 % pile", () => {
    const at = (amount: number) => verdictForm(analysis({ evaluability: "terms_unknown", amount, low: 1000, high: 2000 }));
    expect(at(399)).toBe("terms_unknown_far_below");
    expect(at(400)).toBe("terms_unknown");
    expect(at(999)).toBe("terms_unknown");
  });

  it("une offre en produits sans montant en euros ne déclenche pas « très en dessous »", () => {
    expect(verdictForm(analysis({ evaluability: "terms_unknown", amount: null, inKind: 50, low: 1000, high: 2000 }))).toBe("terms_unknown");
  });
});

describe("bornes et cas limites", () => {
  it("un montant égal à une borne est dans les prix", () => {
    // Mission #109, A — toujours « dans les prix », mais la borne basse est le
    // bas de la fourchette et la borne haute en est le haut.
    //
    // Mission #113, B — sauf quand le score ENREGISTRÉ contredit la position :
    // ce gabarit porte un score de 75 (« Bon deal »), qui ne respecte pas le
    // plafond de 69 du tiers bas. La phrase se tait alors sur la position
    // plutôt que de contredire le badge affiché à côté d'elle.
    expect(verdictForm(analysis({ amount: 510 }))).toBe("complete_within_middle");
    // Score ramené sous le plafond : la position est de nouveau dite.
    const coherente = analysis({ amount: 510 });
    expect(verdictForm({ ...coherente, score: { value: 69, band: "fair" } })).toBe("complete_within_bottom");
    // Au tiers haut, aucun plafond ne s'applique : rien à concilier.
    expect(verdictForm(analysis({ amount: 1100 }))).toBe("complete_within_top");
    expect(verdictForm(analysis({ amount: 509 }))).toBe("complete_below");
    expect(verdictForm(analysis({ amount: 1101 }))).toBe("complete_above");
  });

  it("offre payée en produits : dit que ce sont des produits", () => {
    expect(plain(verdictSentence(analysis({ amount: null, inKind: 89 })))).toBe("89 € en produits proposés. Ces droits en valent 510 à 1 100.");
  });

  it("montants réels uniquement : la phrase ne cite que le montant et la fourchette de l'analyse", () => {
    expect(plain(verdictSentence(analysis({ amount: 437, low: 612, high: 1789 })))).toBe("437 € proposés. Ces droits en valent 612 à 1 789.");
  });
});

describe("sur les fixtures passées par le vrai moteur", () => {
  it("chaque état de prévisualisation produit la forme attendue", () => {
    expect(verdictForm(previewAnalysis("debloque").analysis)).toBe("complete_below");
    expect(verdictForm(previewAnalysis("complete").analysis)).toBe("complete_within_poor_terms");
    expect(verdictForm(previewAnalysis("au-dessus").analysis)).toBe("complete_above_poor_terms");
    expect(verdictForm(previewAnalysis("unpriced").analysis)).toBe("unpriced");
    expect(verdictForm(previewAnalysis("incomplete").analysis)).toBe("incomplete");
    // 300 € face à 330–710 € au niveau starter (fr-2026.3) : sous la fourchette, pas sous
    // 40 % de la borne basse. Au niveau confirmé (820–1 950 €), « très en dessous ».
    expect(verdictForm(previewAnalysis("terms_unknown").analysis)).toBe("terms_unknown");
    expect(verdictForm(recomputeForTier(previewAnalysis("terms_unknown").analysis, "confirmed"))).toBe("terms_unknown_far_below");
  });
});
