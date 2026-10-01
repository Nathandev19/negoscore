// Réponses possibles à « Cette estimation te paraît juste ? ».
//
// Mission #137 — module SANS DÉPENDANCE, et c'est volontaire : le formulaire
// du navigateur l'importe pour ses libellés, et un import de valeur embarque
// tout le module. Le schéma de validation vit à côté
// (lib/analysis/feedback-schema.ts) et ne quitte jamais le serveur.

export const FEEDBACK_RATINGS = ["too_low", "fair", "too_high"] as const;
export type FeedbackRating = (typeof FEEDBACK_RATINGS)[number];

export const FEEDBACK_LABEL: Record<FeedbackRating, string> = {
  too_low: "Trop basse",
  fair: "Juste",
  too_high: "Trop haute",
};

export const FEEDBACK_COMMENT_MAX = 200;

// turn : tour sur lequel porte l'avis enregistré (null : avis d'avant la
// mission #086, supposé porter sur l'offre d'origine).
export type StoredFeedback = { rating: FeedbackRating; comment: string | null; turn: number | null };

// Libellé du tour d'un avis, le même partout (formulaire, page des retours).
export function turnLabel(turn: number): string {
  return turn === 0 ? "l'offre d'origine" : `les termes après le tour ${turn}`;
}

