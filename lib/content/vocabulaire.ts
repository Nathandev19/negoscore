import { FREE_ANALYSES, PACK_ANALYSES, PRO_ANALYSES_PER_PERIOD } from "@/lib/billing/plans";
import { LAST_TURN } from "@/lib/negotiation/types";

// Mission #093 — un seul vocabulaire pour tout ce qui est public : page,
// métadonnées, données structurées, emails, CGV.
//
// L'unité vendue est la NÉGOCIATION, parce que c'est l'unité réellement
// facturée : un achat couvre le deal du premier message jusqu'à la conclusion.
// « Analyse » ne désigne plus l'unité vendue (c'est une étape de la
// négociation) ; « crédit » reste le mot de la base et du code, jamais celui
// de la copie destinée à la personne.
//
// Les nombres viennent tous du code : jamais écrits à la main dans un texte.

// Nombre de tours d'un échange, l'analyse comprise (lib/negotiation/types.ts).
export const NEGOTIATION_TURNS = LAST_TURN;

// Mission #099, point 11 (audit B13) — le produit annonçait « jusqu'à 5 tours »
// et l'écran disait « les 4 tours sont utilisés » : le tour 1 est l'analyse
// elle-même. Côté client, on ne compte plus des « tours » mais des ÉCHANGES
// avec la marque, et l'analyse est nommée à part. Le nombre vient de la
// constante : il ne peut pas diverger de ce que la route autorise.
export const NEGOTIATION_EXCHANGES = LAST_TURN - 1;

// « l'analyse, puis jusqu'à 4 échanges avec la marque » : la formule, partout.
export const EXCHANGES_PHRASE = `l'analyse, puis jusqu'à ${NEGOTIATION_EXCHANGES} échanges avec la marque`;

// « 4 échanges », « 1 échange ».
export function exchanges(count: number): string {
  return `${count} échange${count > 1 ? "s" : ""}`;
}

export const NEGOTIATIONS = {
  free: FREE_ANALYSES,
  pack: PACK_ANALYSES,
  proPerPeriod: PRO_ANALYSES_PER_PERIOD,
} as const;

// « 3 négociations », « 1 négociation ».
export function negotiations(count: number): string {
  return `${count} négociation${count > 1 ? "s" : ""}`;
}

// Ce qu'une négociation contient, dit d'une seule façon partout.
export const WHAT_IS_A_NEGOTIATION = `Une négociation couvre un deal en entier : ${EXCHANGES_PHRASE}, et la conclusion. Répondre à la marque ne coûte rien de plus.`;

// Ce que le produit est, et ce qu'il n'est pas. Repris tel quel sur l'accueil.
export const COPILOT_PROMISE =
  "Negoscore est un copilote de négociation : il lit l'offre, la chiffre et rédige tes messages. Accepter ou refuser reste ta décision.";

export const ESTIMATE_DISCLAIMER =
  "Les montants affichés sont des repères de marché calculés à partir d'une table de tarifs, pas une promesse de gain.";
