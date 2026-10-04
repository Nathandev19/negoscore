import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { AnimatedScore, ScoreGauge } from "@/components/result/score-band";
import { BAND_STYLE } from "@/lib/display";
import { bandFor } from "@/lib/rates/score";

// Mission #036 B : la jauge est une barre continue. Une seule forme remplie,
// de largeur égale au score, un repère à la même position, aucun segment.

const SCORES = [0, 1, 19, 20, 32, 50, 75, 99, 100];

function render(value: number, animated = true) {
  return renderToStaticMarkup(createElement(ScoreGauge, { score: { value, band: bandFor(value) }, animated }));
}

describe("jauge continue", () => {
  it.each(SCORES)("score %i : remplissage et repère à la même position, couleur de sa bande", (value) => {
    const html = render(value);
    expect(html.match(/data-gauge-fill/g)).toHaveLength(1);
    expect(html.match(/data-gauge-marker/g)).toHaveLength(1);
    expect(html).toContain(`style="width:${value}%"`);
    expect(html).toContain(`style="left:clamp(2px, ${value}%, calc(100% - 2px))"`);
    expect(html).toContain(BAND_STYLE[bandFor(value)].onMarque);
  });

  it("les cinq bandes sont couvertes par les scores vérifiés", () => {
    expect(new Set(SCORES.map(bandFor))).toEqual(new Set(["bad", "weak", "fair", "good", "excellent"]));
  });

  it("aucun segment : plus de largeurs proportionnelles aux bandes ni de remplissage partiel par morceau", () => {
    const html = render(32);
    expect(html).not.toMatch(/flex-grow|flexGrow|gap-1\.5/);
  });

  it("exemple figé de l'accueil : affiché directement à la valeur, sans animation", () => {
    const html = render(32, false);
    expect(html).toContain("width:32%;animation:none");
    expect(html).toContain("left:clamp(2px, 32%, calc(100% - 2px));animation:none");
  });
});

// Mission #040 F : au changement de niveau, l'animation est rejouée depuis le
// score précédent. Le parent remonte le bandeau (key) ; ici, le point de départ.
describe("animation rejouée depuis le score précédent", () => {
  it("jauge et chiffre portent leur point de départ", () => {
    const gauge = renderToStaticMarkup(createElement(ScoreGauge, { score: { value: 33, band: "weak" }, from: 24 }));
    expect(gauge).toContain("--gauge-from:24%");
    expect(gauge).toContain("--marker-from:clamp(2px, 24%, calc(100% - 2px))");
    const score = renderToStaticMarkup(createElement(AnimatedScore, { score: { value: 33, band: "weak" }, from: 24 }));
    expect(score).toContain("--score-from:24");
  });

  it("à l'arrivée, aucun point de départ : l'animation part de 0", () => {
    const html = renderToStaticMarkup(createElement(ScoreGauge, { score: { value: 33, band: "weak" } }));
    expect(html).not.toContain("-from");
  });

  it("les images clés lisent le point de départ, 0 par défaut ; le mouvement réduit reste global", () => {
    const css = readFileSync("app/globals.css", "utf8");
    expect(css).toContain("--score-now: var(--score-from, 0);");
    expect(css).toContain("width: var(--gauge-from, 0%);");
    expect(css).toContain("left: var(--marker-from, 2px);");
    expect(css).toMatch(/prefers-reduced-motion: reduce[\s\S]*animation-duration: 0\.01ms !important/);
  });

  it("le bandeau de résultat est remonté à chaque changement de niveau", () => {
    const source = readFileSync("components/result/analysis-result.tsx", "utf8");
    expect(source).toContain("<ScoreBand key={replay.count} analysis={analysis} from={replay.from}");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Mission #150 — LA LIGNE DU SCORE NE S'ENROULE PLUS.
//
// Mesuré en #148 puis en #150 : le compteur passe de 64 à 129 px en
// franchissant 9 → 10. À 375 px, la ligne disposait de 343 px et en demandait
// 344 une fois le compteur à deux chiffres : la pastille « Deal faible »
// basculait à la ligne À LA FIN de l'animation, ce qui ajoute 64 px et faisait
// descendre le bouton « Analyser mon offre » de 537 à 601 px — sous la ligne
// de flottaison dans le navigateur intégré d'Instagram (375 × 560).
describe("la pastille de verdict ne bascule plus à la ligne", () => {
  const CSS = readFileSync("app/globals.css", "utf8");
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

  it("l'écart horizontal reste assez serré pour que la pastille tienne à 375 px", () => {
    // Mesuré : à 375 px il ne restait que 3 px de marge. Avec l'écart d'origine
    // (20 px) il en manquait 1, et la pastille se comprimait sur deux lignes.
    const ecart = /gap-x-(\d+)/.exec(LIGNE)?.[1];
    expect(ecart, `écart introuvable dans « ${LIGNE} »`).toBeDefined();
    expect(Number(ecart)).toBeLessThanOrEqual(4);
    // Au-delà de 640 px la place n'a jamais manqué : l'écart d'origine y reste.
    expect(LIGNE).toContain("sm:gap-x-5");
  });

  it("la largeur de la valeur finale est réservée dès le premier rendu", () => {
    // C'est ce qui empêche les 64 px de largeur d'arriver au milieu de
    // l'animation. La valeur finale est rendue, invisible, DANS LE FLUX.
    expect(CSS).toContain("counter-reset: score var(--score-now) score-final var(--score-target);");
    expect(CSS).toMatch(/\.score-count::before \{[\s\S]*?content: counter\(score-final\);[\s\S]*?visibility: hidden;[\s\S]*?\}/);
    // Et la valeur qui monte est posée par-dessus, sans effet sur la mise en page.
    expect(CSS).toMatch(/\.score-count::after \{[\s\S]*?content: counter\(score\);[\s\S]*?position: absolute;[\s\S]*?\}/);
  });

  it("la réservation n'est pas faite en ch : un chiffre en chasse fixe n'en mesure pas un", () => {
    // `ch` vaut l'avance du « 0 » proportionnel (66,5 px ici) quand un chiffre
    // tabulaire en mesure 64,5 : 4 px de trop par chiffre, assez pour reprendre
    // à la pastille la place qu'on vient de lui rendre. Le piège a été vu une
    // fois, il reste fermé.
    const regle = /\.score-count \{[\s\S]*?\}/.exec(CSS)?.[0] ?? "";
    expect(regle).not.toMatch(/min-width:[^;]*ch/);
  });

  it("le compteur reste en chasse fixe : sans elle, la largeur réservée serait fausse", () => {
    // Dans SA règle, pas ailleurs dans la feuille : `figures` porte la même
    // déclaration, et chercher dans tout le fichier laisserait passer un
    // retrait ici.
    const regle = /\.score-count \{[\s\S]*?\}/.exec(CSS)?.[0] ?? "";
    expect(regle).toContain("font-variant-numeric: tabular-nums;");
  });
});
