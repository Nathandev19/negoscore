import { z } from "zod";

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
});

export type FeedbackInput = z.infer<typeof feedbackInputSchema>;
export type StoredFeedback = { rating: FeedbackRating; comment: string | null };

