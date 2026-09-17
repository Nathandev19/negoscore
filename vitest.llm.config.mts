import { defineConfig } from "vitest/config";

// Invariants d'extraction qui appellent le modèle (coût API).
// pnpm test:llm — jamais lancés par pnpm test ni par pnpm test:integration.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    include: ["tests-integration/extraction-invariants.test.ts", "tests-integration/extraction-pdf.test.ts"],
    env: { RUN_LLM_INVARIANTS: "1" },
    testTimeout: 180_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
