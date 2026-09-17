import { gaugeArcPath, MARK, MARK_VIEWBOX, needleEnd } from "@/lib/brand-mark";
import { ICON_PALETTE } from "@/lib/design/icon-palette";

// Signe rendu pour les icônes PNG : fond blanc arrondi, jauge indigo à 72.
export function MarkImage({ size, radius }: { size: number; radius: number }) {
  const [nx, ny] = needleEnd(72);
  const inner = Math.round(size * 0.82);
  return (
    <div
      style={{
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: ICON_PALETTE.surface,
        borderRadius: radius,
      }}
    >
      <svg width={inner} height={inner} viewBox={`0 0 ${MARK_VIEWBOX} ${MARK_VIEWBOX}`} fill="none">
        <path d={gaugeArcPath()} stroke={ICON_PALETTE.brand} strokeWidth={MARK.stroke} strokeLinecap="round" />
        <line
          x1={MARK.center}
          y1={MARK.center}
          x2={nx}
          y2={ny}
          stroke={ICON_PALETTE.brand}
          strokeWidth={MARK.needleStroke}
          strokeLinecap="round"
        />
        <circle cx={MARK.center} cy={MARK.center} r={MARK.hub} fill={ICON_PALETTE.brand} />
      </svg>
    </div>
  );
}
