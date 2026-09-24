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
