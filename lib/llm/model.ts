// Modèle retenu par l'éval texte et l'éval vision du 15/09/2026 (voir
// DECISIONS.md et evals/results/). Un seul modèle pour le texte et l'image.
// Aucun routeur, aucun repli automatique vers un autre fournisseur.

// Effort de raisonnement envoyé à l'API. null : le paramètre n'est pas envoyé,
// l'API applique sa valeur par défaut, « medium » pour ce modèle
// (developers.openai.com/api/docs/models/gpt-5.6-luna).
// Décision du 17/09/2026 : reste NON envoyé. Mesuré par evals/effort.ts
// (evals/results/effort-2026-09-17T12-50-01-154Z.json) : « low » accélère, mais
// fait échouer une offre entière de façon reproductible et perd de l'exactitude
// (99,3 % → 96,4 %).
export type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh" | "max";

// Verbosité du texte envoyée à l'API (text.verbosity). null : non envoyée,
// valeur par défaut « medium » (SDK openai 7.15, responses.d.ts).
// Décision du 17/09/2026 : « low », envoyée à chaque appel. Mesuré par
// evals/effort.ts --experiment=verbosity, effort constant medium
// (evals/results/verbosity-2026-09-17T13-27-04-483Z.json) : moins de jetons de
// sortie sur 23 fixtures sur 26, exactitude inchangée au bruit près (98,9 % en
// medium, 99,3 % en low), aucune erreur, aucune hallucination, schéma valide du
// premier coup partout ; latence p50 12,9 s → 11,4 s, p95 24,6 s → 19,5 s.
export type TextVerbosity = "low" | "medium" | "high";

export const MODEL: {
  id: string;
  envKey: string;
  pricingUsdPerMillion: { input: number; cachedInput: number; output: number };
  usdPerEur: number;
  reasoningEffort: ReasoningEffort | null;
  textVerbosity: TextVerbosity | null;
} = {
  id: "gpt-5.6-luna",
  envKey: "OPENAI_API_KEY",
  // Dollars par million de tokens, tarif public relevé le 15/09/2026.
  pricingUsdPerMillion: { input: 0.2, cachedInput: 0.02, output: 1.2 },
  // Taux de référence BCE du 11/09/2026.
  usdPerEur: 1.1592,
  reasoningEffort: null,
  textVerbosity: "low",
};
