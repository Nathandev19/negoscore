import { gaugeArcPath, MARK, MARK_VIEWBOX, needleEnd } from "@/lib/brand-mark";
import { ICON_PALETTE } from "@/lib/design/icon-palette";

// Signe rendu pour les icônes PNG : fond papier, jauge encre à 72.
export function MarkImage({ size }: { size: number }) {
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
        background: ICON_PALETTE.papier,
      }}
    >
      <svg width={inner} height={inner} viewBox={`0 0 ${MARK_VIEWBOX} ${MARK_VIEWBOX}`} fill="none">
        <path d={gaugeArcPath()} stroke={ICON_PALETTE.encre} strokeWidth={MARK.stroke} strokeLinecap="round" />
        <line
          x1={MARK.center}
          y1={MARK.center}
          x2={nx}
          y2={ny}
          stroke={ICON_PALETTE.encre}
          strokeWidth={MARK.needleStroke}
          strokeLinecap="round"
        />
        <circle cx={MARK.center} cy={MARK.center} r={MARK.hub} fill={ICON_PALETTE.encre} />
      </svg>
    </div>
  );
}
