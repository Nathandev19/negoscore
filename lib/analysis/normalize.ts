import type { Analysis } from "@/lib/schema";

type Deal = Analysis["deal"];

// Mise en cohérence du deal extrait, avant tout calcul : le score, le moteur
// de tarifs, la règle d'évaluabilité et l'affichage lisent tous ce deal-là.
//
// Une seule implication : publier sur son propre compte est un usage
// organique. Le contenu est diffusé sans publicité payante, auprès de
// l'audience du créateur, et c'est précisément ce que recouvre usage.organic.
// Le modèle relève parfois la publication sans cocher l'usage (vu en éval sur
// « Tu postes 1 vidéo sur ton TikTok, on te paie 250 € ») : les deux faits
// doivent dire la même chose.
//
// Rien d'autre n'est déduit. Publier ne dit rien d'une publicité payante, d'un
// whitelisting, de Spark Ads, d'une durée ou d'un territoire : les ajouter
// serait inventer des droits que l'offre n'accorde pas. Et un drapeau n'est
// jamais repassé de vrai à faux : on complète, on ne contredit pas l'extraction.
// Zéro n'est pas un prix : c'est une absence d'information (mission #057).
// Une valeur de produits à 0 rendait l'offre « chiffrée » et faisait écrire
// « 0 € en produits proposés » ; un montant à 0 faisait pire, il donnait un
// rapport prix / plancher de 0 et plafonnait le score à 29 comme si la marque
// avait vraiment proposé quelque chose. Les deux valent donc null ici, et tous
// les lecteurs du deal les voient absents.
function stated(value: number | null): number | null {
  return value === 0 ? null : value;
}

export function normalizeDeal(deal: Deal): Deal {
  const amount = stated(deal.payment.amount_eur);
  const inKind = stated(deal.in_kind_value_eur);
  const normalized: Deal =
    amount === deal.payment.amount_eur && inKind === deal.in_kind_value_eur
      ? deal
      : { ...deal, payment: { ...deal.payment, amount_eur: amount }, in_kind_value_eur: inKind };
  if (!normalized.publication_required || normalized.usage.organic) return normalized;
  return { ...normalized, usage: { ...normalized.usage, organic: true } };
}
