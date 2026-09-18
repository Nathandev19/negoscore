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

// Un choix de niveau et le moment où il a été fait (millisecondes depuis
// 1970). Le cookie et le compte portent chacun le leur : c'est le plus récent
// qui s'applique à l'analyse suivante (mission #065). at = 0 : moment inconnu
// (cookie écrit avant la #065, compte sans date) — plus ancien que tout choix daté.
export type TierChoice = { tier: Tier; at: number };

// Valeur du cookie : « niveau.horodatage », par exemple « starter.1758200000000 ».
export function encodeTierCookie(tier: Tier, at: number): string {
  return `${tier}.${Math.max(0, Math.round(at))}`;
}

// Lit les deux formats : l'ancien (« starter ») et le nouveau (« starter.1758… »).
export function parseTierCookie(value: string | null): TierChoice | null {
  if (!value) return null;
  const [raw, stamp] = value.split(".");
  const tier = parseTier(raw);
  if (!tier) return null;
  const at = stamp === undefined ? 0 : Number(stamp);
  return { tier, at: Number.isSafeInteger(at) && at > 0 ? at : 0 };
}

// Le plus récent des deux. À égalité (y compris deux dates inconnues), le
// compte l'emporte, comme avant la #065.
export function latestTierChoice(account: TierChoice | null, cookie: TierChoice | null): TierChoice | null {
  if (!account) return cookie;
  if (!cookie) return account;
  return cookie.at > account.at ? cookie : account;
}
