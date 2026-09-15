import { describe, expect, it } from "vitest";
import { composeAnalysis } from "@/lib/analysis/compose";
import sample from "@/lib/fixtures/analysis-sample.json";
import { extractionSchema, PRICE_PLACEHOLDER, type Extraction } from "@/lib/llm/prompt";

// Sortie de modèle simulée, construite à partir de la fixture d'exemple.
function makeExtraction(overrides: Partial<Extraction> = {}): Extraction {
  return extractionSchema.parse({
    ...sample,
    negotiate: [
      { label: "Facturer les droits pub", why: "Ils ont de la valeur.", priority: 1, topic: "paid_ads" },
      { label: "Limiter les révisions", why: "Sinon ça ne s'arrête pas.", priority: 2, topic: "revisions" },
    ],
    counter_offer: { changes: ["Droits pub facturés à part"] },
    ready_to_send_message: { tone: "cordial", text: `Mon tarif pour ce projet : ${PRICE_PLACEHOLDER}.` },
    ...overrides,
  });
}

describe("composeAnalysis", () => {
  it("calcule chiffrage, score, couche légale et contre-offre côté code", () => {
    const analysis = composeAnalysis(makeExtraction());
    expect(analysis.estimate.total_low).not.toBeNull();
    expect(analysis.counter_offer.amount_low).toBe(analysis.estimate.total_low);
    expect(analysis.counter_offer.amount_high).toBe(analysis.estimate.total_high);
    expect(analysis.ready_to_send_message.text).not.toContain(PRICE_PLACEHOLDER);
    expect(analysis.ready_to_send_message.text).toMatch(/entre .+ et .+ €/);

    const paidAds = analysis.negotiate.find((n) => n.label === "Facturer les droits pub");
    const paidAdsLine = analysis.estimate.lines.find((l) => l.label.startsWith("Droits pub"));
    expect(paidAds?.eur_impact_low).toBe(paidAdsLine?.eur_low);
    expect(analysis.negotiate.find((n) => n.label === "Limiter les révisions")?.eur_impact_low).toBeNull();
  });

  it("sans montant proposé : confiance faible et total null", () => {
    const base = makeExtraction();
    const analysis = composeAnalysis(
      makeExtraction({
        confidence: "high",
        deal: { ...base.deal, payment: { ...base.deal.payment, amount_eur: null } },
        ready_to_send_message: { tone: "cordial", text: "Quel budget avez-vous prévu ?" },
      }),
    );
    expect(analysis.confidence).toBe("low");
    expect(analysis.estimate.total_low).toBeNull();
    expect(analysis.counter_offer.amount_low).toBeNull();
    expect(analysis.fr_legal.threshold_1000_reached).toBe("unknown");
  });

  it("ne chiffre un même sujet qu'une fois, sur le point le plus prioritaire", () => {
    const analysis = composeAnalysis(
      makeExtraction({
        negotiate: [
          { label: "Encadrer l'usage pub", why: "Trop large.", priority: 2, topic: "paid_ads" },
          { label: "Facturer les droits pub", why: "Ils ont de la valeur.", priority: 1, topic: "paid_ads" },
        ],
      }),
    );
    expect(analysis.negotiate.map((n) => n.label)).toEqual(["Facturer les droits pub", "Encadrer l'usage pub"]);
    expect(analysis.negotiate[0].eur_impact_low).not.toBeNull();
    expect(analysis.negotiate[1].eur_impact_low).toBeNull();
  });

  it("ajoute les hypothèses fournies par la route", () => {
    const analysis = composeAnalysis(makeExtraction(), { extraAssumptions: ["Texte tronqué."] });
    expect(analysis.estimate.assumptions[0]).toBe("Texte tronqué.");
  });
});
