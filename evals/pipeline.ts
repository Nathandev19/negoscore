import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { composeAnalysis } from "@/lib/analysis/compose";
import { extractDeal } from "@/lib/llm/extract";

// Régénère evals/results/pipeline/ : même extraction et même composition que
// la route /api/analyse, sans base de données ni limite d'usage.
//
// pnpm eval:pipeline                    → 04, 18 et 17
// pnpm eval:pipeline 07-email-biscuits  → fixtures données

const ROOT = process.cwd();
const DEFAULT = ["04-dm-vague-droits", "18-piege-perpetuite", "17-contrat-boisson"];

async function main() {
  const names = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT;
  const outDir = path.join(ROOT, "evals", "results", "pipeline");
  mkdirSync(outDir, { recursive: true });
  for (const name of names) {
    const input = readFileSync(path.join(ROOT, "evals", "fixtures", name, "input.txt"), "utf8");
    const result = await extractDeal(input);
    const analysis = composeAnalysis(result.extraction);
    writeFileSync(path.join(outDir, `${name}.json`), `${JSON.stringify({ analysis }, null, 2)}\n`);
    const e = analysis.estimate;
    console.log(
      `${name} — ${result.latencyMs} ms, ${result.costEur.toFixed(6)} €, offre ${analysis.deal.payment.amount_eur ?? "—"} €, fourchette ${e.total_low ?? "—"}–${e.total_high ?? "—"} €, score ${analysis.score.value}, confiance ${analysis.confidence}`,
    );
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
