import type { Analysis } from "@/lib/schema";
import { formatAmount, formatEur } from "@/lib/money";
import { RATIO_ZERO } from "@/lib/rates/score";

// Phrase de verdict en tête de la page de résultat. Écrite par le moteur,
// jamais par le modèle : elle ne dépend que de l'état d'évaluabilité, du
// montant proposé, de la fourchette calculée et de la bande du score.
// Montants réels uniquement.
//
// La phrase parle du PRIX, le score parle du DEAL (prix et conditions). Quand
// le prix est bon mais le score ne l'est pas, la phrase nomme la raison, pour
// ne pas sembler contredire le score.

export type VerdictForm =
  | "complete_below"
  | "complete_within"
  | "complete_within_poor_terms"
  | "complete_above"
  | "complete_above_poor_terms"
  | "unpriced"
  | "incomplete"
  | "terms_unknown"
  | "terms_unknown_far_below";

type VerdictInput = Pick<Analysis, "evaluability" | "deal" | "estimate" | "score">;

// « Très en dessous » : moins de 40 % de la borne basse de la fourchette. C'est
// le seuil que le score applique déjà au prix (RATIO_ZERO, lib/rates/score.ts) :
// en dessous, le montant ne rapporte plus aucun point. La phrase dit donc
// « très en dessous » exactement quand le moteur considère que le prix ne vaut
// rien, sans introduire un second chiffre arbitraire.
export const FAR_BELOW_RATIO = RATIO_ZERO;

// Bandes à partir desquelles le deal est bon : en dessous, un prix correct ne
// suffit pas et les conditions sont la raison.
const GOOD_BANDS: ReadonlyArray<NonNullable<Analysis["score"]>["band"]> = ["good", "excellent"];

// Montant comparé : l'argent proposé, sinon la valeur des produits offerts
// (une offre payée en produits est « complete » sans montant en euros).
function offered(deal: Analysis["deal"]): { value: number; inKind: boolean } | null {
  if (deal.payment.amount_eur !== null) return { value: deal.payment.amount_eur, inKind: false };
  if (deal.in_kind_value_eur !== null) return { value: deal.in_kind_value_eur, inKind: true };
  return null;
}

export function farBelow(amount: number, low: number): boolean {
  return amount < FAR_BELOW_RATIO * low;
}

// Position du montant : sous la borne basse, au-dessus de la borne haute, ou
// dedans (bornes comprises : un montant égal à la borne haute est « dans les prix »).
export function verdictForm(analysis: VerdictInput): VerdictForm {
  const { total_low: low, total_high: high } = analysis.estimate;
  if (analysis.evaluability === "terms_unknown") {
    // Seulement l'argent : une valeur en produits n'est pas « proposée » en euros.
    const amount = analysis.deal.payment.amount_eur;
    return amount !== null && low !== null && farBelow(amount, low) ? "terms_unknown_far_below" : "terms_unknown";
  }
  if (analysis.evaluability !== "complete") return analysis.evaluability;
  const offer = offered(analysis.deal);
  const poorTerms = analysis.score !== null && !GOOD_BANDS.includes(analysis.score.band);
  if (offer === null || low === null || high === null) return poorTerms ? "complete_within_poor_terms" : "complete_within";
  if (offer.value < low) return "complete_below";
  if (offer.value > high) return poorTerms ? "complete_above_poor_terms" : "complete_above";
  return poorTerms ? "complete_within_poor_terms" : "complete_within";
}

// Titre en Bricolage 800 très serré : l'espace fine insécable du formateur
// (U+202F) y devient invisible (« 1785 »). L'insécable normale reste lisible.
function wide(text: string): string {
  return text.replace(/\u202f/g, "\u00a0");
}

export function verdictSentence(analysis: VerdictInput): string {
  return wide(sentence(analysis));
}

const POOR_TERMS = "Mais les conditions demandées posent problème.";

function sentence(analysis: VerdictInput): string {
  const form = verdictForm(analysis);
  if (form === "unpriced") return "Aucun montant dans cette offre. C'est la première chose à demander.";
  if (form === "incomplete") return "Trop peu d'informations pour chiffrer. Voilà ce qui manque.";
  if (form === "terms_unknown") return "Le prix est là, les conditions non. C'est là-dessus qu'il faut poser des questions.";
  if (form === "terms_unknown_far_below") {
    return `${formatEur(analysis.deal.payment.amount_eur ?? 0)} proposés, très en dessous de la valeur de ces droits. Et les conditions ne sont pas écrites.`;
  }

  const offer = offered(analysis.deal);
  const { total_low: low, total_high: high } = analysis.estimate;
  // « complete » sans montant ne se produit pas (le moteur chiffre toute offre
  // complète) ; on ne dit alors que ce qui est sûr.
  if (offer === null) return form === "complete_within_poor_terms" ? POOR_TERMS : "C'est dans les prix pour ces droits.";
  const proposed = offer.inKind ? `${formatEur(offer.value)} en produits proposés.` : `${formatEur(offer.value)} proposés.`;
  switch (form) {
    case "complete_below": {
      if (low === null || high === null) return proposed;
      const worth = low === high ? formatAmount(low) : `${formatAmount(low)} à ${formatAmount(high)}`;
      return `${proposed} Ces droits en valent ${worth}.`;
    }
    case "complete_above":
      return `${proposed} C'est au-dessus de ce que ces droits valent.`;
    case "complete_above_poor_terms":
      return `${proposed} C'est au-dessus de ce que ces droits valent. ${POOR_TERMS}`;
    case "complete_within_poor_terms":
      return `${proposed} C'est dans les prix pour ces droits. ${POOR_TERMS}`;
    default:
      return `${proposed} C'est dans les prix pour ces droits.`;
  }
}
