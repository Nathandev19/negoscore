// Mission #168 — LA LARGEUR D'UN TEXTE, AVANT DE LE RENDRE.
//
// satori met en page, mais il ne répond pas : impossible de lui demander « est-ce
// que ça tient sur une ligne ? » puis de corriger. La taille doit donc être
// choisie AVANT le rendu, et pour ça il faut savoir ce que mesure une chaîne.
//
// LES AVANCES CI-DESSOUS SONT MESURÉES, PAS ESTIMÉES. Chaque glyphe a été rendu
// en série par next/og avec les polices embarquées (assets/fonts), le PNG
// décodé, et l'avance déduite de la différence entre une série de 5 et une
// série de 15 — ce qui élimine les approches latérales. Relevé du 09/10/2026 :
//
//   Bricolage Grotesque 800, interlettrage −0,04 em
//     « 1 » 0,270 · autres chiffres 0,554 · « € » 0,640 · « – » 0,460
//     espace et insécable 0,163
//   Familjen Grotesk 600, interlettrage 0
//     minuscules 0,503 · majuscules 0,604 · chiffres 0,567 · « · » 0,235
//
// Le modèle est VOLONTAIREMENT un peu large : il somme des avances alors que la
// mesure de contrôle est une étendue d'encre, plus courte de l'approche droite
// du dernier glyphe. Il se trompe donc du bon côté — il fait descendre d'un
// palier un peu trop tôt, jamais trop tard.
//
// tests/carte-largeur.test.ts confronte le modèle aux largeurs réellement
// mesurées : s'il dérive de plus de 5 %, le test échoue.

export type TableAvances = {
  readonly defaut: number;
  readonly espace: number;
  readonly chiffre: number;
  readonly un?: number;
  readonly minuscule: number;
  readonly majuscule: number;
  readonly euro: number;
  readonly tiret: number;
  readonly mediane: number;
};

// La fourchette : « 2 700 € – 5 280 € ». Chiffres, euro, tiret demi-cadratin,
// espaces insécables, et rien d'autre.
export const AVANCES_FOURCHETTE: TableAvances = {
  defaut: 0.5,
  espace: 0.163,
  chiffre: 0.554,
  un: 0.27,
  minuscule: 0.503,
  majuscule: 0.604,
  euro: 0.64,
  tiret: 0.46,
  mediane: 0.235,
};

// La ligne d'offre : du texte courant, en Familjen.
export const AVANCES_OFFRE: TableAvances = {
  defaut: 0.3,
  // Relevé à 0,136 par déduction sur la pire ligne d'offre ; arrondi au-dessus
  // pour rester du côté large.
  espace: 0.15,
  chiffre: 0.567,
  minuscule: 0.503,
  majuscule: 0.604,
  euro: 0.64,
  tiret: 0.46,
  mediane: 0.235,
};

const MAJUSCULES = /\p{Lu}/u;
const MINUSCULES = /\p{Ll}/u;

// Largeur d'une chaîne, en cadratins (em). À multiplier par la taille de police.
export function largeurEm(texte: string, table: TableAvances): number {
  let total = 0;
  for (const caractere of texte) {
    // Insécable (U+00A0) et fine insécable (U+202F) : le formateur de
    // montants s'en sert, et elles comptent comme des espaces. Écrites en
    // échappement, parce qu'un caractère invisible dans une comparaison est
    // une ligne que personne ne peut relire.
    if (caractere === " " || caractere === "\u00a0" || caractere === "\u202f") total += table.espace;
    else if (caractere === "€") total += table.euro;
    else if (caractere === "–" || caractere === "—" || caractere === "-") total += table.tiret;
    else if (caractere === "·") total += table.mediane;
    else if (caractere === "1" && table.un !== undefined) total += table.un;
    else if (caractere >= "0" && caractere <= "9") total += table.chiffre;
    else if (MINUSCULES.test(caractere)) total += table.minuscule;
    else if (MAJUSCULES.test(caractere)) total += table.majuscule;
    else total += table.defaut;
  }
  return total;
}

// La plus grande taille de la série qui tient dans `largeurUtile`, sur
// `lignes` lignes. La dernière de la série est rendue même si elle déborde :
// une carte plus serrée vaut mieux qu'une carte vide.
//
// `rendement` : une mise en page gourmande ne remplit jamais la dernière ligne
// jusqu'au bord. Sur deux lignes on ne compte donc que 92 % de la place.
export function tailleQuiTient(
  texte: string,
  table: TableAvances,
  series: readonly number[],
  largeurUtile: number,
  lignes = 1,
  rendement = 1,
): number {
  const em = largeurEm(texte, table);
  const place = largeurUtile * lignes * rendement;
  return series.find((taille) => em * taille <= place) ?? series[series.length - 1];
}
