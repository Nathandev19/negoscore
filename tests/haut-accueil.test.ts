import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Mission #163 — LES 27 px QUI MANQUAIENT AU LIEN DE L'ACCUEIL.
//
// #153 avait fait remonter le lien « Voir une analyse chiffrée, sur un
// exemple » de 73 à 93 px selon la largeur. Il en manquait 27 pour qu'il soit
// visible sans défiler à 375 × 667 — la taille d'un iPhone SE ou 8, et le
// contrôle en navigateur nu de la matrice.
//
// RELEVÉS À L'ÉTAT STABILISÉ, six lectures identiques consécutives, serveur de
// développement, bas du lien en pixels depuis le haut de l'écran :
//
//      largeur    avant    après    gain
//      320 px      732      692     −40
//      375 px      694      654     −40
//      390 px      694      654     −40
//
// À 375 × 667 le lien passe donc de 694 (27 px sous la ligne de flottaison) à
// 654, soit 13 px de marge. Les quarante px viennent de QUATRE espacements,
// tous sur mobile, et d'aucun texte : ni le titre, ni la phrase de promesse,
// ni la zone de texte n'ont bougé d'un pixel.
//
// POURQUOI UNE MARGE DE 13 px ET PAS DE 1. Avec les trois seuls espacements de
// app/page.tsx on tombait à 666 pour un écran de 667. Un pixel n'est pas une
// marge : le haut de page compte sept lignes de texte, et une police de repli
// qui rendrait chacune 1 px plus haute suffirait à tout faire repasser
// dessous. C'est l'erreur de #148, qui avait déclaré « 375 × 560 passe » sur
// un relevé pris au mauvais moment. D'où le quatrième espacement.

const ACCUEIL = readFileSync("app/page.tsx", "utf8");
const SAISIE = readFileSync("components/deal-input.tsx", "utf8");

// La section du haut de page, telle qu'elle est écrite.
const HERO = /id="analyser"[\s\S]*?className="(mx-auto grid[^"]*)"/.exec(ACCUEIL)?.[1] ?? "";

describe("le lien de l'accueil tient au-dessus de la ligne de flottaison à 375 × 667", () => {
  it("la section du haut de page garde les trois espacements resserrés", () => {
    expect(HERO, "section #analyser introuvable").not.toBe("");
    // 24 → 12 px sous un en-tête collant de 56 px.
    expect(HERO).toContain("pt-3");
    expect(HERO).not.toMatch(/\bpt-6\b/);
    // 24 → 12 px entre le message et le formulaire.
    expect(HERO).toMatch(/\bgap-3\b/);
    expect(HERO).not.toMatch(/\bgap-6\b/);
    // Au-delà de 1024 px, les valeurs d'origine s'appliquent toujours : le
    // resserrement ne concerne que les écrans où la place manque.
    expect(HERO).toContain("lg:pt-20");
    expect(HERO).toContain("lg:gap-16");
  });

  it("le titre et la phrase de promesse sont resserrés, jamais raccourcis", () => {
    // 12 → 8 px entre les deux. Le quatrième espacement du compte.
    //
    // La colonne VISÉE est celle qui contient le titre, pas une autre : le
    // fichier porte deux `flex flex-col gap-2`, et chercher la chaîne telle
    // quelle laissait passer un retour en arrière sur celui-ci. On découpe
    // donc jusqu'au <h1>, et on lit la dernière ouverture de div avant lui.
    const avantTitre = ACCUEIL.slice(ACCUEIL.indexOf('id="analyser"'), ACCUEIL.indexOf("<h1"));
    const colonneTitre = [...avantTitre.matchAll(/<div className="([^"]*)">/g)].at(-1)?.[1] ?? "";
    expect(colonneTitre, "colonne du titre introuvable").not.toBe("");
    expect(colonneTitre).toBe("flex flex-col gap-2");
    // Et les deux textes sont intacts : c'est la seule chose qu'on ne touche
    // pas pour gagner de la place.
    expect(ACCUEIL).toContain("Cette marque te propose combien");
    expect(ACCUEIL).toContain("Colle son message. On te dit ce que ça vaut vraiment");
  });

  it("le rythme du formulaire se resserre sur mobile seulement", () => {
    // 12 → 8 px entre les trois blocs : douze px, et c'est le dernier endroit
    // vide du haut de page. Au-delà de 640 px, rien ne change.
    expect(SAISIE).toContain('className="flex flex-col gap-2 sm:gap-3"');
  });

  it("la zone de texte n'est pas rognée : c'est la surface du geste", () => {
    // Le levier existait — 160 px de hauteur minimale — et il n'est pas pris.
    expect(SAISIE).toContain("min-h-40");
  });
});
