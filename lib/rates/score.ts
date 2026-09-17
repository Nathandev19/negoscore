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

const BASE = 50;
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

// Au-dessus de ce rapport, le prix ne plafonne plus rien.
export const PRICE_CAP_FREE_RATIO = 0.85;

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

// Plafond prix réellement appliqué, c'est-à-dire qui a fait baisser le score :
// null s'il n'y en a pas, ou s'il ne mordait pas. Sert à expliquer la note sur
// la page de résultat (mission #050, partie B), jamais à la calculer.
export function appliedPriceCap(deal: Deal, estimate: Estimate): { cap: number; ratio: number; percent: number } | null {
  const ratio = priceRatio(deal, estimate);
  const cap = priceScoreCap(ratio);
  if (cap === null || ratio === null) return null;
  return withoutPriceCap(deal, estimate) > cap ? { cap, ratio, percent: Math.round(ratio * 100) } : null;
}

// Score plafonné par la quantité inconnue seulement : point de comparaison pour
// savoir si le plafond prix mord.
function withoutPriceCap(deal: Deal, estimate: Estimate): number {
  const raw = uncappedScore(deal, estimate).value;
  return hasUnknownQuantity(deal) ? Math.min(raw, UNKNOWN_QUANTITY_SCORE_CAP) : raw;
}

// Score avec les deux plafonds appliqués : quantité inconnue et prix. Quand les
// deux existent, le plus bas l'emporte. Ce sont des bornes supérieures : elles
// ne peuvent que faire baisser le score, jamais le monter.
export function computeScore(deal: Deal, estimate: Estimate): Score {
  const priceCap = priceScoreCap(priceRatio(deal, estimate));
  const value = Math.min(withoutPriceCap(deal, estimate), priceCap ?? Number.POSITIVE_INFINITY);
  return { value, band: bandFor(value) };
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
  return { value: bounded, band: bandFor(bounded) };
}

export function bandFor(value: number): Score["band"] {
  if (value < 30) return "bad";
  if (value < 50) return "weak";
  if (value < 70) return "fair";
  if (value < 85) return "good";
  return "excellent";
}
