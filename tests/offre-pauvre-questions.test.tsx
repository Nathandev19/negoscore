import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AnalysisResult } from "@/components/result/analysis-result";
import { composeAnalysis } from "@/lib/analysis/compose";
import { addMissingBriefQuestions, missingBriefQuestions } from "@/lib/analysis/evaluability";
import sparseFixture from "./fixtures/offre-courte-100-extraction.json";
import detailedFixture from "./fixtures/offre-detaillee-extraction.json";
import { extractionSchema } from "@/lib/llm/prompt";

// Extraction du vrai modèle sur « on te propose 100 € pour une vidéo » avant
// cette mission. Elle fixe le cas observé sans rappeler le modèle en test.
const sparse = extractionSchema.parse(sparseFixture);
const detailed = extractionSchema.parse(detailedFixture);

describe("offre de marque presque vide", () => {
  it("pose les questions manquantes dans le message réel, sans inventer de montant", () => {
    const analysis = composeAnalysis(sparse);
    const message = analysis.ready_to_send_message.text;
    expect(analysis.evaluability).toBe("incomplete");
    expect([analysis.estimate.total_low, analysis.estimate.total_high, analysis.score,
      analysis.counter_offer.amount_low, analysis.counter_offer.amount_high]).toEqual([null, null, null, null, null]);
    for (const question of [
      "Qui écrit le script ?", "Qui fait le montage ?", "Les rushs bruts doivent-ils être fournis, et par qui ?",
      "Combien de révisions sont prévues ?", "Quelle est la date de livraison attendue ?", "Quel est le délai de paiement ?",
    ]) expect(message, question).toContain(question);
    expect(message).not.toContain("100 €");
    const html = renderToStaticMarkup(createElement(AnalysisResult, { analysis, unlockHref: "/connexion" }));
    expect(html).toContain("Ton message prêt à envoyer");
    expect(html).toContain("Qui fait le montage ?");
    expect(html).toContain("Qui écrit le script ?");
  });

  it("ne demande rien de ce que l'offre détaillée dit déjà", () => {
    expect(missingBriefQuestions(detailed.deal, "fr")).toEqual([]);
    const message = composeAnalysis(detailed).ready_to_send_message.text;
    for (const question of missingBriefQuestions(sparse.deal, "fr")) expect(message).not.toContain(question);
    expect(message).toContain("script fourni");
    expect(message).toContain("vidéo montée sans rushs");
  });

  it("garde le tutoiement ou le vouvoiement du message prêt à envoyer", () => {
    expect(addMissingBriefQuestions("Merci pour ta proposition.", sparse.deal, "fr")).toContain("peux-tu aussi me dire");
    expect(addMissingBriefQuestions("Merci pour votre proposition.", sparse.deal, "fr")).toContain("pourriez-vous aussi me dire");
  });

  it("une question disparaît quand sa réponse apparaît, indépendamment du prix", () => {
    const deal = sparse.deal;
    const questions = missingBriefQuestions(deal, "fr");
    expect(questions).toHaveLength(6);
    expect(missingBriefQuestions({ ...deal, payment: { ...deal.payment, amount_eur: 1000 } }, "fr")).toEqual(questions);
    for (const patch of [
      { script_by: "brand" as const },
      { editing_by: "creator" as const },
      { raw_footage_clarified: true },
      { revisions: { count: 2, unlimited: false } },
      { deadlines: ["15 novembre"] },
      { payment: { ...deal.payment, terms_days: 30 } },
      { payment: { ...deal.payment, schedule: "solde à la livraison" } },
    ]) expect(missingBriefQuestions({ ...deal, ...patch }, "fr")).toHaveLength(questions.length - 1);
  });

  it("un échéancier explicite suffit à ne pas redemander le délai dans une offre aux conditions inconnues", () => {
    const analysis = composeAnalysis(extractionSchema.parse({
      ...sparse,
      deal: {
        ...sparse.deal,
        usage: { ...sparse.deal.usage, organic: true },
        payment: { ...sparse.deal.payment, schedule: "solde à la livraison" },
      },
    }));
    expect(analysis.evaluability).toBe("terms_unknown");
    expect(analysis.ready_to_send_message.text).not.toContain("le délai de paiement");
  });

  it("les nouveaux faits de production n'entrent pas dans le moteur de prix ni le verdict", () => {
    for (const offer of [sparse, detailed]) {
      const withFacts = composeAnalysis(offer);
      const withoutFacts = composeAnalysis({
        ...offer,
        deal: { ...offer.deal, script_by: undefined, editing_by: undefined, raw_footage_clarified: undefined },
      });
      expect(withFacts.estimate).toEqual(withoutFacts.estimate);
      expect(withFacts.score).toEqual(withoutFacts.score);
      expect(withFacts.counter_offer).toEqual(withoutFacts.counter_offer);
      expect(withFacts.evaluability).toBe(withoutFacts.evaluability);
    }
  });
});
