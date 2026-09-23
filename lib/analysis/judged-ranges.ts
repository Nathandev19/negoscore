import type { ResultView } from "@/lib/analysis/lock";
import { recomputeForTier } from "@/lib/analysis/recompute";
import { formatEurRange } from "@/lib/money";
import { TIERS, type Tier } from "@/lib/rates/tier";

// Mission #097, étape 6 — la question de l'avis répète le chiffre jugé plutôt
// que de renvoyer à « la fourchette affichée plus haut ». Le niveau se change
// dans le navigateur sans recharger la page : la fourchette de CHAQUE niveau
// est donc calculée ici, côté serveur, par le même moteur que la page, et le
// formulaire prend celle du niveau affiché à l'instant.

export type JudgedRanges = Partial<Record<Tier, string | null>>;

export function judgedRanges(analysis: ResultView): JudgedRanges {
  const ranges: JudgedRanges = {};
  for (const tier of TIERS) {
    const shown = recomputeForTier(analysis, tier);
    ranges[shown.profile_tier] = formatEurRange(shown.estimate.total_low, shown.estimate.total_high);
  }
  return ranges;
}
