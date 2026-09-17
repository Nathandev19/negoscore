import type { Analysis } from "@/lib/schema";
import { formatAmount, formatEur } from "@/lib/money";

// Phrase de verdict en tête de la page de résultat. Écrite par le moteur,
// jamais par le modèle : elle ne dépend que de l'état d'évaluabilité, du
// montant proposé et de la fourchette calculée. Montants réels uniquement.

export type VerdictForm =
  | "complete_below"
  | "complete_within"
  | "complete_above"
  | "unpriced"
  | "incomplete"
  | "terms_unknown";

type VerdictInput = Pick<Analysis, "evaluability" | "deal" | "estimate">;

// Montant comparé : l'argent proposé, sinon la valeur des produits offerts
// (une offre payée en produits est « complete » sans montant en euros).
function offered(deal: Analysis["deal"]): { value: number; inKind: boolean } | null {
  if (deal.payment.amount_eur !== null) return { value: deal.payment.amount_eur, inKind: false };
  if (deal.in_kind_value_eur !== null) return { value: deal.in_kind_value_eur, inKind: true };
  return null;
}

// Position du montant : sous la borne basse, au-dessus de la borne haute, ou
// dedans (bornes comprises : un montant égal à la borne haute est « dans les prix »).
export function verdictForm(analysis: VerdictInput): VerdictForm {
  if (analysis.evaluability !== "complete") return analysis.evaluability;
  const offer = offered(analysis.deal);
  const { total_low: low, total_high: high } = analysis.estimate;
  if (offer === null || low === null || high === null) return "complete_within";
  if (offer.value < low) return "complete_below";
  if (offer.value > high) return "complete_above";
  return "complete_within";
}

// Titre en Bricolage 800 très serré : l'espace fine insécable du formateur
// (U+202F) y devient invisible (« 1785 »). L'insécable normale reste lisible.
function wide(text: string): string {
  return text.replace(/\u202f/g, "\u00a0");
}

export function verdictSentence(analysis: VerdictInput): string {
  return wide(sentence(analysis));
}

function sentence(analysis: VerdictInput): string {
  const form = verdictForm(analysis);
  if (form === "unpriced") return "Aucun montant dans cette offre. C'est la première chose à demander.";
  if (form === "incomplete") return "Trop peu d'informations pour chiffrer. Voilà ce qui manque.";
  if (form === "terms_unknown") return "Le prix est là, les conditions non. C'est là-dessus qu'il faut poser des questions.";

  const offer = offered(analysis.deal);
  const { total_low: low, total_high: high } = analysis.estimate;
  // « complete » sans montant ni fourchette ne se produit pas (le moteur chiffre
  // toute offre complète) ; on ne dit alors que ce qui est sûr.
  if (offer === null) return "C'est dans les prix pour ces droits.";
  const proposed = offer.inKind ? `${formatEur(offer.value)} en produits proposés.` : `${formatEur(offer.value)} proposés.`;
  if (form === "complete_below" && low !== null && high !== null) {
    const worth = low === high ? formatAmount(low) : `${formatAmount(low)} à ${formatAmount(high)}`;
    return `${proposed} Ces droits en valent ${worth}.`;
  }
  if (form === "complete_above") return `${proposed} C'est au-dessus de ce que ces droits valent.`;
  return `${proposed} C'est dans les prix pour ces droits.`;
}
