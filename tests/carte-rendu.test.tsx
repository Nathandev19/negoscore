import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ImageResponse } from "next/og";
import { loadFonts } from "@/lib/share-card/render";
import {
  CARTE_MARGE,
  VERDICT_CARD_SIZE,
  tailleFourchette,
  verdictCardElement,
  verdictCardTexts,
} from "@/lib/share-card/verdict-card";
import type { VerdictCardData } from "@/lib/share-card/verdict-card";
import { bandWithinRange, RATIO_ZERO } from "@/lib/rates/score";
import { carteDepuisChiffrage, type LigneOffre } from "@/lib/share-card/verdict-data";
import type { Pricing } from "@/lib/negotiation/types";

import { decodePng, inkBounds, rowBands } from "./helpers/png";

// Mission #168 — LES CINQ CARTES, RENDUES ET MESURÉES.
//
// Les tests de texte disent ce que la carte CONTIENT. Ils ne disent pas si
// elle tient dans ses marges : en #165 la carte débordait, et c'est en la
// regardant qu'on l'a vu, pas en la relisant. Ici l'image est décodée et
// mesurée — pied de page entier, fourchette sur une ligne, rien dans les 60
// derniers pixels — pour les cinq cas du rapport.
//
// Les PNG sont écrits dans `cartes-rendues/`, ignoré par git : ce sont des
// pièces à regarder, pas des fichiers à versionner.
const DOSSIER = "cartes-rendues";
const BLEU: [number, number, number] = [0x1f, 0x3c, 0xff];
const CREME: [number, number, number] = [0xff, 0xf7, 0xe8];
const BANDE = 420;

// Mission #170 — LES CINQ CAS SONT CONSTRUITS COMME LE MOTEUR LES ÉCRIT.
//
// Ils étaient écrits à la main, bande comprise. La carte 5 portait ainsi
// « Mauvais » pour 89 € face à un plancher de 220 € — alors que le seuil du
// « mauvais » est 0,4 x 220 = 88, et que 89 est au-dessus. Le rendu montrait
// une carte que le produit ne peut pas produire : exactement ce qu'on
// s'interdit.
//
// Chaque cas part donc d'un CHIFFRAGE, comme un tour enregistré, et sa bande
// est calculée par bandWithinRange — la fonction même du moteur. Une bande ne
// peut plus être tapée au clavier, et le test « chaque carte porte la bande
// que ses chiffres imposent » le vérifie pour les cinq.
const LIGNE: LigneOffre = {
  livrables: [{ type: "video", quantity: 3 }],
  droitsMois: 6,
  droitsAVie: false,
  exclusivite: true,
  exclusiviteMois: 3,
  zones: ["france", "europe_francophone", "amerique_nord"],
};

type Cas = {
  nom: string;
  /** La note du moteur sur ces termes. */
  score: number;
  /** Le montant comparé, celui qui s'affiche. */
  compared: number;
  bas: number;
  haut: number;
  ceiling?: boolean;
  ligne?: Partial<LigneOffre>;
};

function carteDe({ score, compared, bas, haut, ceiling = false, ligne }: Cas): VerdictCardData {
  const pricing: Pricing = {
    total_low: bas,
    total_high: haut,
    counter_low: null,
    counter_high: null,
    rate_table_version: "fr-2026.4",
    tier: "confirmed",
    score,
    // LA BANDE N'EST PAS CHOISIE : elle est calculée, par le code du moteur.
    band: bandWithinRange(score, compared, bas),
    compared,
    ceiling,
  };
  return carteDepuisChiffrage(pricing, { ...LIGNE, ...ligne });
}

const CAS: Cas[] = [
  // Sous le plancher : 400 € face à 610 €. Le seuil du « mauvais » est à 244.
  { nom: "1-sous-evalue", score: 58, compared: 400, bas: 610, haut: 1310 },
  // Dans la fourchette.
  { nom: "2-correct", score: 62, compared: 900, bas: 610, haut: 1310 },
  // Au-dessus du haut.
  { nom: "3-sur-evalue", score: 88, compared: 1800, bas: 610, haut: 1310 },
  // Le pire cas : fourchette large, quatre zones, trois types de contenus,
  // et un montant annoncé « jusqu'à … à confirmer ».
  {
    nom: "4-pire-cas",
    score: 62,
    compared: 2900,
    bas: 2700,
    haut: 5280,
    ceiling: true,
    ligne: {
      livrables: [
        { type: "video", quantity: 3 },
        { type: "photo", quantity: 12 },
        { type: "story", quantity: 4 },
      ],
      droitsMois: null,
      droitsAVie: true,
      zones: ["france", "europe_francophone", "europe", "amerique_nord"],
    },
  },
  // Le cas minimal : une vidéo, payée en produits, une seule zone. 89 € face
  // à un plancher de 220 € : au-dessus du seuil du « mauvais » (88), donc
  // « Faible ».
  {
    nom: "5-minimal",
    score: 34,
    compared: 89,
    bas: 220,
    haut: 480,
    ligne: { livrables: [{ type: "video", quantity: 1 }], droitsMois: null, exclusivite: false, exclusiviteMois: null, zones: ["france"] },
  },
];

const RENDUS = CAS.map((cas) => ({ nom: cas.nom, cas, data: carteDe(cas) }));


describe("les cinq cartes rendues tiennent dans leurs marges", () => {
  it.each(RENDUS)("$nom", async ({ nom, data }) => {
    mkdirSync(DOSSIER, { recursive: true });
    const reponse = new ImageResponse(verdictCardElement(data), { ...VERDICT_CARD_SIZE, fonts: await loadFonts() });
    const octets = Buffer.from(await reponse.arrayBuffer());
    writeFileSync(`${DOSSIER}/carte-${nom}.png`, octets);
    const image = decodePng(octets);
    expect(image.width).toBe(1080);
    expect(image.height).toBe(1350);

    // 1. RIEN DANS LES 60 DERNIERS PIXELS.
    expect(inkBounds(image, BLEU, 14, { x0: 0, y0: 1290, x1: 1080, y1: 1350 }), `${nom} : encre dans les 60 derniers px`).toBe(
      null,
    );

    // 2. LE PIED DE PAGE EST ENTIER : de l'encre juste au-dessus, et elle
    //    commence bien à la marge de gauche.
    const pied = inkBounds(image, BLEU, 14, { x0: 0, y0: 1200, x1: 1080, y1: 1290 });
    if (!pied) throw new Error(`${nom} : pas de pied de page`);
    expect(pied.minX, `${nom} : pied hors marge gauche`).toBeGreaterThanOrEqual(CARTE_MARGE - 2);
    expect(pied.maxX, `${nom} : pied hors marge droite`).toBeLessThanOrEqual(1080 - CARTE_MARGE + 2);

    // 3. LA FOURCHETTE EST SUR UNE SEULE LIGNE. Dans le champ bleu, les
    //    bandes d'encre se comptent : « Ça en vaut » puis la fourchette. Si
    //    elle passait sur deux lignes, sa bande ferait deux fois sa hauteur.
    const taille = tailleFourchette(verdictCardTexts(data).vaut ?? "");
    const bandes = rowBands(image, BLEU, 14, { x0: 0, y0: BANDE + 20, x1: 1080, y1: 1100 });
    expect(bandes.length, `${nom} : champ bleu vide`).toBeGreaterThanOrEqual(2);
    const fourchette = bandes[1];
    expect(fourchette.hauteur, `${nom} : fourchette sur deux lignes (${fourchette.hauteur} px pour ${taille} px de police)`)
      .toBeLessThan(taille * 1.2);

    // 4. TOUT RESTE DANS LES MARGES, en haut comme en bas.
    const creme = inkBounds(image, CREME, 14, { x0: 0, y0: 0, x1: 1080, y1: BANDE });
    if (!creme) throw new Error(`${nom} : bande haute vide`);
    expect(creme.minX, `${nom} : bande haute hors marge`).toBeGreaterThanOrEqual(CARTE_MARGE - 2);
    expect(creme.maxX, `${nom} : bande haute hors marge`).toBeLessThanOrEqual(1080 - CARTE_MARGE + 2);
    const bleu = inkBounds(image, BLEU, 14, { x0: 0, y0: BANDE + 20, x1: 1080, y1: 1350 });
    if (!bleu) throw new Error(`${nom} : champ bleu vide`);
    expect(bleu.minX, `${nom} : champ bleu hors marge`).toBeGreaterThanOrEqual(CARTE_MARGE - 2);
    expect(bleu.maxX, `${nom} : champ bleu hors marge`).toBeLessThanOrEqual(1080 - CARTE_MARGE + 2);

    // 5. LE GROUPE EST CENTRÉ, le pied ancré en bas. Avant la #170, le
    //    contenu commençait en haut du champ bleu et il restait environ
    //    260 px de bleu vide au milieu. On mesure les deux vides : celui
    //    au-dessus du groupe et celui entre le groupe et le pied. Ils
    //    doivent être du même ordre.
    const contenu = bandes.filter((b) => b.y1 < pied.minY - 10);
    expect(contenu.length, `${nom} : champ bleu vide`).toBeGreaterThanOrEqual(3);
    const videHaut = contenu[0].y0 - BANDE;
    const videBas = pied.minY - contenu[contenu.length - 1].y1;
    expect(
      Math.abs(videHaut - videBas),
      `${nom} : vides déséquilibrés — ${videHaut} px au-dessus, ${videBas} px en dessous`,
      // Mesuré le 09/10 : 4 px d'écart au pire sur les cinq. La marge
      // tient compte de l'encre des glyphes (jambages, accents), pas d'un
      // déséquilibre de mise en page.
    ).toBeLessThan(30);

    console.log(
      `${nom} :: fourchette ${taille} px, vides ${videHaut}/${videBas} px, pied ${pied.minY}–${pied.maxY}`,
    );
  }, 60000);
});

describe("ce que les cinq cartes disent est ce que les chiffres imposent", () => {
  // Mission #170 — la carte 5 portait « Mauvais » pour 89 € face à un
  // plancher de 220 €, alors que le seuil du « mauvais » est 0,4 x 220 = 88.
  // La bande était tapée à la main dans la fixture : le rendu montrait une
  // carte que le produit ne peut pas produire.
  it.each(RENDUS)("$nom : la bande est celle que bandWithinRange impose", ({ cas, data }) => {
    expect(data.bande).toBe(bandWithinRange(cas.score, cas.compared, cas.bas));
    // Et c'est bien le montant AFFICHÉ qui a été comparé.
    expect(data.propose).toBe(cas.compared);
  });

  it("le seuil du « mauvais » est 0,4 x le plancher, et il est strict", () => {
    // Les deux premiers euros de chaque côté, sur le plancher de la carte 5.
    const plancher = 220;
    expect(RATIO_ZERO * plancher).toBe(88);
    expect(bandWithinRange(34, 87, plancher)).toBe("bad");
    expect(bandWithinRange(34, 88, plancher)).toBe("weak");
    expect(bandWithinRange(34, 89, plancher)).toBe("weak");
    // Et le plancher lui-même : dedans, c'est la note qui parle.
    expect(bandWithinRange(34, 219, plancher)).toBe("weak");
    expect(bandWithinRange(62, 219, plancher)).toBe("weak");
    expect(bandWithinRange(62, 220, plancher)).toBe("fair");
    expect(bandWithinRange(34, 220, plancher)).toBe("weak");
  });

  it("la carte 5 dit « Faible », pas « Mauvais »", () => {
    const cinq = RENDUS.find((r) => r.nom === "5-minimal")!;
    expect(cinq.cas.compared).toBe(89);
    expect(cinq.cas.bas).toBe(220);
    expect(cinq.data.bande).toBe("weak");
    expect(verdictCardTexts(cinq.data).verdict).toBe("Faible");
  });

  it("AUCUNE carte ne porte le niveau de calcul", () => {
    // Mission #170, point 1 — il est écrit à la première personne. Sur une
    // image publique, c'est une information sur la créatrice, pas sur le
    // deal. La #039 reste en vigueur sur la page de résultat.
    for (const { nom, data } of RENDUS) {
      const textes = Object.values(verdictCardTexts(data)).join(" | ");
      for (const niveau of ["Je débute", "Déjà des collabs payées", "C'est mon métier", "Niveau"]) {
        expect(textes, `${nom} / ${niveau}`).not.toContain(niveau);
      }
    }
  });
});

describe("une seule identité visuelle, quel que soit le verdict", () => {
  // La règle de la mission, et c'est celle qui fait qu'on poste la carte : le
  // champ bleu NE CHANGE JAMAIS de couleur selon le verdict. C'est la
  // pastille qui porte l'état. Un fond qui vire au rouge quand l'offre est
  // mauvaise, c'est une carte qu'on garde pour soi.
  it("le champ bleu est le même pour les cinq bandes, et seule la pastille change", async () => {
    const fonts = await loadFonts();
    const pixels = new Set<string>();
    const pastilles = new Set<string>();
    for (const bande of ["bad", "weak", "fair", "good", "excellent"] as const) {
      // Ici la bande est forcée EXPRÈS : c'est la couleur qu'on vérifie,
      // pas la cohérence des chiffres (celle-là a son propre test).
      const reponse = new ImageResponse(verdictCardElement({ ...RENDUS[0].data, bande }), { ...VERDICT_CARD_SIZE, fonts });
      const image = decodePng(Buffer.from(await reponse.arrayBuffer()));
      // Un point du champ bleu loin de tout texte : sous le pied de page, à
      // droite.
      const i = (1320 * image.width + 1000) * image.channels;
      pixels.add(`${image.data[i]},${image.data[i + 1]},${image.data[i + 2]}`);
      // Un point dans la pastille : juste à droite de la marge, à sa hauteur.
      const bornes = rowBands(image, BLEU, 14, { x0: 0, y0: BANDE + 20, x1: 1080, y1: 1100 })[2];
      const j = (Math.round((bornes.y0 + bornes.y1) / 2) * image.width + CARTE_MARGE + 10) * image.channels;
      pastilles.add(`${image.data[j]},${image.data[j + 1]},${image.data[j + 2]}`);
    }
    expect(pixels.size, `le fond a pris ${pixels.size} couleurs : ${[...pixels].join(" / ")}`).toBe(1);
    expect([...pixels][0]).toBe(`${BLEU[0]},${BLEU[1]},${BLEU[2]}`);
    // Et la pastille, elle, en prend bien cinq différentes.
    expect(pastilles.size, `pastilles : ${[...pastilles].join(" / ")}`).toBe(5);
  }, 120000);
});
