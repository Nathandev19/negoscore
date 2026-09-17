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
