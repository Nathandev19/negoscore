import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

const DEFAULT_PAGE_EXTENSIONS = ["tsx", "ts", "jsx", "js"];

// Pages et routes réservées au développement : fichiers `page.dev.tsx` et `route.dev.ts` (prévisualisation
// de la page de résultat, app/dev/). L'extension `dev.tsx` n'est reconnue que
// par `next dev` ; au build de production, `page.dev.tsx` n'est pas une page et
// la route n'existe pas. Vérifié par tests/dev-preview.test.ts.
export function pageExtensionsFor(phase: string): string[] {
  return phase === PHASE_DEVELOPMENT_SERVER ? ["dev.tsx", "dev.ts", ...DEFAULT_PAGE_EXTENSIONS] : DEFAULT_PAGE_EXTENSIONS;
}

export default function config(phase: string): NextConfig {
  return {
    pageExtensions: pageExtensionsFor(phase),
    // Interrupteur de maintenance copié au build pour le formulaire (pages
    // statiques). La route d'analyse relit ANALYSIS_PAUSED à chaque requête.
    env: { NEXT_PUBLIC_ANALYSIS_PAUSED: process.env.ANALYSIS_PAUSED === "1" ? "1" : "" },
    // Polices à graisse fixe de la carte partageable, lues depuis le disque par
    // la route : incluses explicitement dans le paquet déployé.
    outputFileTracingIncludes: { "/analyse/resultat/*/carte": ["./assets/fonts/*.ttf"] },
  };
}
