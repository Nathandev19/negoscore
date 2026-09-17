import rates from "@/lib/rates/fr-2026.3.json";

// Niveau de la créatrice : la ligne de la table de tarifs utilisée pour la base.
// C'est le levier le plus fort du moteur (débutant 100–180 €, confirmé 250–500 €,
// expérimenté 500–800 € par vidéo) : il est choisi par la personne, jamais deviné
// (mission #039). Sans choix, le niveau par défaut de la table s'applique, et la
// page de résultat l'affiche comme un choix modifiable, pas comme une hypothèse.
//
// Sans accès serveur : importé aussi par le sélecteur côté navigateur.

export const TIERS = ["starter", "confirmed", "experienced"] as const;
export type Tier = (typeof TIERS)[number];

export const DEFAULT_TIER = rates.base_rates_eur.default_tier as Tier;

// Libellés en termes de travail et d'expérience, jamais de nombre d'abonnés :
// on ne peut pas le vérifier, et il ne dit pas ce qu'une marque paie.
// title : le choix. detail : ce qu'il veut dire concrètement. short : la carte
// partageable et le rappel sous le score.
export const TIER_LABEL: Record<Tier, { title: string; detail: string; short: string }> = {
  starter: {
    title: "Je débute",
    detail: "Premières collabs, souvent payées en produits ou peu payées.",
    short: "Je débute",
  },
  confirmed: {
    title: "J'ai déjà fait des collabs payées",
    detail: "Quelques contrats en euros, des vidéos à montrer aux marques.",
    short: "Déjà des collabs payées",
  },
  experienced: {
    title: "C'est mon métier",
    detail: "Des marques me paient régulièrement, certaines reviennent.",
    short: "C'est mon métier",
  },
};

// Préférence de calcul mémorisée dans le navigateur (compte ou visiteur
// anonyme). Pas une donnée sensible : elle ne dit que quelle ligne de la table
// utiliser. Lisible par le navigateur, qui l'écrit lui-même au changement.
export const TIER_COOKIE = "negoscore_niveau";
export const TIER_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function parseTier(value: unknown): Tier | null {
  return typeof value === "string" && (TIERS as readonly string[]).includes(value) ? (value as Tier) : null;
}
