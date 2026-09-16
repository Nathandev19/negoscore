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
export function normalizeDeal(deal: Deal): Deal {
  if (!deal.publication_required || deal.usage.organic) return deal;
  return { ...deal, usage: { ...deal.usage, organic: true } };
}
