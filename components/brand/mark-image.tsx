import { LogoMark } from "@/components/brand/logo";
import { STATIC_PALETTE } from "@/lib/design/static-palette";

// Signe rendu pour les icônes PNG (favicon 32, apple-icon 180) : crème sur bleu.
export function MarkImage({ size }: { size: number }) {
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
      <LogoMark size={Math.round(size * 0.84)} variant="creme" colors="static" />
    </div>
  );
}
