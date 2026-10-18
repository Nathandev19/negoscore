import { defineConfig } from "vitest/config";

// Mission #201, chantier C — DEUX ENVIRONNEMENTS, PAS UN.
//
// Les 158 fichiers de test existants tournent sous Node : c'est plus rapide,
// et ils n'ont rien à faire d'un DOM. Les tests de clic, eux, en ont besoin.
// Vitest 5 n'a plus `environmentMatchGlobs` : la séparation se déclare en
// projets, et c'est le NOM du fichier qui décide — « .dom.test.tsx ».
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
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
