// Mission #104, A3 — les libellés d'un CONCEPT du produit, partagés par le
// moteur de chiffrage et par l'écran. Un concept, un nom, en français.
//
// Pourquoi un fichier à part de lib/content/vocabulaire.ts : le vocabulaire
// importe les formules et leurs quantités (lib/billing/plans.ts), et le
// composant de résultat a l'interdiction d'entraîner la facturation dans son
// graphe d'imports (garde de la mission #039, tests/tier.test.ts). Ce module
// est une feuille : il n'importe rien. Le vocabulaire le ré-exporte, pour
// qu'il reste la seule porte d'entrée quand on cherche un mot du produit.

// « Raw footage » s'affichait dans la décomposition du prix pendant que le
// reste du produit disait « rushs bruts » : un concept, deux noms, dont un en
// anglais, dans un produit francophone. L'orthographe retenue est celle déjà
// employée partout ailleurs — les guides, l'accueil, la consigne du modèle.
export const RAW_FOOTAGE_LABEL = "Rushs bruts";

// Mission #109, A — où se situe le montant DANS la fourchette, et pas seulement
// qu'il y est.
//
// Ce que disait l'écran sur le cas de référence (1 vidéo TikTok + pub 12 mois,
// 250 € proposés, fourchette 180 – 400 €) : « C'est dans les prix pour ces
// droits », au-dessus d'une contre-offre à 325 – 400 €. Les deux phrases se
// contredisaient : 250 € est au tiers bas de la fourchette, et l'outil demandait
// justement de monter. La phrase mesure désormais ce que le score mesurait déjà
// (pricePoints) et que personne ne disait.
export type WithinRange = "bottom" | "middle" | "top";

export const WITHIN_RANGE_SENTENCE: Record<WithinRange, string> = {
  bottom: "C'est dans les prix, mais tout en bas de la fourchette.",
  middle: "C'est dans les prix.",
  top: "C'est dans le haut de la fourchette.",
};

// Mission #109, C — l'offre est sous le plancher : l'écran donne la valeur du
// lot ET un point de départ, sans décider à la place du créateur.
export const COUNTER_FIRST_STEP_TITLE = "Si tu ne veux pas tout demander d'un coup";

export function counterFirstStepSentence(step: string, full: string): string {
  return `Commence à ${step} : c'est le bas de la fourchette, déjà au-dessus de ce que la marque propose. La fourchette complète, ${full}, est ce que ces droits valent — c'est toi qui choisis jusqu'où tu montes.`;
}


// Mission #181 — COMBIEN D'ANALYSES CETTE PERSONNE A, dit sobrement en tête
// de sa liste.
//
// Le vocabulaire est contraint. Les missions #174 à #178 ont retiré de tout
// écran de créatrice la note sur 100 et les mots qui la nommaient : « score »
// et « note » ne doivent pas reparaître ici (lib/content/vocabulaire.ts,
// bloc de décision de la #176, et tests/note-contre-bande.test.tsx). Le
// compteur ne compte donc pas des notes : il compte des ANALYSES, ce qui est
// exactement ce que la liste contient.
//
// Zéro se dit « Aucune analyse », jamais « 0 analyse » : un chiffre nu au
// singulier devant un pluriel approximatif est la faute que cette fonction
// existe pour éviter. Un seul élément se dit au singulier.
export function analysesCount(total: number): string {
  if (total <= 0) return "Aucune analyse enregistrée pour l'instant.";
  return total === 1 ? "1 analyse enregistrée." : `${total} analyses enregistrées.`;
}

// La liste s'arrête à 100 lignes. Au-delà, le compteur dit la vérité — le
// nombre réel — et cette phrase dit pourquoi la liste est plus courte que
// lui. Sans elle, l'écran afficherait deux nombres qui se contredisent.
export function analysesCountTruncated(total: number, shown: number): string {
  return `${analysesCount(total)} Les ${shown} plus récentes sont listées.`;
}
