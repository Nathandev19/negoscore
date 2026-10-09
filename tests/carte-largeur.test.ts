import { describe, expect, it } from "vitest";
import { AVANCES_FOURCHETTE, AVANCES_OFFRE, largeurEm, tailleQuiTient } from "@/lib/share-card/mesure-texte";
import { TAILLES_FOURCHETTE, TAILLES_OFFRE, CARTE_MARGE, VERDICT_CARD_SIZE, tailleFourchette, tailleOffre } from "@/lib/share-card/verdict-card";

// Mission #168 — LE MODÈLE DE LARGEUR, CONFRONTÉ AUX MESURES.
//
// satori ne répond pas : la taille de la fourchette doit être choisie avant le
// rendu. Le modèle (lib/share-card/mesure-texte.ts) somme des avances relevées
// glyphe par glyphe sur des rendus réels. Ce fichier le confronte aux largeurs
// mesurées ce jour-là : s'il dérive, la fourchette passera sur deux lignes sans
// que personne ne s'en aperçoive avant de regarder une carte.

const LARGEUR_UTILE = VERDICT_CARD_SIZE.width - 2 * CARTE_MARGE;

// Largeurs relevées le 09/10/2026 par rendu next/og puis décodage du PNG
// (étendue d'encre, police embarquée, interlettrage de la carte). En em.
const MESURES: Array<{ texte: string; em: number }> = [
  { texte: "2 700 € – 5 280 €", em: 6.98 },
  { texte: "12 700 € – 155 280 €", em: 8.05 },
];

describe("le modèle de largeur colle à ce qui a été mesuré", () => {
  it.each(MESURES)("« $texte » : le modèle ne dérive pas de plus de 5 %", ({ texte, em }) => {
    const estime = largeurEm(texte, AVANCES_FOURCHETTE);
    expect(Math.abs(estime - em) / em, `estimé ${estime.toFixed(2)} em, mesuré ${em} em`).toBeLessThan(0.05);
  });

  it("le modèle se trompe du côté large, jamais du côté serré", () => {
    // Il somme des avances quand la mesure est une étendue d'encre, plus
    // courte de l'approche droite du dernier glyphe. Il doit donc majorer :
    // c'est ce qui garantit qu'il descend d'un palier trop tôt, jamais trop
    // tard.
    for (const { texte, em } of MESURES) {
      expect(largeurEm(texte, AVANCES_FOURCHETTE), texte).toBeGreaterThan(em * 0.99);
    }
  });

  it("la pire ligne d'offre est estimée à sa largeur mesurée", () => {
    // 141 caractères, mesurés à 58,77 em en Familjen 600.
    const pire =
      "3 vidéos · 12 photos · 4 stories · droits pub à vie · exclusivité 3 mois · France · Europe francophone · Reste de l'Europe · Amérique du Nord";
    expect(pire).toHaveLength(141);
    const estime = largeurEm(pire, AVANCES_OFFRE);
    expect(Math.abs(estime - 58.77) / 58.77, `estimé ${estime.toFixed(2)} em`).toBeLessThan(0.05);
  });
});

describe("la fourchette ne passe jamais sur deux lignes", () => {
  // Des fourchettes réalistes, de la plus courte à une que le moteur ne
  // produira sans doute jamais.
  const CAS = [
    "90 € – 180 €",
    "610 € – 1 310 €",
    "2 700 € – 5 280 €",
    "12 700 € – 155 280 €",
    "999 999 € – 1 999 999 €",
  ];

  it.each(CAS)("« %s » tient dans les 900 px utiles", (texte) => {
    const taille = tailleFourchette(texte);
    expect(TAILLES_FOURCHETTE as readonly number[]).toContain(taille);
    expect(largeurEm(texte, AVANCES_FOURCHETTE) * taille).toBeLessThanOrEqual(LARGEUR_UTILE);
  });

  it("la taille descend par paliers, et seulement quand il le faut", () => {
    // Le cas courant garde la plus grande taille : la fourchette est le sujet
    // de la carte, on ne la rétrécit pas par précaution.
    expect(tailleFourchette("610 € – 1 310 €")).toBe(150);
    // La plus large descend, d'un palier à la fois.
    expect(tailleFourchette("2 700 € – 5 280 €")).toBeLessThan(150);
    expect(tailleFourchette("12 700 € – 155 280 €")).toBeLessThan(
      tailleFourchette("2 700 € – 5 280 €"),
    );
    // Même au plus bas, elle reste l'élément dominant : le montant proposé
    // est à 90 px, et la fourchette ne descend jamais en dessous.
    expect(Math.min(...TAILLES_FOURCHETTE)).toBeGreaterThanOrEqual(90);
  });

  it("une fourchette absurde est rendue quand même, au plus petit palier", () => {
    // Une carte serrée vaut mieux qu'une carte vide : on ne refuse jamais de
    // rendre. Le dernier palier est le filet.
    expect(tailleFourchette("1".repeat(200))).toBe(TAILLES_FOURCHETTE[TAILLES_FOURCHETTE.length - 1]);
  });
});

describe("la ligne d'offre tient sur deux lignes, sans rien perdre", () => {
  it("la pire ligne d'offre tient sur deux lignes", () => {
    const pire =
      "3 vidéos · 12 photos · 4 stories · droits pub à vie · exclusivité 3 mois · France · Europe francophone · Reste de l'Europe · Amérique du Nord";
    const taille = tailleOffre(pire);
    expect(TAILLES_OFFRE as readonly number[]).toContain(taille);
    // 92 % de deux lignes : une mise en page gourmande ne remplit jamais la
    // dernière ligne jusqu'au bord.
    expect(largeurEm(pire, AVANCES_OFFRE) * taille).toBeLessThanOrEqual(LARGEUR_UTILE * 2 * 0.92);
    // Et c'est la PLUS GRANDE qui tient, pas la plus petite de la série : on
    // ne rétrécit pas par précaution, la ligne d'offre est déjà le dernier
    // niveau de lecture de la carte.
    const index = TAILLES_OFFRE.indexOf(taille as never);
    if (index > 0) {
      expect(largeurEm(pire, AVANCES_OFFRE) * TAILLES_OFFRE[index - 1]).toBeGreaterThan(LARGEUR_UTILE * 2 * 0.92);
    }
  });

  it("une ligne courte garde la grande taille", () => {
    expect(tailleOffre("3 vidéos · France")).toBe(34);
  });

  it("aucun élément n'est retiré pour faire tenir la ligne", () => {
    // C'est la TAILLE qui descend, jamais le contenu : retirer une zone
    // ferait mentir la carte par omission, ce que la #167 vient de corriger.
    // La fonction de taille ne touche pas au texte — elle n'en reçoit qu'une
    // copie et ne rend qu'un nombre.
    const pire = "3 vidéos · 12 photos · 4 stories · droits pub à vie · France · Europe francophone · Amérique du Nord";
    expect(typeof tailleOffre(pire)).toBe("number");
    expect(tailleQuiTient(pire, AVANCES_OFFRE, TAILLES_OFFRE, LARGEUR_UTILE, 2, 0.92)).toBe(tailleOffre(pire));
  });
});
