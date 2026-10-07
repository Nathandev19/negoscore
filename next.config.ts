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
    // /offres est devenue /tarifs (mission #046 : « offre » désigne ce que la
    // marque propose, jamais ce qu'on vend). Redirection permanente : d'anciens
    // liens existent dans des emails déjà envoyés. Les paramètres (?erreur=…)
    // sont transmis tels quels.
    // Mission #158 — /droits-d-utilisation n'a jamais existé : c'est la
    // variante avec tiret que des gens tapent et que des liens portent, et
    // elle répondait « page introuvable ». Redirection permanente, comme
    // /offres.
    //
    // DÉCISION DU 07/10/2026, TRANCHÉE : nos redirections permanentes sont des
    // 308, et le restent. `permanent: true` est le permanent de Next — celui
    // qui préserve la méthode HTTP — et il sert 308, pas 301 (mesuré sur le
    // serveur). Google traite les deux à l'identique, et /offres s'écrit ainsi
    // depuis la #046 : écrire une redirection autrement que les autres ne
    // gagnerait rien et coûterait la cohérence.
    //
    // Une mission qui demande « 301 » demande une redirection PERMANENTE. Ce
    // n'est pas une question ouverte : ne pas la rouvrir, ne pas proposer
    // `statusCode: 301`. tests/guides-reference.test.tsx vérifie que l'entrée
    // existe et qu'elle est déclarée permanente.
    redirects: async () => [
      { source: "/offres", destination: "/tarifs", permanent: true },
      { source: "/droits-d-utilisation", destination: "/droits-utilisation", permanent: true },
    ],
    // Routes privées qui ne sont pas des pages (images, API, étapes de connexion) :
    // jamais indexées, même si une adresse circule (mission #047). Les pages
    // privées portent en plus robots noindex dans leurs métadonnées.
    headers: async () =>
      ["/analyse/resultat/:path*", "/api/:path*", "/auth/:path*"].map((source) => ({
        source,
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      })),
  };
}
