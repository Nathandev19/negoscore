import { defineConfig } from "vitest/config";

// Tests contre le projet Supabase configuré dans l'environnement.
// pnpm test:integration (les migrations doivent être appliquées).
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: { include: ["tests-integration/**/*.test.ts"], testTimeout: 60_000, hookTimeout: 60_000, fileParallelism: false },
});
