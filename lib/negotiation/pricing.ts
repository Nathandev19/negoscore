import { counterOfferRange } from "@/lib/analysis/anchoring";
import { engineParts } from "@/lib/analysis/engine-parts";
import { evaluability } from "@/lib/analysis/evaluability";
import type { ResultView } from "@/lib/analysis/lock";
import { recomputeForTier } from "@/lib/analysis/recompute";
import type { Deal, Pricing } from "@/lib/negotiation/types";
import { bandWithinRange, comparedAmountOf } from "@/lib/rates/score";
import type { RateTable } from "@/lib/rates/tables";
import type { Tier } from "@/lib/rates/tier";
import type { Analysis } from "@/lib/schema";

type Band = NonNullable<Analysis["score"]>["band"];

// Mission #080, F1 — tout chiffre d'un tour sort du moteur de tarifs, jamais
// du modèle. Deux sources, et deux seulement :
//   - rien n'a changé depuis l'analyse d'origine : ses chiffres, recalculés au
//     niveau affiché exactement comme la page de résultat le fait. La
//     fourchette ne bouge pas (B2) ;
//   - un terme a changé : le moteur, sur le deal mis à jour, avec la table de
//     l'analyse d'origine (mission #085) : un fil entier se chiffre avec la
//     même table, du premier chiffrage à la conclusion.

// Mission #169 — LE VERDICT EST CALCULÉ ICI, UNE FOIS, ET ENREGISTRÉ.
//
// La carte de verdict a besoin d'une bande et d'un montant comparé. Les
// recalculer dans la route de la carte supposerait d'y charger un Deal
// complet — donc le nom de la marque, et le texte libre que le moteur lit
// pour chiffrer. C'est ce qui a bloqué la #168. Le chiffrage reste donc là où
// il est déjà légitime, et la route se contente de lire.
//
// La bande et le montant comparé sortent du MÊME endroit que la fourchette :
// engineParts, c'est-à-dire exactement ce que la page de résultat affiche. Pas
// un second chemin de calcul.
function verdictDe(score: { value: number; band: Band } | null, deal: Deal): Pick<Pricing, "score" | "band" | "compared" | "ceiling"> {
  return {
    score: score?.value ?? null,
    band: score?.band ?? null,
    compared: comparedAmountOf(deal),
    ceiling: false,
  };
}

export function priceFor(deal: Deal, tier: Tier, table: RateTable): Pricing {
  const { estimate, counter, score } = engineParts(deal, evaluability(deal), tier, [], table);
  return {
    total_low: estimate.total_low,
    total_high: estimate.total_high,
    counter_low: counter.low,
    counter_high: counter.high,
    rate_table_version: estimate.rate_table_version,
    tier,
    ...verdictDe(score, deal),
  };
}

// LE MONTANT SUR LA TABLE N'EST PAS CELUI DES TERMES. Quand la marque a
// annoncé un plafond (« jusqu'à 900 € ») et que la créatrice s'apprête à
// l'accepter, c'est CE montant que la carte affiche — et c'est donc lui qui
// doit affronter la fourchette. Sinon la carte annonce un nombre et en juge
// un autre, le défaut même de la #167.
//
// La note ne bouge pas : elle dit ce que valent les TERMES, conditions
// comprises. Seule la position du montant est réévaluée, par la garde de la
// #167 — un montant sous le plancher ne peut pas porter « correct ».
export function withCeiling(pricing: Pricing, offered: number | null): Pricing {
  if (offered === null) return pricing;
  return {
    ...pricing,
    compared: offered,
    ceiling: true,
    band: pricing.score === null ? null : bandWithinRange(pricing.score, offered, pricing.total_low),
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
    // Le verdict de l'analyse telle qu'elle s'affiche au niveau demandé :
    // le même objet que la page montre, jamais un second calcul.
    ...verdictDe(shown.score, deal),
  };
}

// Table de l'analyse disparue du code (mission #085) : aucun chiffre, plutôt
// que ceux d'une autre table. La version reste celle de l'analyse.
export function unavailablePricing(version: string, tier: Tier): Pricing {
  // Aucun chiffre, donc aucune bande et aucun montant comparé : la carte ne
  // se produit pas, et le bouton ne s'affiche pas.
  return {
    total_low: null,
    total_high: null,
    counter_low: null,
    counter_high: null,
    rate_table_version: version,
    tier,
    score: null,
    band: null,
    compared: null,
    ceiling: false,
  };
}

// ATTENTION — cette fonction n'a aucun appelant dans le dépôt (vérifié le
// 09/10/2026 sur app, lib, components et tests). Elle est laissée telle
// qu'elle était : lui ajouter la bande et le montant comparé de la #169
// aurait été compliquer du code que rien n'exécute, et aucune mutation ne
// pouvait faire échouer cette garde.
export function samePricing(a: Pricing, b: Pricing): boolean {
  return a.total_low === b.total_low && a.total_high === b.total_high && a.counter_low === b.counter_low && a.counter_high === b.counter_high;
}
