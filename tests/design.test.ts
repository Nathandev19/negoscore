import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ICON_PALETTE } from "@/lib/design/icon-palette";
import { BAND_STYLE } from "@/lib/display";
import { bandFor } from "@/lib/rates/score";

// Système de design : les valeurs sont lues dans app/globals.css, la source
// unique, et les contrastes sont calculés (WCAG 2.x, luminance relative).

const css = readFileSync(path.join(process.cwd(), "app", "globals.css"), "utf8");

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

// Couleur à `share` sur blanc, arrondie au pixel.
function tintOf(hex: string, share: number): string {
  return `#${rgb(hex)
    .map((c) => Math.round(c * share + 255 * (1 - share)).toString(16).padStart(2, "0"))
    .join("")}`;
}

const BANDS = ["bad", "weak", "fair", "good", "excellent"] as const;

describe("bandes de score", () => {
  it.each(BANDS)("%s : fond teinté à 8 % sur blanc, texte ≥ 4,5:1 sur la teinte et sur le blanc", (band) => {
    const base = token(`band-${band}`);
    const tint = token(`band-${band}-tint`);
    const text = token(`band-${band}-text`);
    expect(tint).toBe(tintOf(base, 0.08));
    expect(contrast(text, tint)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(text, "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });

  it("les couleurs de base imposées sont celles de la mission", () => {
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
});

describe("couleurs de l'interface", () => {
  it("texte et marque lisibles sur les surfaces", () => {
    for (const name of ["ink", "copy", "subtle", "brand", "brand-strong"]) {
      expect(contrast(token(name), token("surface")), name).toBeGreaterThanOrEqual(4.5);
      expect(contrast(token(name), token("surface-soft")), name).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast("#ffffff", token("brand"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token("brand-strong"), token("brand-tint"))).toBeGreaterThanOrEqual(4.5);
    expect(token("brand-tint")).toBe(tintOf(token("brand"), 0.08));
  });

  it("les couleurs des icônes PNG sont celles de globals.css", () => {
    expect(ICON_PALETTE.brand).toBe(token("brand"));
    expect(ICON_PALETTE.ink).toBe(token("ink"));
    expect(ICON_PALETTE.surface).toBe(token("surface"));
  });

  it("aucune couleur de marque en dur dans les composants et les pages", () => {
    const files = ["app", "components"].flatMap((dir) =>
      readdirSync(path.join(process.cwd(), dir), { recursive: true, withFileTypes: true })
        .filter((e) => e.isFile() && /\.(tsx?|css)$/.test(e.name) && e.name !== "globals.css")
        .map((e) => path.join(e.parentPath, e.name)),
    );
    const hexes = ["5a4af4", "4436d6", "0e0e12", "3f3f49", "6e6e7a", "c41e3a", "e8590c", "a47500", "2b8a3e", "1c7c54"];
    const offenders = files.filter((file) => hexes.some((hex) => readFileSync(file, "utf8").toLowerCase().includes(hex)));
    expect(offenders).toEqual([]);
  });
});
