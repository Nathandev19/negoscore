import { counterOfferRange } from "@/lib/analysis/anchoring";
import { engineParts } from "@/lib/analysis/engine-parts";
import { evaluability } from "@/lib/analysis/evaluability";
import type { ResultView } from "@/lib/analysis/lock";
import { recomputeForTier } from "@/lib/analysis/recompute";
import type { Deal, Pricing } from "@/lib/negotiation/types";
import type { Tier } from "@/lib/rates/tier";

// Mission #080, F1 — tout chiffre d'un tour sort du moteur de tarifs, jamais
// du modèle. Deux sources, et deux seulement :
//   - rien n'a changé depuis l'analyse d'origine : ses chiffres, recalculés au
//     niveau affiché exactement comme la page de résultat le fait. La
//     fourchette ne bouge pas (B2) ;
//   - un terme a changé : le moteur, sur le deal mis à jour.

export function priceFor(deal: Deal, tier: Tier): Pricing {
  const { estimate, counter } = engineParts(deal, evaluability(deal), tier);
  return {
    total_low: estimate.total_low,
    total_high: estimate.total_high,
    counter_low: counter.low,
    counter_high: counter.high,
    rate_table_version: estimate.rate_table_version,
    tier,
  };
}

export function originPricing(original: ResultView, tier: Tier): Pricing {
  // Même recalcul que le sélecteur de niveau. Impossible (ancienne table,
  // offre incomplète) : l'analyse reste à son niveau, et le dit par « tier ».
  const shown = recomputeForTier(original, tier);
  const { estimate, deal } = shown;
  const counter = shown.counter_offer
    ? { low: shown.counter_offer.amount_low, high: shown.counter_offer.amount_high }
    : counterOfferRange(deal.payment.amount_eur, estimate.total_low, estimate.total_high);
  return {
    total_low: estimate.total_low,
    total_high: estimate.total_high,
    counter_low: counter.low,
    counter_high: counter.high,
    rate_table_version: estimate.rate_table_version,
    tier: shown.profile_tier,
  };
}

export function samePricing(a: Pricing, b: Pricing): boolean {
  return a.total_low === b.total_low && a.total_high === b.total_high && a.counter_low === b.counter_low && a.counter_high === b.counter_high;
}
