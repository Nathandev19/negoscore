import type { ResultView } from "@/lib/analysis/lock";
import type { Pricing } from "@/lib/negotiation/types";

// Mission #100, point 4 — la carte partageable doit porter le MÊME montant que
// l'écran de conclusion. Celui-ci vient de `offeredAmount` (mission #096), qui
// raisonne sur un chiffrage : voici celui d'une analyse déjà recalculée sur les
// termes actuels. Aucun calcul ici — seulement la forme attendue.
export function pricingOf(analysis: ResultView): Pricing {
  return {
    total_low: analysis.estimate.total_low,
    total_high: analysis.estimate.total_high,
    counter_low: analysis.counter_offer?.amount_low ?? null,
    counter_high: analysis.counter_offer?.amount_high ?? null,
    rate_table_version: analysis.estimate.rate_table_version,
    tier: analysis.profile_tier,
  };
}
