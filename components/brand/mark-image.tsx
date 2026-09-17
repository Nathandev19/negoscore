import { EURO_BAR, euroArcPath, MARK, MARK_VIEWBOX } from "@/lib/brand-mark";
import { STATIC_PALETTE } from "@/lib/design/static-palette";

// Signe rendu pour les icônes PNG : € crème sur bleu marque.
export function MarkImage({ size }: { size: number }) {
  const inner = Math.round(size * 0.8);
  return (
    <div
      style={{
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: STATIC_PALETTE.marque,
      }}
    >
      <svg width={inner} height={inner} viewBox={`0 0 ${MARK_VIEWBOX} ${MARK_VIEWBOX}`} fill="none">
        <path d={euroArcPath()} stroke={STATIC_PALETTE.creme} strokeWidth={MARK.stroke} strokeLinecap="round" />
        <line
          x1={EURO_BAR.x1}
          y1={EURO_BAR.y}
          x2={EURO_BAR.x2}
          y2={EURO_BAR.y}
          stroke={STATIC_PALETTE.creme}
          strokeWidth={MARK.stroke}
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}
