import { defineConfig } from "vitest/config";

// Mission #201, chantier C — DEUX ENVIRONNEMENTS, PAS UN.
//
// Les 158 fichiers de test existants tournent sous Node : c'est plus rapide,
// et ils n'ont rien à faire d'un DOM. Les tests de clic, eux, en ont besoin.
// Vitest 5 n'a plus `environmentMatchGlobs` : la séparation se déclare en
// projets, et c'est le NOM du fichier qui décide — « .dom.test.tsx ».
// Mission #210 — LE DÉLAI PAR DÉFAUT DE VITEST N'ÉTAIT PAS UN CHOIX.
//
// Les cinq secondes de `testTimeout` sont la valeur par défaut de Vitest.
// Plusieurs tests de ce dépôt rendent TOUTES les pages publiques côté serveur,
// ou traversent la chaîne d'authentification entière : mesurés à 4,2 s et
// 4,4 s, ils frôlaient la limite depuis un moment. Trois fichiers de plus
// ajoutés par cette mission ont suffi à les faire basculer — deux passages
// consécutifs, deux échecs différents, aucun lié à une assertion.
//
// Une suite instable est pire qu'une suite lente : elle apprend à relancer
// jusqu'au vert, et c'est comme ça qu'un vrai échec passe inaperçu.
//
// CE QUE CETTE LIGNE NE FAIT PAS : elle ne rend aucun test plus rapide, et
// elle n'affaiblit aucune assertion. Si un test vient un jour à réellement
// demander vingt secondes, c'est qu'il y a autre chose à regarder.
const DELAI_MS = 20_000;

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    testTimeout: DELAI_MS,
    hookTimeout: DELAI_MS,
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          include: ["tests/**/*.test.{ts,tsx}"],
          exclude: ["tests/**/*.dom.test.tsx"],
        },
      },
      {
        extends: true,
        test: {
          name: "dom",
          include: ["tests/**/*.dom.test.tsx"],
          environment: "jsdom",
          setupFiles: ["./tests/setup-dom.ts"],
        },
      },
    ],
  },
});
