import { formatEurRange } from "@/lib/money";
import type { Analysis } from "@/lib/schema";

// LA PAGE DE RÉSULTAT SE DÉVOILE PAR ÉTAPES.
//
// Les blocs apparaissaient tous en même temps. Ils arrivent maintenant l'un
// après l'autre, dans l'ordre où la créatrice les lit :
//
//   0. le score et le verdict
//   1. la ligne Création
//   2…n. les lignes de majoration, dans l'ordre du moteur
//   n+1. le total
//   n+2. la réponse à envoyer
//
// PUREMENT PRÉSENTATIONNEL. Aucune donnée ne change, aucun appel de plus,
// aucun état : le décalage est un `animation-delay` en CSS, et rien d'autre.
// Les valeurs affichées restent exactement celles du moteur.
//
// Mouvement réduit : la règle unique de `app/globals.css` ramène toute
// animation à 0,01 ms et tout délai à 0 ms. Tout s'affiche alors d'un coup,
// sans qu'il y ait une seule ligne à écrire ici pour ça.

// 90 ms entre deux blocs : assez pour que l'œil suive l'ordre, trop court pour
// qu'on attende. Sept étapes font 540 ms de décalage au total.
export const DEVOILE_PAS_MS = 90;

export const DEVOILE_CLASSE = "devoile";

// Le délai de la position demandée, à poser en style en ligne. La position 0
// n'en a pas besoin : la classe seule suffit, son délai valant zéro.
export function devoileDelai(position: number): { animationDelay: string } {
  return { animationDelay: `${Math.max(0, position) * DEVOILE_PAS_MS}ms` };
}

export type PlanDevoile = {
  // null : l'élément n'est pas rendu, et ne prend donc pas de place dans la
  // séquence — sinon un trou de 90 ms s'ouvrirait au milieu.
  creation: number | null;
  lignes: readonly number[];
  total: number | null;
  message: number;
};

// L'ORDRE EST CALCULÉ, PAS ÉCRIT EN DUR, et pour une raison : le détail du
// chiffrage est variable. La ligne Création n'existe que s'il y a une base, les
// majorations sont celles que le deal déclenche (un deal sans exclusivité n'a
// pas de ligne Exclusivité), et le total disparaît avec elles. Une suite
// d'indices figés laisserait des trous dès qu'une ligne manque.
//
// `estimate` à null : le bloc de chiffrage n'est pas rendu du tout (offre
// incomplète). La réponse suit alors directement le verdict.
export function planDevoile(estimate: Analysis["estimate"] | null): PlanDevoile {
  if (!estimate) return { creation: null, lignes: [], total: null, message: 1 };
  // Mêmes conditions que le rendu, lues au même endroit : une ligne compte
  // dans la séquence si et seulement si elle s'affiche.
  const creationVisible = formatEurRange(estimate.base_low, estimate.base_high) !== null;
  const totalVisible = formatEurRange(estimate.total_low, estimate.total_high) !== null;
  let position = 1;
  const creation = creationVisible ? position++ : null;
  const lignes = estimate.lines.map(() => position++);
  const total = totalVisible ? position++ : null;
  return { creation, lignes, total, message: position };
}
