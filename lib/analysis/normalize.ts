import { variablePayOf } from "@/lib/negotiation/commission";
import { requestedZones } from "@/lib/rates/zones";
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

// ZÉRO N'EST PAS UNE VALEUR, c'est une absence d'information (missions #057 et
// #058). Le prompt demande déjà null, mais rien ne le garantit : la protection
// est ici, dans le code, et le prompt n'est pas touché.
//   payment.amount_eur      0 donnait un rapport prix / plancher de 0, donc un
//                           score plafonné à 29 comme si la marque avait proposé
//                           quelque chose (#057) ;
//   in_kind_value_eur       0 rendait l'offre « chiffrée » et faisait écrire
//                           « 0 € en produits proposés » (#057) ;
//   deliverables.quantity   0 contournait le plafond de score à 69 réservé aux
//                           quantités inconnues, alors que le moteur chiffrait
//                           déjà un seul contenu (#058) ;
//   usage.duration_months   0 comptait comme une condition connue et facturait
//                           un mois de droits pub (#058) ;
//   exclusivity.duration_months  0 facturait une exclusivité d'un mois (#058).
function stated(value: number | null): number | null {
  return value === 0 ? null : value;
}

// DEVISE ÉTRANGÈRE (mission #058). Rien dans le code ne lisait payment.currency :
// un montant écrit en dollars, s'il arrivait dans amount_eur, était comparé à une
// fourchette en euros et affiché avec un « € ». Le test est volontairement une
// liste de devises reconnues, pas l'inverse : une graphie inattendue de l'euro
// (« EUR HT », « euros ») reste donc traitée comme des euros, et seule une
// devise clairement étrangère fait tomber le montant.
const FOREIGN_CURRENCY =
  /\$|£|¥|₣|\b(usd|gbp|chf|cad|aud|nzd|jpy|cny|hkd|sgd|sek|nok|dkk|pln|czk|huf|ron|bgn|try|rub|brl|inr|mad|tnd|aed|zar)\b|dollars?|pounds?|sterling|yen|francs?\s+suisses?/i;

export function isForeignCurrency(currency: string | null): boolean {
  return currency !== null && FOREIGN_CURRENCY.test(currency);
}

export function normalizeDeal(deal: Deal): Deal {
  const { payment, usage, exclusivity } = deal;
  // Montant en devise étrangère : il ne peut pas être comparé à une fourchette
  // en euros, il est donc traité comme un montant absent. Le moteur ajoute
  // l'hypothèse qui le dit (lib/rates/engine.ts).
  const amount = isForeignCurrency(payment.currency) ? null : stated(payment.amount_eur);
  return {
    ...deal,
    deliverables: deal.deliverables.map((deliverable) => ({ ...deliverable, quantity: stated(deliverable.quantity) })),
    usage: {
      ...usage,
      // Publier sur son propre compte est un usage organique.
      organic: usage.organic || deal.publication_required,
      duration_months: stated(usage.duration_months),
      // Mission #160 — LA VALIDATION A LIEU AVANT L'ENREGISTREMENT, et elle
      // ÉCARTE, elle ne rejette pas : une zone que la table ne connaît pas
      // disparaît, l'analyse continue. Une liste fermée ne doit jamais pouvoir
      // faire perdre la ligne qu'elle décore.
      //
      // La France est retirée ici aussi : elle vaut +0, et une ligne à 0 €
      // n'apprend rien à personne. Le moteur refiltre de toute façon avec la
      // table de l'analyse, qui n'est pas forcément la table courante.
      territory_zones: requestedZones(usage.territory_zones),
    },
    exclusivity: { ...exclusivity, duration_months: stated(exclusivity.duration_months) },
    payment: { ...payment, amount_eur: amount },
    in_kind_value_eur: stated(deal.in_kind_value_eur),
    // Mission #116 — le champ est optionnel à l'entrée du schéma, pour que les
    // analyses enregistrées avant lui restent lisibles. Après normalisation, il
    // existe toujours : tout ce qui suit peut le lire sans précaution.
    variable_pay: variablePayOf(deal),
  };
}
