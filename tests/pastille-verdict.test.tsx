import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ScoreBand, VerdictPill } from "@/components/result/score-band";
import { PREVIEW_STATES, previewAnalysis } from "@/lib/fixtures/preview-states";
import { BAND_LABEL } from "@/lib/display";

// Mission #174 — CE FICHIER S'APPELAIT gauge.test.tsx.
//
// La jauge, le compteur sur 100 et leur animation ont été retirés de
// l'affichage : leurs tests n'ont plus de sujet et sont partis avec eux.
// Ceux de la PASTILLE en ont toujours un — elle reste le verdict visible —
// et ils sont repris ici au mot près, mesures de #150 et #163 comprises.
//
// S'y ajoute la garde de la #174 : la note sur 100 ne doit plus apparaître
// nulle part dans ce que la page rend.
describe("la pastille de verdict ne bascule plus à la ligne", () => {
  const SOURCE = readFileSync("components/result/score-band.tsx", "utf8");
  // La ligne qui porte le score et la pastille, telle qu'écrite dans le composant.
  const LIGNE = /<div className="(flex flex-wrap items-end[^"]*)">/.exec(SOURCE)?.[1] ?? "";

  it("elle cesse de s'enrouler dès 360 px, et le reste en dessous", () => {
    expect(LIGNE, "ligne score + pastille introuvable").not.toBe("");
    // Le garde-fou : sans cette variante, la pastille peut repasser à la ligne.
    expect(LIGNE).toContain("min-[360px]:flex-nowrap");
    // Sous 360 px, l'enroulement reste la seule issue — et il est stable,
    // puisque la largeur ne change plus pendant l'animation.
    expect(LIGNE).toContain("flex-wrap");
  });

  // Mission #163 — ET LA BANDE 360–373 px, QUE #150 AVAIT ASSUMÉE.
  //
  // La ligne ne s'enroulait plus, mais la PASTILLE se comprimait et c'était
  // son libellé qui passait sur deux lignes. Ouvert et mesuré à l'état
  // stabilisé, cinq relevés identiques, sur /dev/resultat?etat=debloque :
  //
  //      largeur   place pour la pastille   nécessaire   hauteur
  //      360 px            105 px             117 px      68 px  ← deux lignes
  //      365 px            110 px             117 px      68 px  ← deux lignes
  //      373 px            116 px             117 px      68 px  ← deux lignes
  //      374 px            117 px             117 px      40 px     une ligne
  //
  // Douze px manquaient à 360 px. Le compteur n'en a aucun à céder : il est
  // déjà à sa largeur minimale de contenu (207 px à toutes les largeurs). Ils
  // sont donc pris sur du vide, et seulement sous 374 px : 8 px sur l'écart et
  // 8 px sur les côtés de la pastille. Seize rendus pour douze nécessaires.
  //
  // Après : 109 px de large, 40 px de haut — une ligne — à 360, 365 et 373 px.
  it("entre 360 et 373 px, le libellé de la pastille ne passe plus sur deux lignes", () => {
    // Mission #174 — la pastille portait `mb-3` pour poser sa ligne de base
    // sur celle du grand nombre. Le nombre est parti, ces 12 px avec lui.
    const PASTILLE = /className={cn\("(headline rounded-pill[^"]*)"/.exec(SOURCE)?.[1] ?? "";
    expect(PASTILLE).not.toContain("mb-3");
    expect(PASTILLE, "pastille introuvable").not.toBe("");
    // Les deux seuls gestes, et ils sont bornés à la bande défaillante.
    expect(LIGNE).toContain("max-[374px]:gap-x-2");
    expect(PASTILLE).toContain("max-[374px]:px-3");
    // Au-dessus de 374 px, rien ne change : la pastille garde px-4.
    expect(PASTILLE).toContain("px-4");
    // Et sa taille de texte ne bouge JAMAIS : c'est le verdict, on ne le
    // rétrécit pas pour faire entrer la mise en page.
    expect(PASTILLE).toContain("text-lg");
    expect(PASTILLE).toContain("sm:text-xl");
  });

  it("l'écart horizontal reste assez serré pour que la pastille tienne à 375 px", () => {
    // Mesuré : à 375 px il ne restait que 3 px de marge. Avec l'écart d'origine
    // (20 px) il en manquait 1, et la pastille se comprimait sur deux lignes.
    const ecart = /gap-x-(\d+)/.exec(LIGNE)?.[1];
    expect(ecart, `écart introuvable dans « ${LIGNE} »`).toBeDefined();
    expect(Number(ecart)).toBeLessThanOrEqual(4);
    // Au-delà de 640 px la place n'a jamais manqué : l'écart d'origine y reste.
    expect(LIGNE).toContain("sm:gap-x-5");
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("la note sur 100 n'est affichée nulle part", () => {
  // Mission #174 — retirée POUR TOUS LES DEALS, pas seulement ceux où elle
  // contredisait la bande : un affichage conditionnel ferait changer la page
  // de forme sans raison visible pour la lectrice.
  //
  // Elle continue d'être calculée et enregistrée. Ce test porte sur ce qui
  // est RENDU, rien d'autre.
  it.each(PREVIEW_STATES)("état « %s » : ni nombre, ni « /100 », ni jauge", (etat) => {
    const { analysis } = previewAnalysis(etat);
    const html = renderToStaticMarkup(<ScoreBand analysis={analysis} showTier />);
    expect(html).not.toContain("/100");
    expect(html).not.toContain("sur 100");
    expect(html).not.toContain("score-count");
    expect(html).not.toContain("data-gauge");
    // Et la note elle-même, si l'analyse en porte une, n'est pas écrite.
    const note = analysis.score?.value;
    if (note !== undefined && note > 9) expect(html, `note ${note}`).not.toContain(String(note));
  });

  it("le verdict, lui, reste affiché : c'est ce qui remplace la note", () => {
    for (const etat of PREVIEW_STATES) {
      const { analysis } = previewAnalysis(etat);
      if (analysis.score === null || analysis.evaluability !== "complete") continue;
      const html = renderToStaticMarkup(<ScoreBand analysis={analysis} showTier />);
      expect(html, etat).toContain(BAND_LABEL[analysis.score.band]);
    }
  });

  it("la pastille se rend seule, sans dépendre d'une note", () => {
    expect(renderToStaticMarkup(<VerdictPill band="weak" />)).toContain(BAND_LABEL.weak);
  });

  it("plus aucune animation de score dans la feuille de style", () => {
    // Les commentaires NOMMENT ce qui est parti, et c'est bien : ils disent
    // pourquoi. On ne cherche donc que dans les déclarations.
    const css = readFileSync("app/globals.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const parti of ["--score-now", "--score-target", "--duration-score", "score-count", "gauge-grow", "gauge-marker"]) {
      expect(css, parti).not.toContain(parti);
    }
  });
});
