// Mission #203, chantier B — LE CHEMIN CLIENT D'UN TOUR, DU CLIC À L'AFFICHAGE.
//
// `negotiation_turns.latency_ms` n'encadre que l'appel au modèle : il est
// ouvert avant la boucle d'essais et fermé au premier essai valide
// (lib/llm/extract.ts, lignes 159 et 205). Entre le clic et le tour à l'écran
// il y a tout le reste — l'aller vers l'hébergeur, le démarrage à froid, la
// réponse, le plancher d'attente, et l'aller-retour complet que
// router.refresh() demande au serveur pour refaire la page.
//
// Onze secondes n'étaient pas attribuées entre la médiane en base (22,2 s) et
// les 34 s vues à l'écran. L'hypothèse retenue par la #202 est que 34 s est un
// échantillon de queue, pas une médiane : avec un maximum enregistré de
// 36 243 ms, aucune seconde cachée côté navigateur n'est nécessaire pour
// l'expliquer. CE MODULE SERT À LE VÉRIFIER À L'USAGE, pas à le supposer.
//
// CE QUI SORT D'ICI : des durées en millisecondes, et rien d'autre. Aucun
// texte d'offre, aucune réponse de marque, aucun identifiant de compte ou
// d'analyse, aucun montant, aucun numéro de tour. Les séries sont numérotées
// 1, 2, 3… dans l'onglet courant, ce qui ne désigne personne.
//
// CE QUI N'EN SORT PAS NON PLUS : rien ne part sur le réseau. Les repères ne
// vivent que dans la mémoire de l'onglet et s'affichent dans la console.

export const CHRONO_FLAG = "ns_chrono";

// Les quatre repères demandés, dans l'ordre où ils tombent.
export const CHRONO_MARKS = ["clic", "requete_partie", "reponse_recue", "tour_affiche"] as const;
export type ChronoMark = (typeof CHRONO_MARKS)[number];

export const CHRONO_LABEL: Record<ChronoMark, string> = {
  clic: "clic sur le bouton",
  requete_partie: "requête partie",
  reponse_recue: "réponse reçue",
  tour_affiche: "tour affiché",
};

export type ChronoSerie = {
  // Rang dans l'onglet : 1 pour le premier tour chronométré, 2 pour le suivant.
  rang: number;
  // Décalage en millisecondes depuis le clic, par repère. Un repère absent
  // n'est pas tombé : le tour a échoué, ou il est encore en cours.
  marques: Partial<Record<ChronoMark, number>>;
};

// Mémoire de l'onglet. Elle survit à router.refresh(), qui réaffiche la page
// sans démonter l'arbre client — c'est pour ça que le quatrième repère peut
// être posé après coup, par le composant qui voit le tour arriver.
let series: ChronoSerie[] = [];
let rang = 0;

// Le drapeau. Rien ne se mesure sans lui : aucun appel à Date.now(), aucune
// allocation. Une lecture de localStorage qui échoue (navigation privée,
// données de site bloquées) vaut « éteint », jamais une exception.
export function chronoActif(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(CHRONO_FLAG) === "1";
  } catch {
    return false;
  }
}

// Le départ d'une série, en temps absolu. Gardé à part des décalages pour que
// `marques` ne contienne que des durées, jamais une heure.
const departs = new Map<number, number>();

// Ouvre une série : c'est LE PREMIER REPÈRE, le clic. Rend le rang, ou null si
// le drapeau est éteint — l'appelant garde ce rang et le passe aux repères
// suivants, de sorte qu'un second envoi lancé entre-temps ne vienne pas
// écrire dans la série du premier.
export function chronoDebut(): number | null {
  if (!chronoActif()) return null;
  rang += 1;
  series.push({ rang, marques: { clic: 0 } });
  departs.set(rang, Date.now());
  // On garde les vingt dernières : de quoi comparer plusieurs tours d'une
  // même session sans laisser l'onglet grossir indéfiniment.
  if (series.length > 20) {
    for (const partie of series.slice(0, -20)) departs.delete(partie.rang);
    series = series.slice(-20);
  }
  return rang;
}

export function chronoMarque(rangSerie: number | null, mark: ChronoMark): void {
  if (rangSerie === null) return;
  const serie = series.find((s) => s.rang === rangSerie);
  const depart = departs.get(rangSerie);
  if (!serie || depart === undefined) return;
  // Un repère ne s'écrit qu'une fois : le tour peut être réaffiché (une
  // resynchronisation au retour d'absence, par exemple), et l'écraser ferait
  // grandir le total sans que rien ne se soit passé.
  if (serie.marques[mark] !== undefined) return;
  serie.marques[mark] = Date.now() - depart;
  if (mark === "tour_affiche") afficher(serie);
}

// Ce qu'on tape dans la console pour relire les séries. Le module est
// empaqueté : sans ce point d'entrée posé sur window, il n'y a aucun moyen de
// l'appeler depuis la console. Posé seulement quand le drapeau est levé.
export const CHRONO_GLOBAL = "negoscoreChrono";

export function chronoInstalleLecteur(): void {
  if (typeof window === "undefined" || !chronoActif()) return;
  (window as unknown as Record<string, unknown>)[CHRONO_GLOBAL] = () =>
    series.map((serie) => ({
      tour: serie.rang,
      ...Object.fromEntries(chronoSegments(serie).map((s) => [`${s.de}→${s.a}`, `${s.ms} ms`])),
      plancher: `${chronoPlancher(serie)} ms`,
      total: serie.marques.tour_affiche === undefined ? "en cours" : `${serie.marques.tour_affiche} ms`,
    }));
}

export function chronoSeries(): readonly ChronoSerie[] {
  return series;
}

// Remis à zéro entre deux tests ; sans usage en production.
export function chronoOublie(): void {
  series = [];
  departs.clear();
  rang = 0;
}

// Les segments d'une série : ce qui s'est passé ENTRE deux repères, parce que
// c'est ça qu'on cherche. Un repère manquant coupe la suite plutôt que de
// produire un segment inventé.
export function chronoSegments(serie: ChronoSerie): Array<{ de: ChronoMark; a: ChronoMark; ms: number }> {
  const segments: Array<{ de: ChronoMark; a: ChronoMark; ms: number }> = [];
  for (let i = 1; i < CHRONO_MARKS.length; i++) {
    const de = CHRONO_MARKS[i - 1];
    const a = CHRONO_MARKS[i];
    const debut = serie.marques[de];
    const fin = serie.marques[a];
    if (debut === undefined || fin === undefined) break;
    segments.push({ de, a, ms: fin - debut });
  }
  return segments;
}

// Le plancher d'attente de la mission #200 (900 ms) est dans le dernier
// segment : si la réponse revient avant, le rafraîchissement l'attend. Le dire
// évite de lire un serveur lent là où il n'y a qu'un plancher.
export const CHRONO_PLANCHER_MS = 900;

export function chronoPlancher(serie: ChronoSerie): number {
  const recue = serie.marques.reponse_recue;
  if (recue === undefined) return 0;
  return Math.max(0, CHRONO_PLANCHER_MS - recue);
}

function afficher(serie: ChronoSerie): void {
  const lignes = chronoSegments(serie).map((s) => `  ${CHRONO_LABEL[s.de]} → ${CHRONO_LABEL[s.a]}`.padEnd(42) + `${s.ms} ms`);
  const plancher = chronoPlancher(serie);
  const total = serie.marques.tour_affiche ?? 0;
  console.log(
    [
      `[negoscore] chrono tour ${serie.rang}`,
      ...lignes,
      plancher > 0 ? `  (dont plancher d'attente`.padEnd(42) + `${plancher} ms)` : null,
      `  TOTAL clic → tour affiché`.padEnd(42) + `${total} ms`,
    ]
      .filter((ligne): ligne is string => ligne !== null)
      .join("\n"),
  );
}
