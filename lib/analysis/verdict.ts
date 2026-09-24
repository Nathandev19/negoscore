import type { Analysis } from "@/lib/schema";
import { rangePosition } from "@/lib/analysis/anchoring";
import { WITHIN_RANGE_SENTENCE, type WithinRange } from "@/lib/content/labels";
import { formatAmount, formatEur } from "@/lib/money";
import { bandFor, hasUnknownQuantity, priceCapFor, pricePoints, RATIO_ZERO, SCORE_BASE, uncappedScore } from "@/lib/rates/score";

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
  // Mission #109, A — « dedans » se scinde par tiers : la phrase dit OÙ, pas
  // seulement que le montant est dans la fourchette.
  | "complete_within_bottom"
  | "complete_within_middle"
  | "complete_within_top"
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

// Ce que vaudrait l'offre sans aucun ajustement de conditions : la base et les
// seuls points de prix.
function priceOnlyScore(deal: Analysis["deal"], estimate: Analysis["estimate"]): number {
  const amount = deal.payment.amount_eur;
  if (amount === null || !estimate.total_low) return SCORE_BASE;
  return Math.round(SCORE_BASE + pricePoints(amount, estimate.total_low, estimate.total_high));
}

export function farBelow(amount: number, low: number): boolean {
  return amount < FAR_BELOW_RATIO * low;
}

// Mission #109, A — le tiers de la fourchette où tombe un montant qu'on sait
// déjà « dedans ». rangePosition rend « above » dès la borne haute atteinte,
// alors que le verdict compte les bornes comme dedans : un montant ÉGAL au
// haut est donc « top », pas un cas à part. Sans borne haute exploitable, il
// n'y a pas de tiers à nommer et on reste au milieu, qui n'affirme rien de
// plus que « dans les prix ».
export function withinRange(amount: number, low: number, high: number): WithinRange {
  if (!(high > low)) return "middle";
  const position = rangePosition(amount, low, high);
  if (position === "bottom") return "bottom";
  if (position === "middle") return "middle";
  return "top";
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
  // Quantité inconnue : le score peut être sous « good » à cause du seul plafond
  // (lib/rates/score.ts). Les conditions ne sont alors pas la raison, et la note
  // de plafond l'explique près du score.
  //
  // Mission #109, B — le plafond par le PRIX descend lui aussi le score sous
  // « bon » (tiers bas → 69, tiers médian → 84). Sans cette ligne, l'écran
  // annonçait « Mais les conditions demandées posent problème. » sur le cas de
  // référence, qui n'en demande aucune : c'est la position du montant qui
  // plafonne, et la note de plafond le dit déjà à côté du score.
  const cappedOnly =
    (hasUnknownQuantity(analysis.deal) ||
      priceCapFor(analysis.deal.payment.amount_eur, analysis.estimate.total_low, analysis.estimate.total_high) !== null) &&
    GOOD_BANDS.includes(uncappedScore(analysis.deal, analysis.estimate).band);
  //
  // Mission #109 — et les conditions ne sont nommées que si le PRIX SEUL aurait
  // suffi. Sans cette condition, une offre payée tout en bas de la fourchette,
  // sans une seule mauvaise clause, s'entendait dire « Mais les conditions
  // demandées posent problème. » : la note était basse à cause du prix, que la
  // phrase venait justement de nommer.
  const priceAloneGood = GOOD_BANDS.includes(bandFor(priceOnlyScore(analysis.deal, analysis.estimate)));
  const poorTerms = analysis.score !== null && !GOOD_BANDS.includes(analysis.score.band) && !cappedOnly && priceAloneGood;
  if (offer === null || low === null || high === null) return poorTerms ? "complete_within_poor_terms" : "complete_within_middle";
  if (offer.value < low) return "complete_below";
  if (offer.value > high) return poorTerms ? "complete_above_poor_terms" : "complete_above";
  if (poorTerms) return "complete_within_poor_terms";
  return `complete_within_${withinRange(offer.value, low, high)}` as const;
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
  if (offer === null) return form === "complete_within_poor_terms" ? POOR_TERMS : WITHIN_RANGE_SENTENCE.middle;
  const proposed = offer.inKind ? `${formatEur(offer.value)} en produits proposés.` : `${formatEur(offer.value)} proposés.`;
  // Quantité inconnue : la fourchette ne chiffre qu'un seul contenu, c'est un
  // plancher. La phrase ne dit donc ni « au-dessus » ni « dans les prix » pour
  // l'offre entière, seulement ce que vaut un contenu (mission #035 C).
  if (hasUnknownQuantity(analysis.deal) && low !== null && high !== null) {
    const worth = low === high ? formatAmount(low) : `${formatAmount(low)} à ${formatAmount(high)}`;
    const unit = `Un seul contenu en vaut ${worth}, et la marque n'a pas écrit combien elle en veut.`;
    return `${proposed} ${unit}`;
  }
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
    case "complete_within_poor_terms": {
      // Les conditions restent la raison annoncée, mais la position, elle, ne
      // se perd plus : « dans les prix » tout court était la phrase qui
      // contredisait la contre-offre.
      const within = low !== null && high !== null ? withinRange(offer.value, low, high) : "middle";
      return `${proposed} ${WITHIN_RANGE_SENTENCE[within]} ${POOR_TERMS}`;
    }
    case "complete_within_bottom":
      return `${proposed} ${WITHIN_RANGE_SENTENCE.bottom}`;
    case "complete_within_top":
      return `${proposed} ${WITHIN_RANGE_SENTENCE.top}`;
    default:
      return `${proposed} ${WITHIN_RANGE_SENTENCE.middle}`;
  }
}
