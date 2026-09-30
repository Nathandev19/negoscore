// Mission #125 — LE MESSAGE QUI A PRODUIT L'EXEMPLE CHIFFRÉ.
//
// La promesse du produit est « je lis l'offre et je la chiffre ». Sur
// /analyse/demo, le chiffre était là, l'offre non : la page affichait la
// SORTIE de l'outil (neuf points extraits dans « Le deal proposé ») sans
// jamais montrer ce qu'une créatrice reçoit vraiment. Un chiffre sans son
// entrée est une affirmation ; avec elle, c'est une démonstration.
//
// Ce texte n'est pas écrit pour l'occasion : c'est la PREMIÈRE FIXTURE
// d'évaluation du produit, evals/fixtures/01-dm-cosmetique/input.txt, celle
// dont lib/fixtures/sample-extraction.json est l'extraction. Tous ses termes
// se retrouvent dans le deal extrait : 300 €, 2 vidéos TikTok, droits pub
// 6 mois, exclusivité cosmétique 3 mois, raw footage, révisions illimitées,
// paiement à 60 jours. tests/exemple-chiffre.test.tsx compare les deux
// fichiers octet pour octet : si l'un dérive, le test échoue.
//
// LA SIGNATURE EST SÉPARÉE DU CORPS, et seul le corps est affiché.
// Le message est signé « L'équipe Aubépine Cosmétiques » alors que
// l'extraction, elle, a été anonymisée en « Marque Exemple » — nom que la
// section « Le deal proposé » affiche. Montrer les deux mettrait deux noms
// pour une même marque inventée sur le même écran. On garde donc le texte
// tel quel, mais on n'en affiche que la partie qui porte l'offre.

export const SAMPLE_OFFER = {
  body: "Bonjour ! On adore ton contenu 🌸 On te propose 300€ pour 2 vidéos TikTok, avec droits pub 6 mois, 3 mois d'exclusivité sur la catégorie cosmétique, raw footage inclus, révisions illimitées, paiement à 60 jours. Dis-nous si ça te va !",
  signature: "L'équipe Aubépine Cosmétiques",
} as const;

// Le texte d'origine, reconstitué : c'est LUI qui doit être identique à la
// fixture d'évaluation.
export const SAMPLE_OFFER_TEXT = `${SAMPLE_OFFER.body}\n${SAMPLE_OFFER.signature}`;

export const SAMPLE_OFFER_SOURCE = "evals/fixtures/01-dm-cosmetique/input.txt";
