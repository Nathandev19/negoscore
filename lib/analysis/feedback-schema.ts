import { z } from "zod";
import { FEEDBACK_COMMENT_MAX, FEEDBACK_RATINGS } from "@/lib/analysis/feedback-options";
import { TIERS } from "@/lib/rates/tier";

// Mission #137 — le SCHÉMA de l'avis, séparé de ses libellés.
//
// lib/analysis/feedback-options.ts est importé par le formulaire côté
// navigateur (components/result/estimate-feedback.tsx) pour ses libellés. Tant
// que le schéma y vivait, zod partait avec. La validation, elle, ne bouge pas
// d'un octet : elle est faite par le serveur, dans
// app/api/analyses/[id]/avis/route.ts, et c'est le seul endroit où elle a
// jamais eu lieu.

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
