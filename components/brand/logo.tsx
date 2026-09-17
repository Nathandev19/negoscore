import { BRAND } from "@/lib/brand";
import { gaugeArcPath, MARK, MARK_VIEWBOX, needleEnd } from "@/lib/brand-mark";
import { cn } from "@/lib/utils";

type LogoProps = {
  // Valeur pointée par l'index, de 0 à 100. 72 pour la version statique.
  value?: number;
  // Hauteur du signe en pixels.
  size?: number;
  // full : signe + nom. mark : signe seul. mono : signe + nom en couleur du texte.
  variant?: "full" | "mark" | "mono";
  className?: string;
};

// Le signe : une jauge. Le nom est du vrai texte, pas un tracé.
export function Logo({ value = 72, size = 28, variant = "full", className }: LogoProps) {
  const [nx, ny] = needleEnd(value);
  const color = variant === "mono" ? "currentColor" : "var(--color-brand)";
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
      <path d={gaugeArcPath()} stroke={color} strokeWidth={MARK.stroke} strokeLinecap="round" />
      <line
        x1={MARK.center}
        y1={MARK.center}
        x2={nx}
        y2={ny}
        stroke={color}
        strokeWidth={MARK.needleStroke}
        strokeLinecap="round"
      />
      <circle cx={MARK.center} cy={MARK.center} r={MARK.hub} fill={color} />
    </svg>
  );
  if (variant === "mark") return <span className={cn("inline-flex", className)}>{mark}</span>;
  return (
    <span className={cn("inline-flex items-center gap-2", variant === "mono" ? "text-current" : "text-ink", className)}>
      {mark}
      <span className="font-display text-lg leading-none font-bold tracking-tight">{BRAND.name}</span>
    </span>
  );
}
