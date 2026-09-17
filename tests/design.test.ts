import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { markSvg } from "@/lib/brand-mark";
import { GRAIN_OPACITY, GRAIN_TILE, grainDataUri } from "@/lib/design/grain";
import { STATIC_PALETTE } from "@/lib/design/static-palette";
import { BAND_SEGMENTS, BAND_STYLE, SEVERITY_BADGE } from "@/lib/display";
import { bandFor } from "@/lib/rates/score";

// Système de design (#031) : un fond de marque constant, la couleur du score
// par-dessus. Valeurs lues dans app/globals.css, la source unique ; contrastes
// calculés (WCAG 2.x, luminance relative), grain compris au pire pixel.

const root = process.cwd();
const css = readFileSync(path.join(root, "app", "globals.css"), "utf8");

function token(name: string): string {
  const match = css.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match) throw new Error(`jeton --color-${name} absent de globals.css`);
  return match[1].toLowerCase();
}

type Rgb = [number, number, number];

function rgb(hex: string): Rgb {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
}

function luminanceOf(channels: Rgb): number {
  const [r, g, b] = channels.map((c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: number, b: number): number {
  const [hi, lo] = [a, b].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export function contrast(a: string, b: string): number {
  return ratio(luminanceOf(rgb(a)), luminanceOf(rgb(b)));
}

// Pixel du bleu sous le grain : mélangé à GRAIN_OPACITY de blanc pur (le plus
// clair possible) ou de noir pur (le plus foncé). Toute valeur du bruit est
// entre les deux.
function grained(hex: string, noise: 0 | 1): Rgb {
  return rgb(hex).map((c) => c * (1 - GRAIN_OPACITY) + noise * 255 * GRAIN_OPACITY) as Rgb;
}

// Pire contraste entre une couleur et le bleu grainé.
function contrastOnGrain(hex: string, surface: string): number {
  const color = luminanceOf(rgb(hex));
  return Math.min(ratio(color, luminanceOf(grained(surface, 1))), ratio(color, luminanceOf(grained(surface, 0))));
}

function hue(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => c / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return h * 60;
}

function filesIn(dirs: string[], pattern: RegExp): string[] {
  return dirs.flatMap((dir) =>
    readdirSync(path.join(root, dir), { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile() && pattern.test(e.name))
      .map((e) => path.join(e.parentPath, e.name)),
  );
}

const BANDS = ["bad", "weak", "fair", "good", "excellent"] as const;

describe("jetons", () => {
  it("les valeurs imposées", () => {
    expect(token("marque")).toBe("#1f3cff");
    expect(token("marque-deep")).toBe("#0f22b8");
    expect(token("creme")).toBe("#fff7e8");
    expect(token("encre")).toBe("#14120c");
    expect(token("encre-douce")).toBe("#3b362a");
    expect(token("attenue")).toBe("#6e6759");
    expect(token("filet")).toBe("#e4dcc9");
    expect(BANDS.map((b) => token(`band-${b}`))).toEqual(["#ff3b4e", "#ff7a1a", "#ffc400", "#22c55e", "#00d49a"]);
  });

  it("plus aucune trace des palettes #027 et #030, ni du serif", () => {
    expect(css).not.toMatch(/--color-(papier|brand|ink|surface|copy|subtle|line)\b/);
    expect(css.toLowerCase()).not.toMatch(/#faf8f4|#5a4af4|#141310/);
    expect(css).not.toMatch(/Instrument|--font-serif|@utility verdict/);
  });

  it("la palette par défaut de Tailwind et les ombres sont retirées du thème", () => {
    for (const reset of ["--color-*: initial", "--shadow-*: initial", "--drop-shadow-*: initial"]) expect(css).toContain(reset);
  });
});

describe("contrastes (A2)", () => {
  it.each(BANDS)("%s : aplat sur bleu ≥ 3:1 (sans et avec grain), aplat sur crème ≥ 3:1, texte encre ≥ 4,5:1", (band) => {
    const onMarque = token(`band-${band}-on-marque`);
    const onCreme = token(`band-${band}-on-creme`);
    expect(contrast(onMarque, token("marque"))).toBeGreaterThanOrEqual(3);
    expect(contrastOnGrain(onMarque, token("marque"))).toBeGreaterThanOrEqual(3);
    expect(contrast(onCreme, token("creme"))).toBeGreaterThanOrEqual(3);
    expect(contrast(token("encre"), onMarque)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token("encre"), onCreme)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(BANDS)("%s : les deux niveaux gardent la teinte de la bande (luminosité seule ajustée)", (band) => {
    const base = hue(token(`band-${band}`));
    for (const level of ["on-marque", "on-creme"]) {
      const diff = Math.abs(hue(token(`band-${band}-${level}`)) - base);
      expect(Math.min(diff, 360 - diff), level).toBeLessThanOrEqual(1);
    }
  });

  it("aucune couleur ne peut tenir 3:1 à la fois contre le bleu et contre la crème : d'où les deux niveaux", () => {
    const needOnMarque = 3 * (luminanceOf(rgb(token("marque"))) + 0.05) - 0.05;
    const maxOnCreme = (luminanceOf(rgb(token("creme"))) + 0.05) / 3 - 0.05;
    expect(needOnMarque).toBeGreaterThan(maxOnCreme);
  });

  it("texte : crème sur bleu (grain compris), encre et corps sur crème, lien bleu sur crème", () => {
    expect(contrast(token("creme"), token("marque"))).toBeGreaterThanOrEqual(4.5);
    expect(contrastOnGrain(token("creme"), token("marque"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token("creme"), token("marque-deep"))).toBeGreaterThanOrEqual(4.5);
    for (const name of ["encre", "encre-douce", "attenue", "marque", "marque-deep"]) {
      expect(contrast(token(name), token("creme")), name).toBeGreaterThanOrEqual(4.5);
    }
    // Boutons désactivés et gravité « mineur » : plein atténué, texte crème.
    expect(contrast(token("creme"), token("attenue"))).toBeGreaterThanOrEqual(4.5);
    // Bouton principal désactivé : bleu marque désaturé, même teinte, libellé crème ≥ 4,5:1.
    expect(contrast(token("creme"), token("marque-muted"))).toBeGreaterThanOrEqual(4.5);
    const diff = Math.abs(hue(token("marque-muted")) - hue(token("marque")));
    expect(Math.min(diff, 360 - diff)).toBeLessThanOrEqual(1);
    // Contour d'une action destructrice et barre d'erreur : aplat « bad » sur crème.
    expect(contrast(token("band-bad-on-creme"), token("creme"))).toBeGreaterThanOrEqual(3);
  });
});

describe("bandes : aplats, jamais du texte", () => {
  it("une seule table bande → classes, qui couvre toutes les bandes de bandFor()", () => {
    const produced = new Set([0, 29, 30, 49, 50, 69, 70, 84, 85, 100].map((v) => bandFor(v)));
    expect([...produced].sort()).toEqual([...BANDS].sort());
    for (const band of BANDS) {
      expect(BAND_STYLE[band]).toEqual({ onMarque: `bg-band-${band}-on-marque`, onCreme: `bg-band-${band}-on-creme` });
    }
    expect(SEVERITY_BADGE).toEqual({
      high: "bg-band-bad-on-creme text-encre",
      medium: "bg-band-weak-on-creme text-encre",
      low: "bg-attenue text-creme",
    });
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

describe("grain, signe et couleurs hors CSS", () => {
  it("le grain CSS est le tracé partagé de lib/design/grain.ts", () => {
    expect(css).toContain(`url("${grainDataUri(GRAIN_TILE, GRAIN_TILE)}")`);
    expect(grainDataUri(10, 10)).not.toMatch(/#|https?:\/\/(?!www\.w3\.org)/);
  });

  it("STATIC_PALETTE est la copie exacte de globals.css", () => {
    expect(STATIC_PALETTE.marque).toBe(token("marque"));
    expect(STATIC_PALETTE.creme).toBe(token("creme"));
    expect(STATIC_PALETTE.encre).toBe(token("encre"));
    for (const band of BANDS) expect(STATIC_PALETTE.bandOnMarque[band]).toBe(token(`band-${band}-on-marque`));
  });

  it("les SVG du signe suivent la géométrie de lib/brand-mark.ts : crème sur bleu, bleu sur crème, encre", () => {
    const read = (file: string) => readFileSync(path.join(root, file), "utf8").trim().toLowerCase();
    const marque = token("marque");
    const creme = token("creme");
    expect(read("app/icon.svg")).toBe(markSvg({ color: creme, background: marque }).toLowerCase());
    expect(read("public/brand/negoscore-mark-on-marque.svg")).toBe(markSvg({ color: creme, background: marque }).toLowerCase());
    expect(read("public/brand/negoscore-mark.svg")).toBe(markSvg({ color: marque }).toLowerCase());
    expect(read("public/brand/negoscore-mark-mono.svg")).toBe(markSvg({ color: token("encre") }).toLowerCase());
  });
});

describe("usage des couleurs dans le code", () => {
  const sources = filesIn(["app", "components", "lib"], /\.(tsx?|css)$/).filter(
    (file) => !file.endsWith("globals.css") && !file.includes(`${path.sep}rates${path.sep}`),
  );
  const rel = (file: string) => path.relative(root, file).split(path.sep).join("/");

  it("aucune couleur écrite en dur (hors palette statique)", () => {
    const offenders = sources
      .filter((file) => !file.endsWith("static-palette.ts"))
      .filter((file) => /#[0-9a-fA-F]{6}\b/.test(readFileSync(file, "utf8")));
    expect(offenders.map(rel)).toEqual([]);
  });

  it("les couleurs de bande ne sont jamais du texte ni une bordure de texte", () => {
    const offenders = sources.filter((file) => /\btext-band-/.test(readFileSync(file, "utf8")));
    expect(offenders.map(rel)).toEqual([]);
  });

  it("le bleu marque en fond seulement : en-tête et bandeau de résultat, bouton principal, exemple de l'accueil", () => {
    const allowed = [
      "components/ui/button.tsx",
      "components/header-nav.tsx",
      "components/result/analysis-result.tsx",
      "app/page.tsx",
    ];
    const offenders = sources.filter((file) => /\bbg-marque\b/.test(readFileSync(file, "utf8"))).map(rel);
    expect(offenders.filter((file) => !allowed.includes(file))).toEqual([]);
  });

  it("aucun serif, aucune ancienne police, aucun dégradé ni ombre", () => {
    const forbidden = [/Instrument_Serif|Instrument Serif|font-serif/, /Instrument_Sans|\bInter\b|--font-inter/, /gradient/i, /\bshadow(-[a-z0-9]+)?\b|box-shadow/, /papier/];
    const offenders = sources.flatMap((file) => {
      const text = readFileSync(file, "utf8");
      return forbidden.filter((pattern) => pattern.test(text)).map((pattern) => `${rel(file)} ${pattern}`);
    });
    expect(offenders).toEqual([]);
  });
});
