import { computeEscalation } from "@/lib/legal/escalate";
import { computeFrLegal } from "@/lib/legal/fr";
import { PRICE_PLACEHOLDER, type Extraction } from "@/lib/llm/prompt";
import { computeEstimate } from "@/lib/rates/engine";
import { computeScore } from "@/lib/rates/score";
import { analysisSchema, type Analysis } from "@/lib/schema";

export const SCHEMA_VERSION = "1.0";

type ComposeOptions = { extraAssumptions?: string[] };

// Assemble la sortie du modèle et les calculs déterministes en une analyse
// conforme au schéma complet. Tous les montants viennent du moteur de tarifs.
export function composeAnalysis(extraction: Extraction, options: ComposeOptions = {}): Analysis {
  const { deal } = extraction;
  const computed = computeEstimate(deal);
  const estimate: Analysis["estimate"] = {
    ...computed,
    lines: computed.lines.map((line) => ({
      label: line.label,
      type: line.type,
      low: line.low,
      high: line.high,
      eur_low: line.eur_low,
      eur_high: line.eur_high,
    })),
    assumptions: [...(options.extraAssumptions ?? []), ...computed.assumptions],
  };

  // Un sujet de tarif n'est chiffré qu'une fois, sur le point le plus prioritaire.
  const pricedTopics = new Set<string>();
  const byPriority = [...extraction.negotiate].sort((a, b) => a.priority - b.priority);
  const negotiate = byPriority.map((item) => {
    const lines = pricedTopics.has(item.topic) ? [] : computed.lines.filter((line) => line.topic === item.topic);
    if (lines.length > 0) pricedTopics.add(item.topic);
    return {
      label: item.label,
      why: item.why,
      priority: item.priority,
      eur_impact_low: lines.length > 0 ? lines.reduce((sum, l) => sum + l.eur_low, 0) : null,
      eur_impact_high: lines.length > 0 ? lines.reduce((sum, l) => sum + l.eur_high, 0) : null,
    };
  });

  // Sans montant proposé, on ne peut pas être confiant, quoi qu'en dise le modèle.
  const confidence = deal.payment.amount_eur === null ? "low" : extraction.confidence;

  const analysis: Analysis = {
    schema_version: SCHEMA_VERSION,
    language: extraction.language,
    confidence,
    input_quality: extraction.input_quality,
    deal,
    score: computeScore(deal, estimate),
    good_points: extraction.good_points,
    negotiate,
    red_flags: extraction.red_flags,
    estimate,
    fr_legal: computeFrLegal(deal),
    escalate_to_professional: computeEscalation(deal),
    counter_offer: {
      amount_low: estimate.total_low,
      amount_high: estimate.total_high,
      changes: extraction.counter_offer.changes,
    },
    ready_to_send_message: {
      tone: extraction.ready_to_send_message.tone,
      text: fillPrice(extraction.ready_to_send_message.text, extraction.language, estimate),
    },
  };

  return analysisSchema.parse(analysis);
}

function fillPrice(text: string, language: Analysis["language"], estimate: Analysis["estimate"]): string {
  if (!text.includes(PRICE_PLACEHOLDER)) return text;
  const { total_low: low, total_high: high } = estimate;
  let price: string;
  if (low !== null && high !== null) {
    if (language === "en") {
      const n = new Intl.NumberFormat("en-GB");
      price = `between €${n.format(low)} and €${n.format(high)}`;
    } else {
      const n = new Intl.NumberFormat("fr-FR");
      price = `entre ${n.format(low)} et ${n.format(high)} €`;
    }
  } else {
    price = language === "en" ? "a rate I will detail in my quote" : "un tarif que je vous détaille dans mon devis";
  }
  return text.replaceAll(PRICE_PLACEHOLDER, price);
}
