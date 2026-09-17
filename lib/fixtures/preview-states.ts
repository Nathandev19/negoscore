import { composeAnalysis } from "@/lib/analysis/compose";
import { lockAnalysis, type ResultView } from "@/lib/analysis/lock";
import sample from "@/lib/fixtures/analysis-sample.json";
import { PRICE_PLACEHOLDER, type Extraction } from "@/lib/llm/prompt";
import type { Analysis } from "@/lib/schema";

// États de la page de résultat pour la prévisualisation de développement
// (app/dev/resultat) et pour les tests. Chaque analyse passe par le vrai
// moteur (composeAnalysis) : fourchette, score, évaluabilité et phrase de
// verdict sont ceux que verrait un utilisateur. Aucun appel au modèle.

export const PREVIEW_STATES = [
  "verrouille",
  "debloque",
  "complete",
  "au-dessus",
  "unpriced",
  "incomplete",
  "terms_unknown",
] as const;
export type PreviewState = (typeof PREVIEW_STATES)[number];

const TOPICS: Record<string, Extraction["negotiate"][number]["topic"]> = {
  "Limiter les révisions à 2 allers-retours": "revisions",
  "Facturer les droits pub à part": "paid_ads",
  "Faire payer l'exclusivité, ou la ramener à 1 mois": "exclusivity",
  "Proposer le raw footage en option payante": "raw_footage",
  "Paiement à 30 jours, avec 50 % à la signature": "payment_terms",
};

function baseExtraction(): Extraction {
  const source = structuredClone(sample) as unknown as Analysis;
  return {
    language: source.language,
    confidence: source.confidence,
    input_quality: source.input_quality,
    deal: source.deal,
    good_points: source.good_points,
    negotiate: source.negotiate.map((item) => ({
      label: item.label,
      why: item.why,
      priority: item.priority,
      topic: TOPICS[item.label] ?? "other",
    })),
    red_flags: source.red_flags,
    counter_offer: { changes: source.counter_offer.changes },
    ready_to_send_message: {
      tone: source.ready_to_send_message.tone,
      text: `Bonjour, merci pour votre message ! Le projet m'intéresse. Pour 2 vidéos TikTok avec 6 mois de droits pub, mon tarif se situe ${PRICE_PLACEHOLDER}. Je vous propose une exclusivité de 1 mois, 2 révisions incluses, et le raw footage en option. Dites-moi si ça vous convient.`,
    },
  };
}

function withAmount(extraction: Extraction, amount: number | null): Extraction {
  return { ...extraction, deal: { ...extraction.deal, payment: { ...extraction.deal.payment, amount_eur: amount } } };
}

export function previewAnalysis(state: PreviewState): { analysis: ResultView; unlocked: boolean } {
  const base = baseExtraction();
  const reference = composeAnalysis(base);
  const { total_low: low, total_high: high } = reference.estimate;

  switch (state) {
    case "verrouille":
      return { analysis: lockAnalysis(reference), unlocked: false };
    case "debloque":
      return { analysis: reference, unlocked: true };
    case "complete": {
      // Montant au milieu de la fourchette calculée : « dans les prix ».
      const middle = low !== null && high !== null ? Math.round((low + high) / 2) : 800;
      return { analysis: composeAnalysis(withAmount(base, middle)), unlocked: true };
    }
    case "au-dessus":
      return { analysis: composeAnalysis(withAmount(base, (high ?? 1000) + 300)), unlocked: true };
    case "unpriced":
      return { analysis: composeAnalysis(withAmount(base, null)), unlocked: true };
    case "incomplete":
      return {
        analysis: composeAnalysis({ ...base, deal: { ...base.deal, deliverables: [] } }),
        unlocked: true,
      };
    case "terms_unknown":
      return {
        analysis: composeAnalysis({
          ...base,
          deal: {
            ...base.deal,
            usage: { ...base.deal.usage, duration_months: null, territory: null, perpetual: false },
            exclusivity: { present: false, duration_months: null, category: null },
            ip_transfer: "unclear",
            revisions: { count: null, unlimited: false },
            payment: { ...base.deal.payment, terms_days: null },
          },
        }),
        unlocked: true,
      };
  }
}
