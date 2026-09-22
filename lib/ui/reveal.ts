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
  scrollIntoView: (options: { behavior: "smooth" | "auto"; block: "start" }) => void;
  focus: (options: { preventScroll: boolean }) => void;
};

export type Revealed = { behavior: "smooth" | "auto"; block: "start" };

// Amène l'élément en vue par le HAUT, puis lui donne le focus : un lecteur
// d'écran annonce alors le titre de la nouvelle carte. Le focus ne défile pas
// une seconde fois (preventScroll) ; l'animation est coupée quand la personne
// a demandé moins de mouvement.
export function reveal(target: Revealable | null, reducedMotion: boolean): Revealed | null {
  if (target === null) return null;
  const how: Revealed = { behavior: reducedMotion ? "auto" : "smooth", block: "start" };
  target.scrollIntoView(how);
  target.focus({ preventScroll: true });
  return how;
}

// « prefers-reduced-motion » du système. Hors navigateur, ou si la requête
// média n'est pas disponible, on ne suppose aucune animation.
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
