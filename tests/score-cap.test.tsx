import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AnalysisResult } from "@/components/result/analysis-result";
import { composeAnalysis } from "@/lib/analysis/compose";
import { verdictForm, verdictSentence } from "@/lib/analysis/verdict";
import { QUANTITY_CAP_NOTE } from "@/lib/display";
import { baseExtraction } from "@/lib/fixtures/preview-states";
import { computeEstimate } from "@/lib/rates/engine";
import { bandFor, computeScore, UNKNOWN_QUANTITY_SCORE_CAP, uncappedScore } from "@/lib/rates/score";

// Mission #035 C : quand la quantité d'un livrable est inconnue, la fourchette
// n'est qu'un plancher ; le score ne peut pas dépasser « Deal correct », et la
// raison est affichée.

// Offre qui obtient « Bon deal » avec une quantité connue : bien payée, délai
// court, droits limités, sans exclusivité ni révisions illimitées.
function goodExtraction(quantity: number | null) {
  const base = baseExtraction();
  return {
    ...base,
    deal: {
      ...base.deal,
      deliverables: [{ type: "video" as const, platform: "tiktok" as const, quantity, format: null }],
      usage: { ...base.deal.usage, paid_ads: false, duration_months: 6, territory: "France" },
      exclusivity: { present: false, duration_months: null, category: null },
      raw_footage: false,
      revisions: { count: 2, unlimited: false },
      payment: { ...base.deal.payment, amount_eur: 900, terms_days: 30 },
    },
  };
}

const render = (analysis: ReturnType<typeof composeAnalysis>) =>
  renderToStaticMarkup(createElement(AnalysisResult, { analysis, unlockHref: "/connexion" })).replace(/&#x27;/g, "'");

describe("plafond du score quand la quantité est inconnue", () => {
  const known = composeAnalysis(goodExtraction(1));
  const unknown = composeAnalysis(goodExtraction(null));

  it("même offre : « Bon deal » avec une quantité connue, pas au-delà de « Deal correct » sans", () => {
    expect(known.evaluability).toBe("complete");
    expect(["good", "excellent"]).toContain(known.score?.band);
    expect(unknown.score?.value).toBeLessThanOrEqual(UNKNOWN_QUANTITY_SCORE_CAP);
    expect(unknown.score?.band).toBe("fair");
    expect(UNKNOWN_QUANTITY_SCORE_CAP).toBe(69);
    expect(bandFor(UNKNOWN_QUANTITY_SCORE_CAP)).toBe("fair");
    expect(bandFor(UNKNOWN_QUANTITY_SCORE_CAP + 1)).toBe("good");
  });

  it("le plafond ne remonte jamais un score plus bas : c'est un minimum", () => {
    const deal = { ...unknown.deal, revisions: { count: null, unlimited: true }, payment: { ...unknown.deal.payment, amount_eur: 100, terms_days: 90 } };
    const estimate = computeEstimate(deal);
    expect(computeScore(deal, estimate).value).toBe(uncappedScore(deal, estimate).value);
    expect(computeScore(deal, estimate).value).toBeLessThan(UNKNOWN_QUANTITY_SCORE_CAP);
  });

  it("la raison est affichée près du score, et seulement quand une quantité manque", () => {
    const html = render(unknown);
    expect(html).toContain(QUANTITY_CAP_NOTE);
    expect(html.indexOf(QUANTITY_CAP_NOTE)).toBeLessThan(html.indexOf("Ce que ça vaut"));
    expect(render(known)).not.toContain(QUANTITY_CAP_NOTE);
    expect(QUANTITY_CAP_NOTE).toBe(
      // Mission #178 — « la note » nommait un nombre que la créatrice ne
      // voit plus depuis la #174. Dernière des quatre à passer au verdict.
      "La marque ne dit pas combien de contenus elle veut : le chiffrage en compte un seul, le verdict ne peut donc pas dépasser « Deal correct ».",
    );
  });

  it("la phrase de verdict n'accuse pas les conditions quand seul le plafond fait baisser la note", () => {
    expect(verdictForm(unknown)).not.toMatch(/poor_terms/);
    expect(verdictSentence(unknown)).not.toContain("conditions demandées posent problème");
  });

  it("la phrase de verdict ne juge pas l'offre entière sur un plancher : elle dit ce que vaut un contenu", () => {
    const text = verdictSentence(unknown).replace(/\s/g, " ");
    const { total_low: low, total_high: high } = unknown.estimate;
    expect(text).toBe(`900 € proposés. Un seul contenu en vaut ${low} à ${high}, et la marque n'a pas écrit combien elle en veut.`);
    expect(text).not.toMatch(/au-dessus|dans les prix/);
    expect(verdictSentence(known)).not.toContain("Un seul contenu");
  });
});
