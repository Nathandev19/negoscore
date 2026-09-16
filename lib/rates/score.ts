import type { Analysis } from "@/lib/schema";

type Deal = Analysis["deal"];
type Estimate = Analysis["estimate"];
// Le score calculé existe toujours ; c'est l'analyse qui peut ne pas en porter.
type Score = NonNullable<Analysis["score"]>;

// Score déterministe sur 100.
// Base 50, puis ajustements additifs, puis borne entre 0 et 100.
//
// Plafond de fait à 90 (50 + 30 prix + 5 paiement rapide + 5 organique),
// conservé volontairement. Le score ne lit que ce qui est écrit dans l'offre :
// il récompense un prix aligné, un paiement rapide et un usage limité, mais il
// ne peut rien savoir de ce qui n'y figure pas (la marque paiera-t-elle
// vraiment, le brief va-t-il déraper, une clause arrivera-t-elle au contrat).
// Les 10 derniers points représentent ce risque qu'aucun texte ne lève : une
// offre n'est donc jamais notée parfaite. Aucun bonus supplémentaire n'est
// ajouté pour les atteindre, et la borne à 100 reste une simple sécurité.

const BASE = 50;
const MAX_PRICE_POINTS = 30;
// Ratio montant proposé / borne basse de l'estimation.
const RATIO_FULL = 1; // à partir de là : +30
const RATIO_ZERO = 0.4; // en dessous : +0

export function computeScore(deal: Deal, estimate: Estimate): Score {
  let value = BASE;

  // Prix : jusqu'à +30, linéaire entre un ratio de 0,4 et 1.
  // Sans montant proposé ou sans estimation totale, aucun point n'est donné.
  const amount = deal.payment.amount_eur;
  const ratio = amount !== null && estimate.total_low ? amount / estimate.total_low : null;
  if (ratio !== null) {
    const clamped = Math.min(Math.max(ratio, RATIO_ZERO), RATIO_FULL);
    value += (MAX_PRICE_POINTS * (clamped - RATIO_ZERO)) / (RATIO_FULL - RATIO_ZERO);
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
