// Modèle retenu par l'éval texte et l'éval vision du 15/09/2026 (voir
// DECISIONS.md et evals/results/). Un seul modèle pour le texte et l'image.
// Aucun routeur, aucun repli automatique vers un autre fournisseur.

// Effort de raisonnement envoyé à l'API. null : le paramètre n'est pas envoyé,
// l'API applique sa valeur par défaut, « medium » pour ce modèle
// (developers.openai.com/api/docs/models/gpt-5.6-luna). C'est le comportement
// en production depuis le 15/09/2026 ; ne pas changer sans la mesure de
// evals/effort.ts (latence, coût et exactitude, medium contre low).
export type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh" | "max";

export const MODEL: {
  id: string;
  envKey: string;
  pricingUsdPerMillion: { input: number; cachedInput: number; output: number };
  usdPerEur: number;
  reasoningEffort: ReasoningEffort | null;
} = {
  id: "gpt-5.6-luna",
  envKey: "OPENAI_API_KEY",
  // Dollars par million de tokens, tarif public relevé le 15/09/2026.
  pricingUsdPerMillion: { input: 0.2, cachedInput: 0.02, output: 1.2 },
  // Taux de référence BCE du 11/09/2026.
  usdPerEur: 1.1592,
  reasoningEffort: null,
};
