import { ImageResponse } from "next/og";
import { LogoMark } from "@/components/brand/logo";
import { BRAND } from "@/lib/brand";
import { EMAIL_COLORS, EMAIL_LOGO } from "@/lib/email/layout";
import { loadFonts } from "@/lib/share-card/render";

// DÉVELOPPEMENT UNIQUEMENT (extension .dev.tsx, voir next.config.ts) : génère
// l'image du signe et du mot pour l'en-tête des emails, crème sur bleu, en
// double résolution (400 × 80 affichés en 200 × 40). Le fichier servi aux
// emails est EMAIL_LOGO.path dans public/, enregistré depuis cette route.
const SCALE = 2;

export async function GET() {
  const width = EMAIL_LOGO.width * SCALE;
  const height = EMAIL_LOGO.height * SCALE;
  return new ImageResponse(
    (
      <div style={{ display: "flex", alignItems: "center", gap: 14 * SCALE / 2, width, height, background: EMAIL_COLORS.marque }}>
        <LogoMark size={height} variant="creme" colors="static" />
        <div
          style={{
            display: "flex",
            fontFamily: "Bricolage Grotesque",
            fontWeight: 800,
            fontSize: 30 * SCALE,
            letterSpacing: "-0.02em",
            color: EMAIL_COLORS.creme,
          }}
        >
          {BRAND.name}
        </div>
      </div>
    ),
    { width, height, fonts: await loadFonts(), headers: { "Cache-Control": "no-store" } },
  );
}
