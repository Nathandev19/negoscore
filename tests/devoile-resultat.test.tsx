import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Estimate } from "@/components/result/analysis-blocks";
import { previewAnalysis } from "@/lib/fixtures/preview-states";
import { DEVOILE_PAS_MS, devoileDelai, planDevoile } from "@/lib/ui/devoile";

// LA PAGE DE RÉSULTAT SE DÉVOILE PAR ÉTAPES.
//
// Les blocs arrivaient tous ensemble ; ils arrivent l'un après l'autre, dans
// l'ordre de lecture : verdict, Création, les majorations, le total, la
// réponse à envoyer.
//
// L'animation est PRÉSENTATIONNELLE. Ce qui est vérifié ici n'est donc pas une
// donnée — aucune n'a changé — mais trois choses qui cassent en silence :
// l'ordre, l'absence de trou quand une ligne manque, et le fait que le
// contenu reste VISIBLE quand l'animation ne tourne pas.

vi.mock("next/navigation", () => ({ usePathname: () => "/analyse/resultat/x" }));

const CSS = readFileSync("app/globals.css", "utf8");

describe("l'ordre, et pas de trou dedans", () => {
  it("le pas est de 90 ms, et le délai suit la position", () => {
    expect(DEVOILE_PAS_MS).toBe(90);
    expect(devoileDelai(0)).toEqual({ animationDelay: "0ms" });
    expect(devoileDelai(6)).toEqual({ animationDelay: "540ms" });
    // Une position négative ne produit pas un délai négatif, qui ferait
    // démarrer l'animation en cours de route.
    expect(devoileDelai(-2)).toEqual({ animationDelay: "0ms" });
  });

  it("chiffrage complet : verdict, Création, les majorations, le total, la réponse", () => {
    const { estimate } = previewAnalysis("debloque").analysis;
    const plan = planDevoile(estimate);
    expect(plan.creation).toBe(1);
    expect(plan.lignes).toEqual(estimate.lines.map((_, i) => 2 + i));
    expect(plan.total).toBe(2 + estimate.lines.length);
    expect(plan.message).toBe(3 + estimate.lines.length);
  });

  it("LES POSITIONS SE SUIVENT, quel que soit le détail du chiffrage", () => {
    // Le défaut qu'une suite d'indices figés aurait produit : une ligne
    // absente laisse un trou de 90 ms au milieu de la séquence. Vérifié sur
    // tous les états de prévisualisation, qui n'ont pas le même détail.
    for (const etat of ["verrouille", "debloque", "complete", "au-dessus", "unpriced", "quantite-inconnue", "prix-plafonne", "commission"] as const) {
      const plan = planDevoile(previewAnalysis(etat).analysis.estimate);
      const positions = [plan.creation, ...plan.lignes, plan.total, plan.message].filter((p): p is number => p !== null);
      expect(positions, etat).toEqual(positions.map((_, i) => i + 1));
    }
  });

  it("offre incomplète : le bloc de chiffrage n'est pas rendu, la réponse suit le verdict", () => {
    expect(planDevoile(null)).toEqual({ creation: null, lignes: [], total: null, message: 1 });
  });

  // LE CAS POUR LEQUEL LE COMPTEUR EXISTE, et qu'aucun état de
  // prévisualisation ne produit : une ligne absente. Relevé par la batterie de
  // mutation — avec des indices figés (creation: 1, lignes: 2+i, …) tous les
  // tests passaient, parce que tous les états ont une Création et un total.
  const sansLigne = (champs: Partial<ReturnType<typeof previewAnalysis>["analysis"]["estimate"]>) => ({
    ...previewAnalysis("debloque").analysis.estimate,
    ...champs,
  });

  it("SANS ligne Création : les majorations prennent la première place, sans trou", () => {
    const plan = planDevoile(sansLigne({ base_low: null, base_high: null }));
    expect(plan.creation).toBeNull();
    // La première majoration prend la position 1, pas la 2.
    expect(plan.lignes[0]).toBe(1);
    expect(plan.lignes).toEqual(plan.lignes.map((_, i) => i + 1));
    expect(plan.total).toBe(plan.lignes.length + 1);
    expect(plan.message).toBe(plan.lignes.length + 2);
  });

  it("SANS total : la réponse suit la dernière majoration", () => {
    const plan = planDevoile(sansLigne({ total_low: null, total_high: null }));
    expect(plan.total).toBeNull();
    expect(plan.message).toBe(plan.lignes.length + 2);
  });

  it("SANS aucune majoration : Création, le total, puis la réponse", () => {
    const plan = planDevoile(sansLigne({ lines: [] }));
    expect(plan).toEqual({ creation: 1, lignes: [], total: 2, message: 3 });
  });

  it("un chiffrage entièrement vide : la réponse suit directement le verdict", () => {
    const plan = planDevoile(sansLigne({ base_low: null, base_high: null, total_low: null, total_high: null, lines: [] }));
    expect(plan).toEqual({ creation: null, lignes: [], total: null, message: 1 });
  });
});

describe("ce qui part dans le rendu", () => {
  const rendu = (devoile: ReturnType<typeof planDevoile> | null) => {
    const { estimate } = previewAnalysis("debloque").analysis;
    return renderToStaticMarkup(<Estimate estimate={estimate} devoile={devoile} />);
  };

  it("chaque ligne porte sa classe et son délai", () => {
    const { estimate } = previewAnalysis("debloque").analysis;
    const html = rendu(planDevoile(estimate));
    expect(html.split("devoile").length - 1).toBe(2 + estimate.lines.length);
    for (let position = 1; position <= 2 + estimate.lines.length; position += 1) {
      expect(html, `position ${position}`).toContain(`animation-delay:${position * DEVOILE_PAS_MS}ms`);
    }
  });

  it("sans séquence, le bloc est EXACTEMENT celui d'avant : ni classe, ni style", () => {
    const html = rendu(null);
    expect(html).not.toContain("devoile");
    expect(html).not.toContain("animation-delay");
  });

  it("les montants sont les mêmes avec et sans séquence : rien d'autre ne change", () => {
    // L'animation est présentationnelle. Si un chiffre bougeait, elle ne le
    // serait plus — et c'est la seule chose qui importerait vraiment.
    const sans = rendu(null).replace(/ (?:class|style)="[^"]*"/g, "");
    const avec = rendu(planDevoile(previewAnalysis("debloque").analysis.estimate)).replace(/ (?:class|style)="[^"]*"/g, "");
    expect(avec).toBe(sans);
  });
});

describe("LE CONTENU RESTE VISIBLE QUAND L'ANIMATION NE TOURNE PAS", () => {
  // Le défaut relevé dans le navigateur, et la raison de la forme du CSS.
  //
  // La première version posait l'animation sans condition et comptait sur la
  // règle globale de mouvement réduit, qui ramène la durée à 0,01 ms : une
  // animation si courte se termine au premier tick. Mesuré avec la préférence
  // activée : les sept blocs restaient à OPACITÉ 0. Sans tick — onglet en
  // arrière-plan, rendu suspendu — l'animation reste à son premier état, et la
  // page était vide.
  const regle = CSS.slice(CSS.indexOf(".devoile"), CSS.indexOf("@keyframes devoile"));

  it("l'animation n'est posée QUE là où le mouvement est autorisé", () => {
    const index = CSS.indexOf(".devoile {");
    expect(index).toBeGreaterThan(0);
    // La déclaration vit dans @media (prefers-reduced-motion: no-preference) :
    // c'est l'ouverture qui précède immédiatement la règle.
    expect(CSS.slice(0, index)).toMatch(/@media \(prefers-reduced-motion: no-preference\) \{\s*$/);
  });

  it("aucun « opacity: 0 » statique : l'état initial vit dans @keyframes", () => {
    expect(regle).not.toContain("opacity");
    expect(regle).not.toContain("translateY");
    const keyframes = CSS.slice(CSS.indexOf("@keyframes devoile"));
    expect(keyframes).toContain("opacity: 0");
    expect(keyframes).toContain("translateY(8px)");
  });

  it("à l'impression, rien ne s'anime", () => {
    expect(CSS).toMatch(/@media print \{\s*\.devoile \{\s*animation: none;/);
  });

  it("la durée est de 220 ms, la translation de 8 px, et la sortie est douce", () => {
    expect(CSS).toContain("animation: devoile 220ms cubic-bezier(0.22, 1, 0.36, 1) 0ms both;");
    expect(CSS).toContain("translateY(8px)");
  });

  it("on n'anime QUE l'opacité et la transformation : rien qui touche la mise en page", () => {
    // C'est ce qui garantit l'absence de saut : ni l'une ni l'autre n'entre
    // dans le calcul de mise en page. Mesuré dans le navigateur — 20 relevés,
    // aucune position de mise en page ne bouge.
    const keyframes = CSS.slice(CSS.indexOf("@keyframes devoile"), CSS.indexOf("@keyframes devoile") + 220);
    const proprietes = [...keyframes.matchAll(/^\s{4}([a-z-]+):/gm)].map((m) => m[1]);
    expect([...new Set(proprietes)].sort()).toEqual(["opacity", "transform"]);
  });
});
