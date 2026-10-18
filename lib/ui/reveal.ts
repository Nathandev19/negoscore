// Mission #096, défaut 3 — on doit voir arriver la réponse.
//
// Constaté en production : on colle la réponse de la marque, on valide, ça
// charge, et quand c'est fini la page n'a pas bougé. Le tour qui vient d'être
// lu est plus bas, hors écran : rien ne dit qu'il est arrivé, ni où regarder.
//
// Ce module ne connaît pas le DOM : il décide QUOI amener en vue, et comment.
// Le composant lui passe l'élément. C'est ce qui le rend vérifiable en test,
// sans navigateur.

export const THREAD_ERROR_ID = "echange-erreur";
export const THREAD_PENDING_ID = "echange-lecture";

// Mission #200 — UN TOUR EST RAPIDE, ET L'INDICATEUR NE DOIT PAS CLIGNOTER.
//
// L'appel au modèle d'un tour prend en général quelques secondes, mais un
// rejeu par clé d'idempotence répond en quelques dizaines de millisecondes :
// le panneau apparaîtrait et disparaîtrait dans le même souffle, ce qui se lit
// comme un défaut d'affichage et non comme un travail fait.
//
// L'attente est donc tenue 900 ms AU MOINS. Le délai porte sur l'arrivée du
// RÉSULTAT, pas sur le panneau seul : on retarde le rafraîchissement, de sorte
// que le panneau s'efface exactement quand le tour apparaît. Les montrer tous
// les deux — « lecture en cours » au-dessus du tour déjà là — serait un
// mensonge de plus, en sens inverse.
export const MIN_ATTENTE_MS = 900;

export async function auMoins(startedAt: number, ms: number = MIN_ATTENTE_MS): Promise<void> {
  const reste = ms - (Date.now() - startedAt);
  if (reste > 0) await new Promise((resolve) => setTimeout(resolve, reste));
}
export const CONCLUSION_ANCHOR = "conclusion-echange";

// Le titre d'un tour porte déjà cet identifiant (components/result/negotiation/
// turn-card.tsx) : c'est le HAUT de la carte, pas le bas de la page.
export function turnAnchorId(turnNumber: number): string {
  return `tour-${turnNumber}`;
}

export type ThreadSnapshot = {
  turnNumbers: readonly number[];
  concluded: boolean;
  error: boolean;
};

// Ce qu'il faut amener en vue entre deux états du fil. L'erreur passe devant :
// c'est elle qui explique pourquoi rien d'autre n'est arrivé.
export function nextReveal(before: ThreadSnapshot, after: ThreadSnapshot): string | null {
  if (after.error && !before.error) return THREAD_ERROR_ID;
  const fresh = after.turnNumbers.filter((turn) => !before.turnNumbers.includes(turn));
  if (fresh.length > 0) return turnAnchorId(Math.max(...fresh));
  if (after.concluded && !before.concluded) return CONCLUSION_ANCHOR;
  return null;
}

// Ce qu'un élément doit savoir faire pour être amené en vue. Volontairement
// réduit à deux méthodes : un objet de test suffit.
export type Revealable = {
  scrollIntoView: (options: { behavior: "auto"; block: "start" }) => void;
  focus: (options: { preventScroll: boolean }) => void;
};

// Le bloc qui reçoit le repère visuel. C'est la carte entière, pas seulement
// son titre : c'est elle qu'on doit reconnaître en arrivant.
export type Flashable = { classList: { add: (...names: string[]) => void; remove: (...names: string[]) => void } };

export type Revealed = { behavior: "auto"; block: "start"; flash: "fade" | "instant" | null };

// Mission #098, défaut 4 — le repère d'arrivée. Sur plusieurs milliers de
// pixels, une animation de défilement désoriente plus qu'elle n'aide : le saut
// est instantané dans tous les cas. Ce qui manquait, c'est de savoir qu'on est
// arrivé : le bloc reçoit un contour, qui s'efface en une seconde.
export const FLASH_CLASS = "arrivee";
// Sans animation (prefers-reduced-motion), le repère s'affiche puis disparaît
// sans transition : même durée, aucun mouvement.
export const FLASH_INSTANT_CLASS = "arrivee-sans-animation";
export const FLASH_MS = 1000;

// Amène l'élément en vue par le HAUT, puis lui donne le focus : un lecteur
// d'écran annonce alors le titre de la nouvelle carte. Le focus ne défile pas
// une seconde fois (preventScroll).
export function reveal(
  target: Revealable | null,
  options: { flash?: Flashable | null; reducedMotion?: boolean } = {},
): Revealed | null {
  if (target === null) return null;
  const how = { behavior: "auto", block: "start" } as const;
  target.scrollIntoView(how);
  target.focus({ preventScroll: true });
  const flash = options.flash ?? null;
  if (flash === null) return { ...how, flash: null };
  const reduced = options.reducedMotion === true;
  const classes = reduced ? [FLASH_CLASS, FLASH_INSTANT_CLASS] : [FLASH_CLASS];
  flash.classList.add(...classes);
  // Le repère est bref : il dit « c'est ici », il ne reste pas.
  setTimeout(() => flash.classList.remove(...classes), FLASH_MS);
  return { ...how, flash: reduced ? "instant" : "fade" };
}

// « prefers-reduced-motion » du système. Hors navigateur, ou si la requête
// média n'est pas disponible, on ne suppose aucune animation.
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
