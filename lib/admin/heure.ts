// Mission #140 — /admin affiche l'heure de Paris, pas celle du serveur.
//
// Le serveur tourne en UTC. Les journaux Vercel, les DM Instagram et tout ce à
// quoi on compare une ligne du cockpit sont en heure de Paris. Deux heures
// d'écart ont déjà produit une conclusion fausse le 01/10 : un événement lu
// 18:46 dans le cockpit et 20:46 dans le journal passait pour deux événements.
//
// RIEN NE CHANGE EN BASE. `occurred_at` reste un timestamptz enregistré en UTC,
// et c'est très bien ainsi : un instant est un instant. Seul l'AFFICHAGE est
// traduit, ici, en un seul endroit.
//
// `Europe/Paris` et non un décalage fixe : le changement d'heure est géré par
// la base de données de fuseaux du moteur JavaScript. Un « +2 » écrit en dur
// serait faux six mois par an.

export const FUSEAU = "Europe/Paris";

// La mention à afficher, une fois, là où des heures sont listées. En toutes
// lettres : « 18:46 » ne dit pas de quel fuseau il parle.
export const MENTION_FUSEAU = "heure de Paris";

const INSTANT = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  timeZone: FUSEAU,
});

const INSTANT_COMPLET = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: FUSEAU,
});

const JOUR_SEUL = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: FUSEAU,
});

function lisible(valeur: string | number | Date | null | undefined): Date | null {
  if (valeur === null || valeur === undefined) return null;
  const date = valeur instanceof Date ? valeur : new Date(valeur);
  return Number.isNaN(date.getTime()) ? null : date;
}

// Un instant précis, à la seconde : c'est ce qu'on compare à un journal.
export function heureParis(valeur: string | number | Date | null | undefined): string {
  const date = lisible(valeur);
  return date ? INSTANT.format(date) : "—";
}

// Le même, avec l'année : pour les listes où l'on remonte loin.
export function dateHeureParis(valeur: string | number | Date | null | undefined): string {
  const date = lisible(valeur);
  return date ? INSTANT_COMPLET.format(date) : "—";
}

export function dateParis(valeur: string | number | Date | null | undefined): string {
  const date = lisible(valeur);
  return date ? JOUR_SEUL.format(date) : "—";
}
