import { beforeEach, describe, expect, it, vi } from "vitest";
import { composeAnalysis } from "@/lib/analysis/compose";
import { evaluability, missingInformation, scopeKnown } from "@/lib/analysis/evaluability";
import { dealRecapRows, deliverablesLine } from "@/lib/display";
import { baseExtraction } from "@/lib/fixtures/preview-states";
import { checkQuantity } from "@/lib/llm/extract";
import { computeEstimate, UNKNOWN_QUANTITY_ASSUMPTION } from "@/lib/rates/engine";

// Mission #033 A : une quantité à 0 ou absente est une information manquante,
// pas une erreur de lecture. Seule une quantité aberrante fait échouer
// l'extraction. Client OpenAI simulé : aucun appel réseau.

const model = vi.hoisted(() => ({ quantities: [] as Array<number | null>, calls: 0 }));

vi.mock("openai", () => {
  class OpenAI {
    responses = {
      create: async () => {
        model.calls += 1;
        const extraction = baseExtractionForMock();
        const quantity = model.quantities[Math.min(model.calls - 1, model.quantities.length - 1)];
        extraction.deal.deliverables = [{ ...extraction.deal.deliverables[0], quantity }];
        return {
          output_text: JSON.stringify(extraction),
          usage: { input_tokens: 1000, input_tokens_details: { cached_tokens: 0 }, output_tokens: 800, output_tokens_details: { reasoning_tokens: 300 } },
        };
      },
    };
  }
  return { default: OpenAI };
});

function baseExtractionForMock() {
  return baseExtraction();
}

const { extractDeal, ExtractionError } = await import("@/lib/llm/extract");

beforeEach(() => {
  model.quantities = [];
  model.calls = 0;
  vi.stubEnv("OPENAI_API_KEY", "cle-de-test");
});

describe("frontière du modèle : quantité à 0, absente, aberrante", () => {
  it("classement des quantités", () => {
    expect(checkQuantity(null)).toEqual({ kind: "unknown" });
    expect(checkQuantity(0)).toEqual({ kind: "unknown" });
    expect(checkQuantity(3)).toEqual({ kind: "count", value: 3 });
    expect(checkQuantity(50)).toEqual({ kind: "count", value: 50 });
    for (const value of [-1, 51, 32025, 2.5]) expect(checkQuantity(value)).toEqual({ kind: "aberrant", value });
  });

  it("quantité à 0 : l'extraction aboutit du premier coup, la quantité devient null", async () => {
    model.quantities = [0];
    const result = await extractDeal("Ça te dirait de faire quelques vidéos pour nous ?");
    expect(model.calls).toBe(1);
    expect(result.extraction.deal.deliverables[0].quantity).toBeNull();
  });

  it("quantité absente (null) : l'extraction aboutit", async () => {
    model.quantities = [null];
    const result = await extractDeal("Du contenu TikTok avec droits pub, 500 €.");
    expect(model.calls).toBe(1);
    expect(result.extraction.deal.deliverables[0].quantity).toBeNull();
  });

  it("quantité aberrante : rejetée, reprise une fois, puis échec", async () => {
    model.quantities = [32025, 32025];
    await expect(extractDeal("Offre")).rejects.toBeInstanceOf(ExtractionError);
    expect(model.calls).toBe(2);
    model.calls = 0;
    model.quantities = [-2, -2];
    await expect(extractDeal("Offre")).rejects.toThrow("quantité invraisemblable : -2");
  });

  it("quantité aberrante puis corrigée à la reprise : l'analyse aboutit", async () => {
    model.quantities = [32025, 2];
    const result = await extractDeal("Offre");
    expect(result.attempts).toBe(2);
    expect(result.extraction.deal.deliverables[0].quantity).toBe(2);
  });
});

describe("le reste de la chaîne avec une quantité non précisée", () => {
  const extraction = baseExtraction();
  const unknown = {
    ...extraction,
    deal: { ...extraction.deal, deliverables: [{ ...extraction.deal.deliverables[0], quantity: null }] },
  };
  const one = {
    ...extraction,
    deal: { ...extraction.deal, deliverables: [{ ...extraction.deal.deliverables[0], quantity: 1 }] },
  };

  it("moteur : un contenu supposé, hypothèse écrite, même chiffrage qu'une quantité de 1", () => {
    const estimate = computeEstimate(unknown.deal);
    expect(estimate.assumptions).toContain(UNKNOWN_QUANTITY_ASSUMPTION.video);
    expect(UNKNOWN_QUANTITY_ASSUMPTION.video).toBe("Nombre de vidéos non précisé : une seule vidéo supposée.");
    const reference = computeEstimate(one.deal);
    expect([estimate.total_low, estimate.total_high]).toEqual([reference.total_low, reference.total_high]);
    expect(reference.assumptions).not.toContain(UNKNOWN_QUANTITY_ASSUMPTION.video);
  });

  it("une hypothèse par type non précisé, un livrable précisé n'en ajoute pas", () => {
    const deal = {
      ...unknown.deal,
      deliverables: [
        { type: "video" as const, platform: "tiktok" as const, quantity: 2, format: null },
        { type: "story" as const, platform: "instagram" as const, quantity: null, format: null },
      ],
    };
    const assumptions = computeEstimate(deal).assumptions;
    expect(assumptions).toContain(UNKNOWN_QUANTITY_ASSUMPTION.story);
    expect(assumptions).not.toContain(UNKNOWN_QUANTITY_ASSUMPTION.video);
  });

  it("évaluabilité : un livrable sans quantité compte comme un livrable connu", () => {
    expect(scopeKnown(unknown.deal)).toBe(true);
    expect(evaluability(unknown.deal)).toBe(evaluability(one.deal));
  });

  it("analyse complète produite, hypothèse affichée dans l'estimation", () => {
    const analysis = composeAnalysis(unknown);
    expect(analysis.evaluability).toBe("complete");
    expect(analysis.score).not.toBeNull();
    expect(analysis.estimate.assumptions).toContain(UNKNOWN_QUANTITY_ASSUMPTION.video);
    expect(analysis.deal.deliverables[0].quantity).toBeNull();
  });

  it("affichage : jamais de « null » ni de chiffre inventé", () => {
    const recap = dealRecapRows(unknown.deal).find((row) => row.label === "Livrables");
    expect(recap?.value).toBe("Vidéos TikTok (nombre non précisé)");
    expect(deliverablesLine(unknown.deal)).toBe("Vidéos TikTok, nombre non précisé");
  });

  it("offre incomplète : le nombre de contenus figure dans ce qui manque", () => {
    const vague = { ...unknown.deal, payment: { ...unknown.deal.payment, amount_eur: null }, usage: { ...unknown.deal.usage, organic: false, paid_ads: false } };
    const analysis = composeAnalysis({ ...unknown, deal: vague, input_quality: { readable: true, missing_critical: [] } });
    expect(analysis.evaluability).toBe("incomplete");
    expect(missingInformation(analysis)).toContain("Le nombre de contenus attendus");
    expect(analysis.ready_to_send_message.text).toContain("le nombre de contenus attendus");
  });
});
