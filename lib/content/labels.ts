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
