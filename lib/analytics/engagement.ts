// Mission #209 — CE QUI SE PASSE À L'INTÉRIEUR D'UNE PAGE.
//
// Le constat : 400 visites payantes, zéro analyse. Deux explications restaient
// ouvertes et le cockpit ne pouvait pas les séparer, parce qu'il mesure les
// ÉTAPES d'un funnel (visite → arrivée → analyse → inscription → achat) et
// rien de ce qui se passe entre deux étapes.
//
//   A. le trafic n'était pas réel
//   B. la page n'appelle aucune action
//
// CE MODULE EST CONÇU POUR LES SÉPARER, et c'est son seul but. Les signaux
// n'ont pas été choisis parce qu'ils sont faciles à relever, mais parce que
// chacun répond différemment selon A ou B :
//
//   trafic non réel (A)   aucun défilement, aucun geste, page visible moins
//                         d'une seconde, et aucun contact avec le champ.
//   page sans appel (B)   défilement réel, plusieurs secondes de lecture,
//                         des gestes — et toujours aucun contact avec le
//                         champ. C'est la signature d'une page qu'on lit et
//                         qu'on quitte.
//
// Ce qu'on sait DÉJÀ sans rien mesurer de plus, et qui cadre la question : les
// 400 visites ont été comptées par `landing_view`, qui est émis depuis un
// useEffect (components/analytics/first-party-view.tsx). Du JavaScript s'est
// donc exécuté 400 fois. « Pas réel » ne peut pas vouloir dire « aucun
// navigateur » : au mieux des navigateurs pilotés, au pire des fermetures
// immédiates. Les deux se lisent dans les signaux ci-dessus.
//
// ─── CE QUE CE MODULE NE FAIT PAS ──────────────────────────────────────────
//
// UN SEUL ÉVÉNEMENT PAR PAGE VUE, émis au départ. Pas un flux : ni un
// événement par palier de défilement, ni un battement périodique. C'est ce qui
// rend la mesure gratuite — aucun envoi pendant la lecture — et agrégée par
// construction : il n'y a pas de parcours à reconstituer, parce qu'il n'y a
// qu'une ligne par page vue.
//
// AUCUN IDENTIFIANT. Rien ici ne relie deux pages vues, ni dans la même
// session ni d'un jour à l'autre. Les champs sont des TRANCHES (« 25-50 % »,
// « 2-10 s »), pas des valeurs exactes : une durée à la milliseconde près est
// une empreinte, une tranche n'en est pas une.
//
// AUCUN CONTENU. Le champ de collage est relevé par un booléen — touché ou
// non — et par l'onglet choisi. Jamais ce qui y est écrit, jamais sa longueur.
//
// AUCUN STOCKAGE. Ni cookie, ni localStorage, ni sessionStorage : l'état vit
// en mémoire le temps de la page, et la page de confidentialité promet
// exactement ça (« ne dépose rien sur ton appareil »).
//
// AUCUNE DÉPENDANCE. Pas de script externe, pas de bibliothèque : ce fichier
// et un envoi par navigator.sendBeacon.

// ─── Les tranches, et pourquoi celles-là ────────────────────────────────────

// Profondeur de défilement atteinte. Les quatre quarts sont la convention de
// fait des outils de mesure ; ce qui compte ici est surtout de distinguer
// « n'a rien défilé » du reste, d'où une tranche à part pour le haut de page.
// Les étiquettes d'abord, les bornes ensuite : c'est l'ordre qui permet à zod
// et à la contrainte de la base de parler du MÊME vocabulaire fermé, sans
// qu'une conversion de type vienne s'interposer (app/api/events/route.ts).
export const SCROLL_LABELS = ["0", "1-25", "26-50", "51-75", "76-89", "90-100"] as const;
export type ScrollBucket = (typeof SCROLL_LABELS)[number];

export const SCROLL_BUCKETS: ReadonlyArray<{ max: number; label: ScrollBucket }> = [
  // Strictement : la page n'a pas bougé d'un pixel au-delà du premier écran.
  { max: 0, label: "0" },
  { max: 25, label: "1-25" },
  { max: 50, label: "26-50" },
  { max: 75, label: "51-75" },
  { max: 89, label: "76-89" },
  // LA DERNIÈRE TRANCHE EST SOURCÉE, les quatre précédentes non.
  //
  // Les quarts 25/50/75/100 sont une convention de praticien : le déclencheur
  // de profondeur de Google Tag Manager n'impose AUCUNE valeur par défaut
  // (support.google.com/tagmanager/answer/7679218 — « Enter one or more
  // positive integers separated by commas »). Elles servent à dessiner une
  // distribution, pas à définir « lue ».
  //
  // 90 %, lui, est publié : GA4 déclenche son événement `scroll` « the first
  // time a user reaches the bottom of each page (i.e., when a 90% vertical
  // depth becomes visible) » (support.google.com/analytics/answer/9216061).
  // C'est donc CETTE borne qui vaut « lue jusqu'au bout » dans le cockpit, et
  // pas un 100 % que presque personne n'atteint.
  { max: 100, label: "90-100" },
];

// Temps pendant lequel la page a été VISIBLE. Pas « temps sur la page » : un
// onglet ouvert en arrière-plan pendant vingt minutes n'a pas été lu, et c'est
// le premier mensonge du « temps sur la page ». Fathom arrête l'horloge pour
// la même raison (« We stop the clock when the browser tab is hidden »,
// usefathom.com/docs/start/measurement) ; GA4 ne compte que le temps « in
// focus » (support.google.com/analytics/answer/11109416).
//
// LES BORNES, ET D'OÙ ELLES VIENNENT :
//   1 s   la seule qui ne soit tirée d'aucun outil. Elle sépare « a fermé
//         avant que la page ait fini de s'afficher » du reste, et c'est le
//         discriminant de cette mission : sous une seconde, personne n'a rien
//         lu, et aucune correction de la page n'y changerait quoi que ce soit.
//   5 s   le SEUL chiffre que Microsoft Clarity publie : en dessous, la
//         session est de « low intent », et la documentation l'associe
//         explicitement au trafic automatisé ou à un décalage entre le contenu
//         et l'audience (learn.microsoft.com/clarity/insights/
//         user-intent-metrics). C'est aussi le délai au bout duquel Parse.ly
//         arrête son horloge d'engagement.
//  10 s   le seuil d'une « engaged session » GA4 (support.google.com/
//         analytics/answer/12195621), et celui du bounce de PostHog
//         (posthog.com/docs/web-analytics/dashboard).
//  30 s   aucune source ne la donne. Elle borne la queue pour que « 10-30 s »
//         veuille dire quelque chose, et le dernier palier dit « au-delà ».
//
// À NOTER, et c'est un signal en soi : Clarity classe « resté longtemps SANS
// interagir » au même rang de faible intention que « moins de 5 secondes ».
// Le cockpit lit donc les deux (lib/admin/data.ts).
export const DWELL_LABELS = ["0-1s", "1-5s", "5-10s", "10-30s", "30s+"] as const;
export type DwellBucket = (typeof DWELL_LABELS)[number];

export const DWELL_BUCKETS: ReadonlyArray<{ max: number; label: DwellBucket }> = [
  { max: 1_000, label: "0-1s" },
  { max: 5_000, label: "1-5s" },
  { max: 10_000, label: "5-10s" },
  { max: 30_000, label: "10-30s" },
  { max: Number.POSITIVE_INFINITY, label: "30s+" },
];

// Délai avant le PREMIER geste, quel qu'il soit. « aucun » est une valeur à
// part entière, et c'est celle qu'on cherche. Mêmes bornes que ci-dessus, aux
// mêmes sources, sans la queue à 30 s : un premier geste au-delà de dix
// secondes est déjà « a hésité longtemps », et le découper plus finement
// n'apprendrait rien de plus.
export const FIRST_ACTION_LABELS = ["0-1s", "1-5s", "5-10s", "10s+"] as const;
// « aucun » fait partie du vocabulaire mais d'aucune tranche : c'est l'absence
// de geste, pas un délai.
export const FIRST_ACTION_VALUES = [...FIRST_ACTION_LABELS, "aucun"] as const;
export type FirstActionBucket = (typeof FIRST_ACTION_VALUES)[number];

export const FIRST_ACTION_BUCKETS: ReadonlyArray<{ max: number; label: (typeof FIRST_ACTION_LABELS)[number] }> = [
  { max: 1_000, label: "0-1s" },
  { max: 5_000, label: "1-5s" },
  { max: 10_000, label: "5-10s" },
  { max: Number.POSITIVE_INFINITY, label: "10s+" },
];

// L'onglet du formulaire touché en premier, ou « aucun ». C'est un EMPLACEMENT,
// jamais un contenu.
export const INPUT_TOUCHED = ["aucun", "text", "photo", "pdf"] as const;
export type InputTouched = (typeof INPUT_TOUCHED)[number];

export function scrollBucket(percent: number): ScrollBucket {
  // Une valeur qui n'est pas un nombre ne doit pas retomber sur la DERNIÈRE
  // tranche : `NaN <= 25` est faux comme toutes ses comparaisons, et la
  // recherche échouait jusqu'au bout. Un défaut de mesure deviendrait alors
  // « page lue en entier », soit exactement la conclusion inverse.
  if (!Number.isFinite(percent)) return SCROLL_BUCKETS[0].label;
  const borne = Math.max(0, Math.min(100, Math.round(percent)));
  return (SCROLL_BUCKETS.find((tranche) => borne <= tranche.max) ?? SCROLL_BUCKETS[SCROLL_BUCKETS.length - 1]).label;
}

export function dwellBucket(ms: number): DwellBucket {
  if (!Number.isFinite(ms)) return DWELL_BUCKETS[0].label;
  const borne = Math.max(0, ms);
  return (DWELL_BUCKETS.find((tranche) => borne < tranche.max) ?? DWELL_BUCKETS[DWELL_BUCKETS.length - 1]).label;
}

export function firstActionBucket(ms: number | null): FirstActionBucket {
  if (ms === null || !Number.isFinite(ms)) return "aucun";
  const borne = Math.max(0, ms);
  return (FIRST_ACTION_BUCKETS.find((tranche) => borne < tranche.max) ?? FIRST_ACTION_BUCKETS[FIRST_ACTION_BUCKETS.length - 1]).label;
}

// ─── Ce qui part dans l'événement ──────────────────────────────────────────

export type EngagementMetadata = {
  scroll: ScrollBucket;
  dwell: DwellBucket;
  first_action: FirstActionBucket;
  input: InputTouched;
  // LA PAGE A-T-ELLE BOUGÉ ? C'est une question différente de « jusqu'où a-t-on
  // vu », et il a fallu un test pour s'en apercevoir : `scroll` dit la part de
  // la page VUE, premier écran compris, donc une page de 4 000 px lue sur un
  // écran de 800 vaut déjà 20 % sans qu'on ait touché à rien. La tranche « 0 »
  // était inatteignable, et « n'a pas défilé » se confondait avec « a défilé un
  // peu » — exactement le signal qui sépare les deux hypothèses de la mission.
  //
  // Ce booléen-ci est levé par l'ÉVÉNEMENT de défilement, pas par un calcul.
  //
  // Il a pris la place d'un `interacted` qui ne disait rien de plus que
  // `first_action !== "aucun"` : une redondance ne vaut pas une mesure.
  scrolled: boolean;
};

// L'état d'une page vue, en mémoire. Volontairement sans classe et sans
// fermeture cachée : un objet nu se construit dans un test sans navigateur.
export type EngagementState = {
  /** Profondeur maximale atteinte, en pourcentage de la page. */
  maxScroll: number;
  /** Millisecondes pendant lesquelles la page a été visible. */
  dwellMs: number;
  /** Instant du dernier passage à « visible », ou null si cachée. */
  visibleDepuis: number | null;
  /** Délai du premier geste depuis le début de la mesure, ou null. */
  firstActionMs: number | null;
  /** La page a-t-elle bougé ? Levé par l'événement, jamais déduit. */
  aDefile: boolean;
  /** L'onglet du formulaire touché en premier. */
  input: InputTouched;
  /** L'événement est-il déjà parti ? Il ne part qu'une fois. */
  envoye: boolean;
  /** Début de la mesure. */
  depart: number;
};

export function nouvelEtat(maintenant: number): EngagementState {
  return {
    maxScroll: 0,
    aDefile: false,
    dwellMs: 0,
    visibleDepuis: maintenant,
    firstActionMs: null,
    input: "aucun",
    envoye: false,
    depart: maintenant,
  };
}

// Un geste. Le premier seul est daté : les suivants n'apprennent rien de plus
// et compter les gestes reviendrait à reconstituer un comportement individuel.
export function noterGeste(etat: EngagementState, maintenant: number): void {
  if (etat.firstActionMs === null) etat.firstActionMs = Math.max(0, maintenant - etat.depart);
}

// Le champ touché. Le PREMIER onglet touché est gardé : passer de « photo » à
// « text » ensuite ne change pas le fait qu'un geste a atteint le formulaire,
// et garder les deux serait déjà une suite d'actions.
export function noterChamp(etat: EngagementState, onglet: Exclude<InputTouched, "aucun">, maintenant: number): void {
  noterGeste(etat, maintenant);
  if (etat.input === "aucun") etat.input = onglet;
}

export function noterDefilement(etat: EngagementState, percent: number): void {
  if (percent > etat.maxScroll) etat.maxScroll = Math.min(100, percent);
}

// La page a bougé. Appelé depuis l'écouteur de défilement, pas depuis le
// calcul de profondeur : c'est le geste qui compte ici, pas la part vue.
export function noterPageBougee(etat: EngagementState): void {
  etat.aDefile = true;
}

// Passage visible → caché et retour. Le temps caché n'est pas compté.
export function noterVisibilite(etat: EngagementState, visible: boolean, maintenant: number): void {
  if (visible) {
    if (etat.visibleDepuis === null) etat.visibleDepuis = maintenant;
    return;
  }
  if (etat.visibleDepuis === null) return;
  etat.dwellMs += Math.max(0, maintenant - etat.visibleDepuis);
  etat.visibleDepuis = null;
}

export function mesure(etat: EngagementState, maintenant: number): EngagementMetadata {
  const visible = etat.visibleDepuis === null ? 0 : Math.max(0, maintenant - etat.visibleDepuis);
  return {
    scroll: scrollBucket(etat.maxScroll),
    dwell: dwellBucket(etat.dwellMs + visible),
    first_action: firstActionBucket(etat.firstActionMs),
    input: etat.input,
    scrolled: etat.aDefile,
  };
}

// ─── Le pont avec le formulaire ────────────────────────────────────────────
//
// Le champ de collage vit dans components/deal-input.tsx, le relevé dans
// components/analytics/page-engagement.tsx : deux composants frères, sans lien
// de parenté. Plutôt qu'un état partagé de module — qui survivrait à une
// navigation et attribuerait un contact à la page suivante —, le composant de
// mesure s'inscrit à son montage et se retire à son démontage. Sans lui, c'est
// une fonction vide : le formulaire de /analyse appelle la même ligne et il ne
// se passe rien.
let abonne: ((onglet: Exclude<InputTouched, "aucun">) => void) | null = null;

export function brancherChamp(fn: (onglet: Exclude<InputTouched, "aucun">) => void): () => void {
  abonne = fn;
  return () => {
    if (abonne === fn) abonne = null;
  };
}

export function signalerChamp(onglet: Exclude<InputTouched, "aucun">): void {
  abonne?.(onglet);
}

// La part de la page réellement parcourue, en pourcentage. Le bas du premier
// écran compte déjà comme vu : sur une page plus courte que l'écran, la
// réponse est 100 % et non « rien défilé », parce qu'il n'y avait rien à
// défiler. Confondre les deux ferait lire « personne ne descend » là où tout
// était visible d'emblée.
export function pourcentageVu(scrollY: number, viewport: number, hauteurTotale: number): number {
  if (!Number.isFinite(hauteurTotale) || hauteurTotale <= 0) return 0;
  // Aucun cas particulier pour une page plus courte que l'écran : le bornage
  // ci-dessous rend déjà 100 %. Il y avait ici un `if (hauteurTotale <=
  // viewport) return 100;` — la batterie de mutation a montré que le retirer
  // ne changeait RIEN, parce que (0 + 800) / 600 vaut 133 % avant bornage.
  // Une ligne qui ne décide de rien est une ligne qu'on relit pour rien.
  const vu = Math.max(0, scrollY) + viewport;
  return Math.max(0, Math.min(100, (vu / hauteurTotale) * 100));
}
