import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AnimatedScore, ScoreGauge } from "@/components/result/score-band";
import type { Analysis } from "@/lib/schema";

// Mission #172, point 2 — LE CHIFFRE MONTE AVEC LA JAUGE.
//
// La contrainte qui commande tout : la valeur FINALE est dans le DOM dès le
// premier rendu, et l'animation est purement visuelle. C'est pour ça que le
// défilement des chiffres vit dans un pseudo-élément CSS (::after) et pas
// dans le texte : aucun test, aucun lecteur d'écran, aucun robot ne peut
// lire une valeur intermédiaire — il n'y en a pas dans le document.
//
// Mesuré image par image sur /dev/resultat (Chromium, 09/10/2026), en
// réactivant l'animation malgré le mouvement réduit du panneau :
//   60 ms → --score-now 2, jauge 11 px     364 ms → 17, 79 px
//   489 ms → 23, 104 px                     721 ms → 33, 151 px
// Les deux progressent du même pas. Ils lisent la même variable de durée, et
// ce fichier interdit qu'on les sépare.

const SCORE: NonNullable<Analysis["score"]> = { value: 58, band: "weak" };
const CSS = readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8");
const SOURCE = readFileSync(path.join(process.cwd(), "components/result/score-band.tsx"), "utf8");

// Le corps d'une règle CSS, accolades comptées : un indexOf("}") s'arrête à
// la première accolade imbriquée et déborde sur la règle suivante.
function blocCss(entete: string): string {
  const debut = CSS.indexOf(entete);
  if (debut < 0) throw new Error(`règle introuvable : ${entete}`);
  let profondeur = 0;
  for (let i = CSS.indexOf("{", debut); i < CSS.length; i++) {
    if (CSS[i] === "{") profondeur += 1;
    else if (CSS[i] === "}") {
      profondeur -= 1;
      if (profondeur === 0) return CSS.slice(debut, i + 1);
    }
  }
  throw new Error(`règle non fermée : ${entete}`);
}

describe("la valeur finale est dans le DOM dès le premier rendu", () => {
  it("le texte lisible porte le score final, pas un compte en cours", () => {
    const html = renderToStaticMarkup(<AnimatedScore score={SCORE} />);
    // Le seul texte du document est le texte accessible, et il est complet.
    expect(html).toContain("Score : 58 sur 100");
    // Le chiffre animé n'est PAS du texte : c'est un compteur CSS. Le
    // document ne contient donc aucune valeur intermédiaire, par construction.
    expect(html).toContain("--score-target:58");
    expect(html).not.toMatch(/>\s*58\s*</);
  });

  it("un lecteur d'écran annonce le chiffre final, jamais le défilement", () => {
    const html = renderToStaticMarkup(<AnimatedScore score={SCORE} />);
    // Les chiffres qui défilent sont aria-hidden ; le texte annoncé ne l'est
    // pas et porte la valeur finale.
    expect(html).toMatch(/class="sr-only">Score : 58 sur 100</);
    expect(html).toMatch(/aria-hidden[^>]*class="score-count/);
    expect(html).toMatch(/aria-hidden[^>]*>\/100</);
  });

  it("rien n'anime le score en JavaScript : pas d'état, pas d'effet", () => {
    // Un compteur en JavaScript mettrait une valeur intermédiaire DANS le
    // document, et la page de résultat doit tenir sans JavaScript (#074).
    const bloc = SOURCE.slice(SOURCE.indexOf("export function AnimatedScore"), SOURCE.indexOf("export function ScoreGauge"));
    for (const interdit of ["useState", "useEffect", "requestAnimationFrame", "setInterval", "setTimeout"]) {
      expect(bloc, interdit).not.toContain(interdit);
    }
  });
});

describe("le chiffre et la jauge arrivent ensemble, en 600 ms au plus", () => {
  it("les deux lisent la même durée, et elle ne dépasse pas 600 ms", () => {
    const declaree = /--duration-score:\s*(\d+)ms/.exec(CSS)?.[1];
    expect(declaree, "--duration-score doit être déclarée").toBeDefined();
    expect(Number(declaree)).toBeLessThanOrEqual(600);
    // La MÊME variable pour les trois animations : le chiffre, le
    // remplissage et le repère. Impossible d'en décaler un seul.
    for (const regle of [".score-count", ".gauge-grow", ".gauge-marker"]) {
      const corps = blocCss(`${regle} {`);
      expect(corps, regle).toContain("var(--duration-score)");
    }
  });

  it("aucun saut de mise en page : la largeur réservée est celle du nombre final", () => {
    // Mission #150 — ::before porte le nombre FINAL, invisible, et c'est lui
    // qui occupe la place ; ::after, qui défile, est absolu et ne pousse
    // rien. Sans ça la boîte s'élargissait en passant de 9 à 10.
    const avant = blocCss(".score-count::before");
    expect(avant).toContain("counter(score-final)");
    expect(avant).toContain("visibility: hidden");
    const apres = blocCss(".score-count::after");
    expect(apres).toContain("counter(score)");
    expect(apres).toContain("position: absolute");
  });
});

describe("mouvement réduit : le nombre s'affiche directement", () => {
  it("la règle globale neutralise toutes les animations", () => {
    const bloc = blocCss("@media (prefers-reduced-motion: reduce)");
    expect(bloc).toContain("animation-duration: 0.01ms !important");
    expect(bloc).toContain("animation-delay: 0ms !important");
  });

  it("l'image d'arrivée est la valeur finale, pas la valeur de départ", () => {
    // Les trois animations ne définissent QUE `from`. Avec `both`, l'état
    // d'arrivée est la valeur sous-jacente — le score final. Une animation
    // ramenée à 0,01 ms affiche donc directement le bon chiffre, et jamais 0.
    for (const nom of ["score-count", "gauge-grow", "gauge-marker"]) {
      const bloc = blocCss(`@keyframes ${nom}`);
      expect(bloc, nom).toContain("from {");
      expect(bloc, nom).not.toContain("to {");
    }
    expect(CSS).toContain("--score-now: var(--score-target)");
  });

  it("`animated={false}` coupe l'animation sur le chiffre comme sur la jauge", () => {
    // Utilisé par l'exemple public, qui ne doit pas rejouer l'animation.
    const chiffre = renderToStaticMarkup(<AnimatedScore score={SCORE} animated={false} />);
    expect(chiffre).toContain("animation:none");
    const jauge = renderToStaticMarkup(<ScoreGauge score={SCORE} animated={false} />);
    expect(jauge.match(/animation:none/g) ?? []).toHaveLength(2);
  });
});
