// Modèle retenu par l'éval texte et l'éval vision du 15/09/2026 (voir
// DECISIONS.md et evals/results/). Un seul modèle pour le texte et l'image.
// Aucun routeur, aucun repli automatique vers un autre fournisseur.
export const MODEL = {
  id: "gpt-5.6-luna",
  envKey: "OPENAI_API_KEY",
  // Dollars par million de tokens, tarif public relevé le 15/09/2026.
  pricingUsdPerMillion: { input: 0.2, cachedInput: 0.02, output: 1.2 },
  // Taux de référence BCE du 11/09/2026.
  usdPerEur: 1.1592,
} as const;
