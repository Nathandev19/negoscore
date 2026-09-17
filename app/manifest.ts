import type { MetadataRoute } from "next";
import { BRAND } from "@/lib/brand";
import { STATIC_PALETTE } from "@/lib/design/static-palette";

// Manifeste (mission #051) : il sert quand le site est ajouté à l'écran
// d'accueil. Rien d'autre n'y est promis — pas d'application installable, pas
// de mode hors ligne. Les icônes sont les routes générées depuis le logo.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${BRAND.name} — ${BRAND.tagline}`,
    short_name: BRAND.shortName,
    description: "Colle le message d'une marque : ce que le deal vaut en euros, ce qui cloche et quoi répondre.",
    lang: "fr-FR",
    start_url: "/",
    display: "browser",
    background_color: STATIC_PALETTE.creme,
    theme_color: STATIC_PALETTE.creme,
    icons: [
      { src: "/icon1", sizes: "32x32", type: "image/png" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
      { src: "/icon2", sizes: "512x512", type: "image/png" },
    ],
  };
}
