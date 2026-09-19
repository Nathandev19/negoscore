import { z } from "zod";
import { TIERS } from "@/lib/rates/tier";

// Réponses possibles à « Cette estimation te paraît juste ? ». Sans accès
// serveur : importé aussi par le formulaire côté navigateur.

export const FEEDBACK_RATINGS = ["too_low", "fair", "too_high"] as const;
export type FeedbackRating = (typeof FEEDBACK_RATINGS)[number];

export const FEEDBACK_LABEL: Record<FeedbackRating, string> = {
  too_low: "Trop basse",
  fair: "Juste",
  too_high: "Trop haute",
};

export const FEEDBACK_COMMENT_MAX = 200;

export const feedbackInputSchema = z.object({
  rating: z.enum(FEEDBACK_RATINGS),
  comment: z
    .string()
    .max(FEEDBACK_COMMENT_MAX)
    .nullish()
    .transform((value) => (value && value.trim() !== "" ? value.trim() : null)),
  // Niveau affiché au moment de l'avis (mission #039). Obligatoire : un avis
  // « trop haute » sans le niveau ne dit rien de la table de tarifs.
  tier: z.enum(TIERS),
  // Mission #086 — tour dont la page affiche les chiffres au moment de l'avis :
  // 0 pour l'offre d'origine, 2 à 5 après un tour de négociation. Les chiffres
  // eux-mêmes sont recalculés par le serveur pour ce tour, jamais repris du
  // navigateur. Absent (page chargée avant cette version) : l'offre d'origine.
  turn: z
    .number()
    .int()
    .refine((turn) => turn === 0 || (turn >= 2 && turn <= 5))
    .default(0),
});

export type FeedbackInput = z.infer<typeof feedbackInputSchema>;
// turn : tour sur lequel porte l'avis enregistré (null : avis d'avant la
// mission #086, supposé porter sur l'offre d'origine).
export type StoredFeedback = { rating: FeedbackRating; comment: string | null; turn: number | null };

// Libellé du tour d'un avis, le même partout (formulaire, page des retours).
export function turnLabel(turn: number): string {
  return turn === 0 ? "l'offre d'origine" : `les termes après le tour ${turn}`;
}

