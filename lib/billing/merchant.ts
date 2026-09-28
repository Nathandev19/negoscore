// Mission #122 — qui vend, et sous quel nom le prélèvement apparaît.
//
// Réglage du compte Whop lu le 28/09 : Paramètres > Impôt affiche « Collecte de
// taxes : Whop collecte et remet » et « Type de taxe : Inclusif ». Whop est donc
// REVENDEUR (merchant of record) : il conclut la vente en son nom au client
// final, émet le reçu, collecte et reverse la taxe selon le pays de l'acheteur.
// L'éditeur (lib/legal/identity.ts) fournit le service acheté ; il ne vend pas
// au consommateur.
//
// Le libellé du relevé bancaire est écrit ICI et pas dans les pages, bien qu'il
// contienne le nom de la marque : ce n'est PAS de la copie, c'est une chaîne
// fixée dans le compte Whop. La dériver de BRAND.name serait un faux lien —
// renommer la marque ne renommerait pas le libellé chez Whop, il faudrait aller
// l'y changer à la main. Une constante, donc, à corriger le jour où ce réglage
// change.
export const MERCHANT = {
  name: "Whop",
  legalName: "Whop Inc.",
  statementDescriptor: "WHOP NEGOSCORE",
} as const;
