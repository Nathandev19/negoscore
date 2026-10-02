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

// ─── Le chemin inverse : une heure murale de Paris → un instant ────────────
//
// Mission #146. Les formats ci-dessus traduisent un instant pour l'afficher.
// Le champ « date de fin » d'un accès Pro offert fait le contraire : il produit
// une heure MURALE sans fuseau (datetime-local, « 2026-11-01T23:59 »), et il
// faut en déduire l'instant. `Date.parse()` sur cette forme la lit dans le
// fuseau du serveur — UTC sur Vercel — donc une date saisie en pensant Paris
// était enregistrée une à deux heures trop tard.
//
// La zone est NOMMÉE, jamais un décalage écrit en dur : le 25 octobre 2026,
// Paris passe de UTC+2 à UTC+1, en plein milieu de la période d'un grant en
// cours. « +2 » serait faux la moitié de l'année.

const PARTIES = new Intl.DateTimeFormat("en-US", {
  timeZone: FUSEAU,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

// Décalage de Paris à cet instant, en millisecondes : on relit l'heure murale
// que la zone affiche, et on la compare à l'instant. C'est la zone qui répond,
// changement d'heure compris.
function decalageParis(instant: number): number {
  const p: Record<string, string> = Object.create(null);
  for (const partie of PARTIES.formatToParts(new Date(instant))) p[partie.type] = partie.value;
  const mural = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return mural - instant;
}

const MURAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

// « 2026-11-01T23:59 » lu COMME UNE HEURE DE PARIS → l'instant correspondant.
// null : ce n'est pas une heure murale valide (format, ou date qui n'existe
// pas comme le 31 février). L'appelant refuse alors l'entrée, il ne devine pas.
//
// Deux passes : la première estime le décalage à partir de l'heure murale
// elle-même, la seconde le recalcule à l'instant trouvé. C'est la seconde qui
// rend juste une date proche d'un changement d'heure.
//
// Les deux cas limites du changement d'heure, et ce qu'on en fait :
//   - heure qui existe DEUX fois (25/10, 02:30) : on retient la première,
//     celle d'été. Déterministe, et elle se relit bien 02:30 à Paris ;
//   - heure qui n'existe PAS (29/03, 02:30) : elle tombe sur 03:30, juste
//     après le saut. Une échéance ne se perd pas pour une heure manquante.
export function instantDepuisParis(valeur: string | null | undefined): Date | null {
  const parties = typeof valeur === "string" ? MURAL.exec(valeur.trim()) : null;
  if (!parties) return null;
  const [, annee, mois, jour, heures, minutes, secondes] = parties;
  const mural = Date.UTC(Number(annee), Number(mois) - 1, Number(jour), Number(heures), Number(minutes), secondes ? Number(secondes) : 0);
  if (Number.isNaN(mural)) return null;
  // Date.UTC ne refuse rien : le 31 février devient le 3 mars, 25 h devient le
  // lendemain 1 h. On relit donc ce qu'il a produit et on exige que ce soit
  // mot pour mot ce qu'on lui a donné. Un seul test, plutôt que cinq
  // comparaisons de champs dont aucune ne se déclenchait seule.
  if (new Date(mural).toISOString().slice(0, 16) !== `${annee}-${mois}-${jour}T${heures}:${minutes}`) return null;
  const instant = mural - decalageParis(mural - decalageParis(mural));
  return Number.isNaN(instant) ? null : new Date(instant);
}

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
