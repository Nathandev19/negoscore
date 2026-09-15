import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { findHallucinations } from "./scoring.ts";
import type { Hallucination, Traps } from "./scoring.ts";

// Recalcule FORBIDDEN_HALLUCINATIONS sur un fichier de résultats déjà
// enregistré, à partir des sorties brutes. Aucun appel aux API.
//
// pnpm eval:rescore                                   → dernier fichier de evals/results
// pnpm eval:rescore evals/results/<timestamp>.json    → fichier donné

const ROOT = process.cwd();
const RESULTS_DIR = path.join(ROOT, "evals", "results");

type Run = { fixture: string; rawOutput: string; hallucinations: Hallucination[] };
type Report = { id: string; runs: Run[]; metrics: { forbiddenHallucinations: number } | null };
type ResultsFile = { timestamp: string; reports: Report[] };

function latestResults(): string {
  const files = readdirSync(RESULTS_DIR)
    .filter((name) => /^\d{4}-\d{2}-\d{2}T[\d-]+Z\.json$/.test(name))
    .sort();
  if (files.length === 0) throw new Error("Aucun fichier de résultats dans evals/results.");
  return path.join(RESULTS_DIR, files[files.length - 1]);
}

function fixtureDir(name: string): string {
  for (const base of ["fixtures", "fixtures-vision"]) {
    const dir = path.join(ROOT, "evals", base, name);
    try {
      readdirSync(dir);
      return dir;
    } catch {
      // essaie le dossier suivant
    }
  }
  throw new Error(`Fixture introuvable : ${name}`);
}

function main() {
  const file = process.argv[2] ? path.resolve(ROOT, process.argv[2]) : latestResults();
  const results = JSON.parse(readFileSync(file, "utf8")) as ResultsFile;

  const lines = ["| Candidat | Avant | Après | Détail après |", "|---|---|---|---|"];
  const rescored = results.reports.map((report) => {
    let before = 0;
    let after = 0;
    const details: string[] = [];
    const runs = report.runs.map((run) => {
      before += run.hallucinations.length;
      const dir = fixtureDir(run.fixture);
      const traps = JSON.parse(readFileSync(path.join(dir, "traps.json"), "utf8")) as Traps;
      const inputPath = path.join(dir, "input.txt");
      const input = readFileSync(inputPath, "utf8");
      let parsed: unknown = null;
      try {
        parsed = run.rawOutput ? JSON.parse(run.rawOutput) : null;
      } catch {
        parsed = null;
      }
      const hallucinations = parsed === null ? [] : findHallucinations(parsed, input, traps);
      after += hallucinations.length;
      for (const h of hallucinations) details.push(`${run.fixture} [${h.kind}] ${h.detail}`);
      return { fixture: run.fixture, before: run.hallucinations, after: hallucinations };
    });
    lines.push(`| ${report.id} | ${before} | ${after} | ${details.join(" ; ") || "—"} |`);
    return { id: report.id, forbiddenHallucinationsBefore: before, forbiddenHallucinationsAfter: after, runs };
  });

  const out = file.replace(/\.json$/, "-rescore-hallucinations.json");
  writeFileSync(out, JSON.stringify({ source: path.relative(ROOT, file), rescored }, null, 2));
  console.log(`Source : ${path.relative(ROOT, file)}\n`);
  console.log(lines.join("\n"));
  console.log(`\nRésultats : ${path.relative(ROOT, out)}`);
}

main();
