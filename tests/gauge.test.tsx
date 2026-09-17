import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ScoreGauge } from "@/components/result/score-band";
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
    expect(html).toContain(`style="left:${value}%"`);
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
    expect(html).toContain("left:32%;animation:none");
  });
});
