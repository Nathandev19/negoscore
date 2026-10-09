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

const base: VerdictCardData = {
  propose: 400,
  produits: null,
  bas: 610,
  haut: 1310,
  bande: "weak",
  livrables: [{ type: "video", quantity: 3 }],
  droitsMois: 6,
  droitsAVie: false,
  exclusivite: true,
  exclusiviteMois: 3,
  zones: ["france", "europe_francophone", "amerique_nord"],
  bareme: "fr-2026.4",
  niveau: "starter",
  plafond: false,
};

const CAS: Array<{ nom: string; data: VerdictCardData }> = [
  { nom: "1-sous-evalue", data: base },
  { nom: "2-correct", data: { ...base, propose: 900, bande: "fair" } },
  { nom: "3-sur-evalue", data: { ...base, propose: 1800, bande: "excellent" } },
  {
    nom: "4-pire-cas",
    data: {
      ...base,
      propose: 2900,
      bas: 2700,
      haut: 5280,
      bande: "fair",
      plafond: true,
      livrables: [
        { type: "video", quantity: 3 },
        { type: "photo", quantity: 12 },
        { type: "story", quantity: 4 },
      ],
      droitsMois: null,
      droitsAVie: true,
      zones: ["france", "europe_francophone", "europe", "amerique_nord"],
      niveau: "experienced",
    },
  },
  {
    nom: "5-minimal",
    data: {
      ...base,
      propose: null,
      produits: 89,
      bas: 220,
      haut: 480,
      bande: "bad",
      livrables: [{ type: "video", quantity: 1 }],
      droitsMois: null,
      exclusivite: false,
      exclusiviteMois: null,
      zones: ["france"],
      niveau: "confirmed",
    },
  },
];

describe("les cinq cartes rendues tiennent dans leurs marges", () => {
  it.each(CAS)("$nom", async ({ nom, data }) => {
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

    console.log(
      `${nom} :: fourchette ${taille} px, bande ${fourchette.y0}–${fourchette.y1} (${fourchette.hauteur} px), pied ${pied.minY}–${pied.maxY}`,
    );
  }, 60000);
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
      const reponse = new ImageResponse(verdictCardElement({ ...base, bande }), { ...VERDICT_CARD_SIZE, fonts });
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
