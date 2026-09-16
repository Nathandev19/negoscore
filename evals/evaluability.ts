import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { evaluability } from "../lib/analysis/evaluability.ts";
import type { Analysis } from "../lib/schema.ts";

// Relevé d'évaluabilité sur les sorties enregistrées des 20 fixtures texte,
// sans rappeler aucune API. C'est une mesure, pas un réglage de la règle.
// node evals/evaluability.ts [evals/results/<timestamp>.json]

type Run = { fixture: string; rawOutput: unknown };
type Report = { id: string; runs?: Run[] };

const RESULTS_DIR = path.join("evals", "results");
const file =
  process.argv[2] ??
  path.join(
    RESULTS_DIR,
    readdirSync(RESULTS_DIR)
      .filter((name) => /^\d{4}-.*Z\.json$/.test(name))
      .sort()
      .at(-1) ?? "",
  );
const results = JSON.parse(readFileSync(file, "utf8")) as { reports: Report[] };
console.log(`Fichier : ${file}`);

function readDeal(raw: unknown): Analysis["deal"] | null {
  try {
    const output = (typeof raw === "string" ? JSON.parse(raw) : raw) as { deal?: Analysis["deal"] } | null;
    return output?.deal ?? null;
  } catch {
    return null;
  }
}

for (const report of results.reports) {
  const counts = { complete: 0, unpriced: 0, incomplete: 0, illisible: 0 };
  const notComplete: string[] = [];
  for (const run of report.runs ?? []) {
    const deal = readDeal(run.rawOutput);
    if (!deal) {
      counts.illisible += 1;
      notComplete.push(`${run.fixture} : sortie illisible`);
      continue;
    }
    const state = evaluability(deal);
    counts[state] += 1;
    if (state !== "complete") {
      const usage = Object.entries(deal.usage)
        .filter(([key, value]) => key !== "duration_months" && key !== "territory" && value === true)
        .map(([key]) => key);
      notComplete.push(
        `${run.fixture} : ${state} (livrables ${deal.deliverables.length}, usage [${usage.join(", ")}], montant ${deal.payment.amount_eur ?? "null"}, produits ${deal.in_kind_value_eur ?? "null"})`,
      );
    }
  }
  console.log(`\n${report.id} : ${JSON.stringify(counts)}`);
  for (const line of notComplete) console.log(`  ${line}`);
}
