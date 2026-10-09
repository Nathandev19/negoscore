import { rangePosition } from "@/lib/analysis/anchoring";
import type { Analysis } from "@/lib/schema";

type Deal = Analysis["deal"];
type Estimate = Analysis["estimate"];
// Le score calculé existe toujours ; c'est l'analyse qui peut ne pas en porter.
type Score = NonNullable<Analysis["score"]>;

// ÉCHELLE FIGÉE LE 17/09/2026 (mission #042), jusqu'à ce que les premiers avis
// réels « trop basse / juste / trop haute » soient exploitables. Toute
// modification avant cela rendrait ces avis incomparables entre eux.
//
// UNE SEULE EXCEPTION, le 17/09/2026 (mission #050) : l'ajout du plafond par le
// prix (PRICE_CAPS ci-dessous). Aucune composante de points n'a été touchée à
// cette occasion — ni la base, ni les points prix, ni les malus, ni les bonus,
// ni les seuils de libellés : seule une borne supérieure a été ajoutée. Le gel
// s'applique de nouveau ensuite.
//
// Score déterministe sur 100.
// Base 50, puis ajustements additifs, puis borne entre 0 et 100.
//
// 18 points sur 30 au plancher de la fourchette. La fourchette dit ce que valent
// les droits demandés : être payé à sa borne basse, c'est ne pas être floué, pas
// être bien payé. Sans autre ajustement, le plancher donne 68, encore « Deal
// correct » ; il faut un prix plus haut dans la fourchette, ou de bonnes
// conditions (paiement rapide, usage organique), pour passer « Bon deal ». Avec
// 30 points dès le plancher, le juste minimum serait noté comme une excellente
// offre et il n'y aurait plus rien à négocier sur le prix.
//
// 30 points dès la borne haute, sans distinction au-delà. Le score répond à une
// question : « dois-je négocier ? ». Au-dessus du haut de la fourchette, la
// réponse sur le prix est non, complètement : être payé 1,1 fois ou 3 fois le
// haut ne change rien à ce qu'il reste à faire. Distinguer au-delà donnerait
// l'impression qu'un meilleur prix reste à obtenir, alors que les seuls leviers
// restants sont les conditions, que les autres ajustements mesurent déjà.
//
// Plafond de fait à 90 (50 + 30 prix + 5 paiement rapide + 5 organique),
// conservé volontairement. Le score ne lit que ce qui est écrit dans l'offre :
// il récompense un prix bien placé, un paiement rapide et un usage limité, mais il
// ne peut rien savoir de ce qui n'y figure pas (la marque paiera-t-elle
// vraiment, le brief va-t-il déraper, une clause arrivera-t-elle au contrat).
// Les 10 derniers points représentent ce risque qu'aucun texte ne lève : une
// offre n'est donc jamais notée parfaite. Aucun bonus supplémentaire n'est
// ajouté pour les atteindre, et la borne à 100 reste une simple sécurité.
//
// Plafond à 69, la dernière valeur de « Deal correct », quand la quantité d'au
// moins un livrable n'est pas précisée (mission #035). Même logique : le score
// ne certifie pas ce qu'il n'a pas pu chiffrer. Le moteur suppose alors un seul
// contenu, la fourchette n'est qu'un plancher et le ratio montant / borne basse
// est surévalué : sans plafond, une offre qui demandera plusieurs vidéos pourrait
// être annoncée « Bon deal ». C'est le seul sens d'erreur que le produit ne peut
// pas se permettre. La raison est affichée près du score
// (QUANTITY_CAP_NOTE, lib/display.ts). Le plafond est un minimum appliqué à la
// fin : il ne change pas le sens des variations du score (invariant I10).

// Points inconditionnels. Exporté : la phrase de verdict s'en sert pour savoir
// si le PRIX SEUL aurait suffi à faire un bon deal, et donc si les conditions
// sont vraiment la raison d'une note basse (lib/analysis/verdict.ts).
export const SCORE_BASE = 50;
const BASE = SCORE_BASE;
const MAX_PRICE_POINTS = 30;
// Points gagnés en atteignant la borne basse de l'estimation. Ne pas être
// floué mérite l'essentiel du crédit prix, pas la totalité : le reste est
// réservé à qui est payé haut dans la fourchette.
const FLOOR_PRICE_POINTS = 18;
// Ratio montant proposé / borne basse en dessous duquel aucun point n'est donné.
// Exporté : la phrase de verdict s'en sert pour dire « très en dessous ».
export const RATIO_ZERO = 0.4;

// Points prix selon la position du montant dans la fourchette :
//   montant < 0,4 × bas       → 0
//   0,4 × bas → bas           → 0 à 18, linéaire
//   bas → haut                → 18 à 30, linéaire
//   montant ≥ haut            → 30
// Sans borne haute exploitable (nulle ou égale à la basse), la règle
// précédente s'applique : 0 à 30 entre 0,4 × bas et bas.
export function pricePoints(amount: number, low: number, high: number | null): number {
  const zero = RATIO_ZERO * low;
  if (amount <= zero) return 0;
  if (high === null || high <= low) {
    return amount >= low ? MAX_PRICE_POINTS : (MAX_PRICE_POINTS * (amount - zero)) / (low - zero);
  }
  if (amount < low) return (FLOOR_PRICE_POINTS * (amount - zero)) / (low - zero);
  if (amount >= high) return MAX_PRICE_POINTS;
  return FLOOR_PRICE_POINTS + ((MAX_PRICE_POINTS - FLOOR_PRICE_POINTS) * (amount - low)) / (high - low);
}

export const UNKNOWN_QUANTITY_SCORE_CAP = 69;

export function hasUnknownQuantity(deal: Deal): boolean {
  return deal.deliverables.some((d) => d.quantity === null);
}

// PLAFOND PAR LE PRIX (mission #050). r = montant proposé / borne basse de la
// fourchette. Les 50 points de base sont inconditionnels : sans ce plafond, une
// offre payée à moitié pouvait afficher « Deal correct », voire « Bon deal ».
// Le plafond ne retire aucun point, il borne le score par le haut : une offre
// très en dessous du prix ne peut pas être annoncée comme correcte, quelles que
// soient ses autres qualités.
//   r < 0,40          → 29 au plus (« Mauvais deal »)
//   0,40 ≤ r < 0,60   → 39 au plus (« Deal faible »)
//   0,60 ≤ r < 0,85   → 59 au plus (« Deal correct »)
//   r ≥ 0,85          → aucun plafond
// Sans fourchette exploitable (montant absent, borne basse absente ou nulle),
// aucun plafond prix : le score ne peut pas être comparé à un prix qui n'a pas
// été chiffré.
export const PRICE_CAPS: ReadonlyArray<{ readonly minRatio: number; readonly cap: number }> = [
  { minRatio: 0.6, cap: 59 },
  { minRatio: 0.4, cap: 39 },
  { minRatio: 0, cap: 29 },
];

// Au-dessus de ce rapport, le prix ne plafonne plus rien SOUS LA FOURCHETTE.
export const PRICE_CAP_FREE_RATIO = 0.85;

// PLAFOND PAR LA POSITION DANS LA FOURCHETTE (mission #109, B).
//
// Le plafond ci-dessus mesure r = montant / borne BASSE : il cesse d'agir dès
// que le montant approche le plancher, par construction. Il ne savait donc rien
// de la position DANS la fourchette, et c'est là que l'écran se contredisait :
// sur le cas de référence (250 € dans 180 – 400 €), il affichait « Bon deal »
// et 72/100 au-dessus d'une contre-offre à 325 – 400 €. Être payé au tiers bas
// de ce que valent les droits n'est pas un bon deal : c'est un deal correct
// qu'il reste à négocier, et c'est exactement ce que la contre-offre dit.
//
//   tiers INFÉRIEUR  → 69 au plus, la dernière valeur de « Deal correct »
//   tiers MÉDIAN     → 84 au plus, la dernière valeur de « Bon deal »
//   tiers SUPÉRIEUR  → aucun plafond
//   au-dessus du haut → aucun plafond
//
// Les bandes (bandFor) ne changent pas : c'est la borne supérieure du score qui
// s'aligne dessus.
export const WITHIN_RANGE_CAPS: Readonly<Record<"bottom" | "middle", number>> = {
  bottom: 69,
  middle: 84,
};

// Pourquoi le score est plafonné, pour l'expliquer à l'écran sans jamais
// annoncer « X % du bas de la fourchette » à quelqu'un qui est DANS la
// fourchette — le pourcentage dépasserait 100 %.
export type PriceCapReason = "ratio" | "bottom" | "middle";

// Le plafond prix complet : sous la fourchette, les paliers de ratio existants,
// inchangés ; dedans, la position. Sans fourchette exploitable, aucun plafond.
export function priceCapFor(amount: number | null, low: number | null, high: number | null): { cap: number; reason: PriceCapReason } | null {
  if (amount === null || low === null || !(low > 0)) return null;
  if (amount < low || high === null || !(high > low)) {
    // Sous le plancher, les paliers de ratio existants s'appliquent, inchangés
    // — MAIS jamais plus haut que le tiers inférieur de la fourchette.
    //
    // Sans cette borne, le score REMONTAIT quand une contrainte s'ajoutait, ce
    // qui casse l'invariant I10 : 300 € dans 230 – 450 € est au tiers bas, donc
    // plafonné à 69 ; une plateforme de plus porte la fourchette à 320 – 630 €,
    // le montant passe SOUS le plancher à 94 % — au-dessus de PRICE_CAP_FREE_RATIO,
    // donc plus aucun plafond, et la note montait à 71. Être payé sous le
    // plancher ne peut pas valoir mieux qu'être payé au bas de la fourchette.
    // Les trois paliers (59, 39, 29) ne bougent pas : ils sont tous déjà
    // au-dessous de ce plafond, seule la zone 0,85 ≤ r < 1 était sans borne.
    const cap = priceScoreCap(amount / low);
    return { cap: Math.min(cap ?? WITHIN_RANGE_CAPS.bottom, WITHIN_RANGE_CAPS.bottom), reason: "ratio" };
  }
  const position = rangePosition(amount, low, high);
  if (position === "bottom" || position === "middle") return { cap: WITHIN_RANGE_CAPS[position], reason: position };
  return null;
}

// Part du plancher réellement payée par l'offre. null quand elle n'est pas
// calculable : c'est le cas A4, aucun plafond prix ne s'applique alors.
export function priceRatio(deal: Deal, estimate: Estimate): number | null {
  const amount = deal.payment.amount_eur;
  const low = estimate.total_low;
  if (amount === null || low === null || !(low > 0)) return null;
  return amount / low;
}

export function priceScoreCap(ratio: number | null): number | null {
  if (ratio === null || ratio >= PRICE_CAP_FREE_RATIO) return null;
  return PRICE_CAPS.find((step) => ratio >= step.minRatio)?.cap ?? null;
}

// Mission #113, B — LE SCORE MONTRÉ RESPECTE-T-IL LE PLAFOND D'AUJOURD'HUI ?
//
// Une analyse garde les chiffres du jour où elle a été faite (mission #085) :
// c'est son score ENREGISTRÉ qui s'affiche, pas un score recalculé. Tout ce qui
// se déduit de l'analyse à l'ouverture — la phrase de verdict, la note de
// plafond — est en revanche calculé par le code d'AUJOURD'HUI. Quand une règle
// de plafond change, les deux peuvent se contredire : une analyse d'avant la
// mission #109 affiche « Bon deal, 81/100 » pendant que la phrase, recalculée,
// dit « tout en bas de la fourchette ».
//
// Un seul endroit décide donc si le score montré et le plafond actuel sont
// d'accord. Quand ils ne le sont pas, ce qui se déduit se tait plutôt que de
// contredire le chiffre affiché : c'est le chiffre enregistré qui fait foi.
export function scoreHonoursPriceCap(deal: Deal, estimate: Estimate, score: Pick<Score, "value"> | null): boolean {
  if (!score) return true;
  const capped = priceCapFor(deal.payment.amount_eur, estimate.total_low, estimate.total_high);
  return capped === null || score.value <= capped.cap;
}

// Plafond prix réellement appliqué, c'est-à-dire qui a fait baisser le score :
// null s'il n'y en a pas, ou s'il ne mordait pas. Sert à expliquer la note sur
// la page de résultat (mission #050, partie B), jamais à la calculer.
export function appliedPriceCap(deal: Deal, estimate: Estimate): { cap: number; ratio: number; percent: number; reason: PriceCapReason } | null {
  const ratio = priceRatio(deal, estimate);
  const capped = priceCapFor(deal.payment.amount_eur, estimate.total_low, estimate.total_high);
  if (capped === null || ratio === null) return null;
  return withoutPriceCap(deal, estimate) > capped.cap
    ? { cap: capped.cap, ratio, percent: Math.round(ratio * 100), reason: capped.reason }
    : null;
}

// Score plafonné par la quantité inconnue seulement : point de comparaison pour
// savoir si le plafond prix mord.
function withoutPriceCap(deal: Deal, estimate: Estimate): number {
  const raw = uncappedScore(deal, estimate).value;
  return hasUnknownQuantity(deal) ? Math.min(raw, UNKNOWN_QUANTITY_SCORE_CAP) : raw;
}

// ─── Mission #167 — LE MONTANT COMPARÉ, et la bande qui ne peut pas le nier ──
//
// LE DÉFAUT, reproduit : une offre à 400 € face à une fourchette de
// 610 – 1310 € portait la bande « Deal correct ». La bande n'a jamais été une
// comparaison à la fourchette : c'est `bandFor(score)`, et le score est un
// composite — base 50, jusqu'à 30 points de prix, le reste en conditions.
// 400 € sous le plancher ne rapporte que 7,7 points de prix sur 30, mais
// 50 + 7,7 − 5 (exclusivité) + 5 (paiement à 30 jours) = 58, et 58 tombe dans
// la tranche 50–69 de « correct ». Le plafond par le prix de la #050 visait
// exactement ce cas et l'a manqué d'UN point : il plafonnait à 59.
//
// LA RÈGLE : un montant sous le plancher de la fourchette ne peut pas porter
// « correct », quoi que disent les conditions. Le score, lui, ne bouge pas —
// l'échelle de la #042 reste gelée, et aucun chiffre déjà mesuré ne change.
// Au-dessus du plancher, rien n'est touché : c'est là que les conditions
// doivent continuer à peser, et que la phrase de verdict lit la bande pour
// dire « ce sont tes conditions qui pèsent » (lib/analysis/verdict.ts).
//
// Le seuil entre « mauvais » et « faible » est RATIO_ZERO, déjà le seuil du
// « très en dessous » de la phrase de verdict : un seul seuil pour une seule
// idée.

// LE MONTANT COMPARÉ. Un seul endroit décide quel nombre affronte la
// fourchette, et c'est le même que celui qu'on affiche (« On m'a proposé »,
// carte de verdict) : sans ça l'écran se contredit lui-même.
//
// L'argent d'abord, les produits à défaut — et jamais la somme des deux : des
// produits ne sont pas de l'argent, et les additionner ferait passer une
// offre payée 400 € pour une offre à 489 € — le cas de la #167, 400 € plus
// 89 € de produits gardés. C'est la démonstration du guide
// /produits-offerts, elle vaut aussi ici.
export function comparedAmount(money: number | null, inKind: number | null): number | null {
  return money ?? inKind;
}

export function comparedAmountOf(deal: Deal): number | null {
  return comparedAmount(deal.payment.amount_eur, deal.in_kind_value_eur);
}

// La bande, corrigée par la position du montant comparé. Rien d'autre ne
// change : même score, même échelle, mêmes seuils.
export function bandWithinRange(value: number, amount: number | null, low: number | null): Score["band"] {
  const band = bandFor(value);
  if (amount === null || low === null || !(low > 0) || amount >= low) return band;
  return amount < RATIO_ZERO * low ? "bad" : "weak";
}

// Score avec les deux plafonds appliqués : quantité inconnue et prix. Quand les
// deux existent, le plus bas l'emporte. Ce sont des bornes supérieures : elles
// ne peuvent que faire baisser le score, jamais le monter.
export function computeScore(deal: Deal, estimate: Estimate): Score {
  const priceCap = priceCapFor(deal.payment.amount_eur, estimate.total_low, estimate.total_high);
  const value = Math.min(withoutPriceCap(deal, estimate), priceCap?.cap ?? Number.POSITIVE_INFINITY);
  return { value, band: bandWithinRange(value, comparedAmountOf(deal), estimate.total_low) };
}

// Score sans le plafond de quantité inconnue : ce que vaudrait l'offre si un
// seul contenu était demandé. Sert à dire pourquoi la note est plafonnée.
export function uncappedScore(deal: Deal, estimate: Estimate): Score {
  let value = BASE;

  // Prix : jusqu'à +30 selon la position dans la fourchette (voir pricePoints).
  // Sans montant proposé ou sans estimation totale, aucun point n'est donné.
  const amount = deal.payment.amount_eur;
  if (amount !== null && estimate.total_low) {
    value += pricePoints(amount, estimate.total_low, estimate.total_high);
  }

  // Droits cédés.
  if (deal.usage.perpetual) value -= 15;
  if (deal.ip_transfer === "full_assignment") value -= 10;
  if (deal.ai_training_rights === "present") value -= 10;

  // Exclusivité : -10 au-delà de 6 mois, -5 entre 3 et 6 mois inclus.
  // Durée inconnue : pas de pénalité, faute d'information.
  const exclusivityMonths = deal.exclusivity.present ? deal.exclusivity.duration_months : null;
  if (exclusivityMonths !== null) {
    if (exclusivityMonths > 6) value -= 10;
    else if (exclusivityMonths >= 3) value -= 5;
  }

  // Délai de paiement : -12 à 90 jours et plus, sinon -8 à 60 jours et plus,
  // +5 à 30 jours ou moins.
  const terms = deal.payment.terms_days;
  if (terms !== null) {
    if (terms >= 90) value -= 12;
    else if (terms >= 60) value -= 8;
    else if (terms <= 30) value += 5;
  }

  if (deal.revisions.unlimited) value -= 8;

  // Raw footage sans contrepartie : le montant proposé ne couvre pas la borne
  // basse de l'estimation, qui inclut la valeur des rushs.
  const rawFootageCovered = amount !== null && estimate.total_low !== null && amount >= estimate.total_low;
  if (deal.raw_footage && !rawFootageCovered) value -= 5;

  // Usage limité à l'organique : aucun droit publicitaire cédé.
  const { usage } = deal;
  if (usage.organic && !usage.paid_ads && !usage.whitelisting && !usage.spark_ads && !usage.perpetual) {
    value += 5;
  }

  const bounded = Math.round(Math.min(100, Math.max(0, value)));
  return { value: bounded, band: bandWithinRange(bounded, comparedAmountOf(deal), estimate.total_low) };
}

export function bandFor(value: number): Score["band"] {
  if (value < 30) return "bad";
  if (value < 50) return "weak";
  if (value < 70) return "fair";
  if (value < 85) return "good";
  return "excellent";
}
