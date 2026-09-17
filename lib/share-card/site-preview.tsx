import type { ReactElement } from "react";
import { LogoMark } from "@/components/brand/logo";
import { BRAND } from "@/lib/brand";
import { STATIC_PALETTE } from "@/lib/design/static-palette";

// Image d'aperçu du site quand un lien est partagé (mission #047) : 1200 × 630,
// bleu, le signe, une phrase. Mêmes polices embarquées et même moteur (next/og)
// que la carte partageable. Contenu fermé, identique pour TOUTES les pages :
// aucune donnée d'analyse (ni marque, ni montant, ni score) ne peut y figurer.
// Vérifié par tests/seo.test.tsx.

export const SITE_PREVIEW_SIZE = { width: 1200, height: 630 } as const;
export const SITE_PREVIEW_ALT = `${BRAND.name} — ${BRAND.tagline}`;

// Tous les textes de l'image, et rien d'autre.
export const SITE_PREVIEW_TEXTS = {
  site: BRAND.domain,
  headline: BRAND.tagline,
  line: "Colle l'offre d'une marque : ce qu'elle vaut, et quoi répondre.",
} as const;

const { marque, creme } = STATIC_PALETTE;

export function sitePreviewElement(): ReactElement {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        width: SITE_PREVIEW_SIZE.width,
        height: SITE_PREVIEW_SIZE.height,
        padding: "72px 80px",
        background: marque,
        color: creme,
        fontFamily: "Familjen Grotesk",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        <LogoMark size={72} variant="creme" colors="static" />
        <div style={{ display: "flex", fontSize: 44, fontWeight: 600 }}>{SITE_PREVIEW_TEXTS.site}</div>
      </div>
      <div
        style={{
          display: "flex",
          fontFamily: "Bricolage Grotesque",
          fontWeight: 800,
          fontSize: 96,
          lineHeight: 1.02,
          letterSpacing: "-0.03em",
          maxWidth: 1000,
        }}
      >
        {SITE_PREVIEW_TEXTS.headline}
      </div>
      <div style={{ display: "flex", fontSize: 40, fontWeight: 600 }}>{SITE_PREVIEW_TEXTS.line}</div>
    </div>
  );
}
