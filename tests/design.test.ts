import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ICON_PALETTE } from "@/lib/design/icon-palette";
import { BAND_SEGMENTS, BAND_STYLE } from "@/lib/display";
import { bandFor } from "@/lib/rates/score";

// Système de design : les valeurs sont lues dans app/globals.css, la source
// unique, et les contrastes sont calculés (WCAG 2.x, luminance relative).
// Règle : la seule couleur saturée du site est celle du score ; tout le reste
// est encre sur papier.

const root = process.cwd();
const css = readFileSync(path.join(root, "app", "globals.css"), "utf8");

function token(name: string): string {
  const match = css.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match) throw new Error(`jeton --color-${name} absent de globals.css`);
  return match[1].toLowerCase();
}

function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Couleur à `share` sur `background`, arrondie au pixel.
function tintOf(hex: string, share: number, background: string): string {
  const bg = rgb(background);
  return `#${rgb(hex)
    .map((c, i) => Math.round(c * share + bg[i] * (1 - share)).toString(16).padStart(2, "0"))
    .join("")}`;
}

// Chroma, de 0 à 1 : écart entre le canal le plus fort et le plus faible.
// (La saturation HSL classerait « saturés » des blancs chauds comme le papier.)
function chroma(hex: string): number {
  const channels = rgb(hex);
  return (Math.max(...channels) - Math.min(...channels)) / 255;
}

function filesIn(dirs: string[], pattern: RegExp): string[] {
  return dirs.flatMap((dir) =>
    readdirSync(path.join(root, dir), { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile() && pattern.test(e.name))
      .map((e) => path.join(e.parentPath, e.name)),
  );
}

const BANDS = ["bad", "weak", "fair", "good", "excellent"] as const;

describe("bandes de score", () => {
  it.each(BANDS)("%s : teinte à 8 % sur le papier, texte ≥ 4,5:1 sur la teinte et sur le papier", (band) => {
    const base = token(`band-${band}`);
    const tint = token(`band-${band}-tint`);
    const text = token(`band-${band}-text`);
    expect(tint).toBe(tintOf(base, 0.08, token("papier")));
    expect(contrast(text, tint)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(text, token("papier"))).toBeGreaterThanOrEqual(4.5);
    // Papier élevé (carte de score) : plus clair que le papier, donc au moins aussi lisible.
    expect(contrast(text, token("papier-eleve"))).toBeGreaterThanOrEqual(4.5);
  });

  it("les couleurs de base sont inchangées depuis #027", () => {
    expect(BANDS.map((b) => token(`band-${b}`))).toEqual(["#c41e3a", "#e8590c", "#a47500", "#2b8a3e", "#1c7c54"]);
  });

  it("une seule table bande → classes, qui couvre toutes les bandes de bandFor()", () => {
    const produced = new Set([0, 29, 30, 49, 50, 69, 70, 84, 85, 100].map((v) => bandFor(v)));
    expect([...produced].sort()).toEqual([...BANDS].sort());
    for (const band of BANDS) {
      expect(BAND_STYLE[band].text).toBe(`text-band-${band}-text`);
      expect(BAND_STYLE[band].tint).toBe(`bg-band-${band}-tint`);
    }
  });

  it("les segments de la jauge suivent les bornes de bandFor()", () => {
    expect(BAND_SEGMENTS.map((s) => s.band)).toEqual([...BANDS]);
    BAND_SEGMENTS.forEach((segment, index) => {
      expect(bandFor(segment.from)).toBe(segment.band);
      const next = BAND_SEGMENTS[index + 1];
      if (next) expect(bandFor(next.from - 1)).toBe(segment.band);
    });
  });
});

describe("encre sur papier", () => {
  it("les six jetons imposés", () => {
    expect(token("encre")).toBe("#141310");
    expect(token("encre-douce")).toBe("#3a352d");
    expect(token("attenue")).toBe("#6b655c");
    expect(token("papier")).toBe("#faf8f4");
    expect(token("papier-eleve")).toBe("#ffffff");
    expect(token("filet")).toBe("#e3ded4");
  });

  it("encre, encre douce et atténué lisibles sur le papier et le papier élevé ; papier lisible sur l'encre", () => {
    for (const name of ["encre", "encre-douce", "attenue"]) {
      expect(contrast(token(name), token("papier")), name).toBeGreaterThanOrEqual(4.5);
      expect(contrast(token(name), token("papier-eleve")), name).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(token("papier"), token("encre"))).toBeGreaterThanOrEqual(4.5);
    // Contour des champs (atténué) : 3:1 au moins pour un élément d'interface.
    expect(contrast(token("attenue"), token("papier"))).toBeGreaterThanOrEqual(3);
  });

  it("les seules couleurs saturées du thème sont celles des bandes", () => {
    const colors = [...css.matchAll(/--color-([a-z-]+):\s*(#[0-9a-fA-F]{6})/g)];
    const saturated = colors.filter(([, , hex]) => chroma(hex) > 0.2).map(([, name]) => name);
    expect(saturated.length).toBeGreaterThan(0);
    for (const name of saturated) expect(name, name).toMatch(/^band-/);
  });

  it("la palette par défaut de Tailwind, les ombres et les rayons sont retirés du thème", () => {
    for (const reset of ["--color-*: initial", "--shadow-*: initial", "--drop-shadow-*: initial", "--radius-*: initial"]) {
      expect(css).toContain(reset);
    }
    expect(css).toMatch(/--radius-control:\s*6px/);
  });

  it("les couleurs des icônes PNG sont celles de globals.css", () => {
    expect(ICON_PALETTE.encre).toBe(token("encre"));
    expect(ICON_PALETTE.papier).toBe(token("papier"));
  });

  it("les SVG du signe n'utilisent que l'encre et le papier", () => {
    const allowed = new Set([token("encre"), token("papier")]);
    const svgs = [path.join(root, "app", "icon.svg"), ...filesIn(["public"], /\.svg$/)];
    expect(svgs.length).toBeGreaterThan(1);
    for (const file of svgs) {
      const hexes = [...readFileSync(file, "utf8").matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => m[0].toLowerCase());
      expect(hexes.length, file).toBeGreaterThan(0);
      for (const hex of hexes) expect(allowed.has(hex), `${file} : ${hex}`).toBe(true);
    }
  });
});

describe("anti-générique", () => {
  const sources = filesIn(["app", "components", "lib"], /\.(tsx?|css)$/).filter(
    (file) => !file.endsWith("globals.css") && !file.includes(`${path.sep}rates${path.sep}`),
  );

  it("aucune couleur écrite en dur dans les composants, pages et bibliothèques (hors palette des icônes)", () => {
    const offenders = sources
      .filter((file) => !file.endsWith("icon-palette.ts"))
      .filter((file) => /#[0-9a-fA-F]{6}\b/.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("aucune trace de l'ancienne marque indigo, d'Inter, de dégradé ou d'ombre", () => {
    const forbidden = [
      /5a4af4|4436d6|f2f1fe/i,
      /\bbrand-(strong|tint)\b|\b(bg|text|border)-brand\b/,
      /\bInter\b|--font-inter/,
      /\b(indigo|violet|purple|fuchsia)-\d/,
      /gradient/i,
      /\bshadow(-[a-z0-9]+)?\b|box-shadow/,
    ];
    const offenders = sources.flatMap((file) => {
      const text = readFileSync(file, "utf8");
      return forbidden.filter((pattern) => pattern.test(text)).map((pattern) => `${path.relative(root, file)} ${pattern}`);
    });
    expect(offenders).toEqual([]);
  });

  it("rayons : seuls les contrôles en ont un, et aucune classe de la palette par défaut", () => {
    const offenders = sources.flatMap((file) => {
      const text = readFileSync(file, "utf8");
      const hits = [
        ...text.matchAll(/\brounded-(?!control\b)[a-z0-9]+|\b(?:bg|text|border|divide|ring|fill|stroke)-(?:neutral|gray|slate|zinc|stone|red|orange|amber|yellow|green|emerald|sky|blue|white|black)(?:-\d+)?\b/g),
      ];
      return hits.map((m) => `${path.relative(root, file)} ${m[0]}`);
    });
    expect(offenders).toEqual([]);
  });
});
