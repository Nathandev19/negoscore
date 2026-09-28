// Mission #122, corrigée par #123 — qui vend, et jusqu'où va le rôle de Whop.
//
// Sources : whop.com/seller-terms et whop.com/buyer-terms, lues le 28/09.
//   « Whop acts as merchant of record for the purpose of card network rules and
//     payment settlement ONLY »
//   « you will be identified to the Buyer as the SUPPLIER on the receipt and at
//     checkout »
//   « You are the supplier of the Products for all other purposes, including
//     for value-added tax, sales tax »
// S'y ajoute le mode optionnel où Whop est merchant of record pour la TAXE DE
// TRANSACTION, dans lequel ce compte est réglé (Paramètres > Impôt : « Whop
// collecte et remet », « Type de taxe : Inclusif »).
//
// Donc, en une phrase : LE VENDEUR EST L'ÉDITEUR (lib/legal/identity.ts). Whop
// opère le règlement par carte et la taxe de transaction, et rien d'autre. La
// mission #122 avait écrit que Whop concluait la vente ; c'était faux, et c'est
// corrigé partout.
//
// AUCUN NOM D'ENTITÉ JURIDIQUE ICI, et aucun dans les pages publiques :
// l'entité qui contracte change selon la région de l'acheteur (Whop, Inc.,
// Whop Canada Inc., Whop UK, Whop (EU)). Écrire « Whop, Inc. » à une acheteuse
// européenne serait faux. « Whop » tout court reste vrai pour tout le monde.
//
// Le libellé du relevé bancaire est écrit ici bien qu'il contienne le nom de la
// marque : ce n'est PAS de la copie, c'est une chaîne fixée dans le compte Whop.
// La dériver de BRAND.name serait un faux lien — renommer la marque ne
// renommerait pas le libellé chez Whop. Valeur VÉRIFIÉE : lue par Nathan sur
// son propre relevé bancaire après l'achat réel du 24/09.
export const MERCHANT = {
  name: "Whop",
  statementDescriptor: "WHOP NEGOSCORE",
} as const;
