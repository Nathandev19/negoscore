import { BRAND } from "@/lib/brand";
import { STATIC_PALETTE } from "@/lib/design/static-palette";
import { cn } from "@/lib/utils";

// Le signe de la marque : un N (son initiale) dont la jambe droite dépasse le sommet et file vers
// le haut, le montant qu'on va chercher en négociant. Tracé en contour
// uniquement. SOURCE UNIQUE du signe : l'en-tête, le bandeau des résultats, les
// icônes (app/icon.svg, icon1, apple-icon), public/brand/*.svg et la carte
// partageable en découlent (vérifié par tests/design.test.ts).

// Géométrie de la mission #036 : trois traits. La jambe droite monte 4,5 unités
// au-dessus du sommet de la gauche ; cette asymétrie, et elle seule, dit que la
// valeur dépasse. Le quatrième trait de #035 (une pointe à un autre angle que la
// diagonale) est supprimé : les deux diagonales se contredisaient.
// Trait de 3 unités (2,6 demandé) après lecture au pixel à 16 px : 3 unités font
// exactement 2 px à 16 px et 4 px à 32 px, centrés sur les jambes (x = 6 et 18).
// À 2,6, chaque jambe tombait à cheval sur deux colonnes à 87 % et la droite
// paraissait délavée ; à 3, les deux jambes sont des colonnes pleines.
export const MARK_VIEWBOX = 24;
export const MARK_PATHS = ["M6 19.5V9", "M6 9L18 19.5", "M18 19.5V4.5"] as const;
export const MARK_STROKE_WIDTH = 3;

export type LogoVariant = "marque" | "creme" | "mono";

// Couleur de chaque variante : bleu sur crème, crème sur bleu, encre. Aucune autre.
const VARIANT_CLASS: Record<LogoVariant, string> = {
  marque: "text-marque",
  creme: "text-creme",
  mono: "text-encre",
};

const VARIANT_HEX: Record<LogoVariant, string> = {
  marque: STATIC_PALETTE.marque,
  creme: STATIC_PALETTE.creme,
  mono: STATIC_PALETTE.encre,
};

type MarkProps = {
  size: number;
  variant: LogoVariant;
  // static : couleur écrite en hexadécimal, pour les rendus qui ne lisent pas le
  // CSS (icônes PNG et carte partageable, via satori).
  colors?: "css" | "static";
};

// Le signe seul, en SVG.
export function LogoMark({ size, variant, colors = "css" }: MarkProps) {
  const stroke = colors === "static" ? VARIANT_HEX[variant] : "currentColor";
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${MARK_VIEWBOX} ${MARK_VIEWBOX}`}
      fill="none"
      aria-hidden
      className={colors === "css" ? cn("shrink-0", VARIANT_CLASS[variant]) : undefined}
    >
      {/* Attributs de trait sur chaque tracé : satori n'hérite pas ceux du <svg>. */}
      {MARK_PATHS.map((d) => (
        <path
          key={d}
          d={d}
          stroke={stroke}
          strokeWidth={MARK_STROKE_WIDTH}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}

// Le signe en fichier SVG autonome (app/icon.svg, public/brand/*.svg).
export function markSvg(variant: LogoVariant, background?: "marque" | "creme"): string {
  const rect = background ? `<rect width="${MARK_VIEWBOX}" height="${MARK_VIEWBOX}" fill="${VARIANT_HEX[background]}"/>` : "";
  const paths = MARK_PATHS.map((d) => `<path d="${d}"/>`).join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MARK_VIEWBOX} ${MARK_VIEWBOX}">${rect}` +
    `<g fill="none" stroke="${VARIANT_HEX[variant]}" stroke-width="${MARK_STROKE_WIDTH}" stroke-linecap="round" stroke-linejoin="round">${paths}</g></svg>`
  );
}

type LogoProps = {
  // Hauteur du signe en pixels.
  size?: number;
  variant?: LogoVariant;
  // false : le signe seul (pied de page). Le nom reste du vrai texte, jamais un tracé.
  withName?: boolean;
  className?: string;
};

export function Logo({ size = 28, variant = "marque", withName = true, className }: LogoProps) {
  if (!withName) {
    return (
      <span role="img" aria-label={BRAND.name} className={cn("inline-flex", className)}>
        <LogoMark size={size} variant={variant} />
      </span>
    );
  }
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark size={size} variant={variant} />
      <span
        className={cn(
          "font-display text-xl leading-none font-bold tracking-tight",
          variant === "creme" ? "text-creme" : "text-encre",
        )}
        style={{ fontStretch: "100%" }}
      >
        {BRAND.name}
      </span>
    </span>
  );
}
