import { BRAND } from "@/lib/brand";
import { EURO_BAR, euroArcPath, MARK, MARK_VIEWBOX } from "@/lib/brand-mark";
import { cn } from "@/lib/utils";

type LogoProps = {
  // Hauteur du signe en pixels.
  size?: number;
  // full : signe + nom. mark : signe seul.
  variant?: "full" | "mark";
  // Couleur : bleu sur crème, crème sur bleu.
  tone?: "on-creme" | "on-marque";
  className?: string;
};

// Le signe : un € dessiné comme une jauge. Le nom est du vrai texte, pas un tracé.
export function Logo({ size = 28, variant = "full", tone = "on-creme", className }: LogoProps) {
  const toneClass = tone === "on-marque" ? "text-creme" : "text-marque";
  const mark = (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${MARK_VIEWBOX} ${MARK_VIEWBOX}`}
      fill="none"
      aria-hidden={variant !== "mark"}
      role={variant === "mark" ? "img" : undefined}
      aria-label={variant === "mark" ? BRAND.name : undefined}
      className="shrink-0"
    >
      <path d={euroArcPath()} stroke="currentColor" strokeWidth={MARK.stroke} strokeLinecap="round" />
      <line
        x1={EURO_BAR.x1}
        y1={EURO_BAR.y}
        x2={EURO_BAR.x2}
        y2={EURO_BAR.y}
        stroke="currentColor"
        strokeWidth={MARK.stroke}
        strokeLinecap="round"
      />
    </svg>
  );
  if (variant === "mark") return <span className={cn("inline-flex", toneClass, className)}>{mark}</span>;
  return (
    <span className={cn("inline-flex items-center gap-2", toneClass, className)}>
      {mark}
      <span
        className={cn(
          "headline text-xl leading-none",
          tone === "on-marque" ? "text-creme" : "text-encre",
        )}
      >
        {BRAND.name}
      </span>
    </span>
  );
}
