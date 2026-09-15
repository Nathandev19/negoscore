import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { extractionSchema } from "../lib/llm/prompt.ts";
import { CANDIDATES, costUsd, USD_PER_EUR } from "./candidates.ts";
import type { CallResult, Candidate } from "./candidates.ts";
import { checkFacts, findHallucinations, percentile } from "./scoring.ts";
import type { Expected, FactCheck, Hallucination, Traps } from "./scoring.ts";

// pnpm eval                       → les 20 fixtures, les 3 candidats
// pnpm eval --only=01,18          → fixtures dont le nom commence par ces préfixes

const ROOT = process.cwd();
const FIXTURES_DIR = path.join(ROOT, "evals", "fixtures");
const RESULTS_DIR = path.join(ROOT, "evals", "results");
const TEMPERATURE = 0;

type Fixture = { name: string; input: string; expected: Expected; traps: Traps };

type RunRecord = {
  fixture: string;
  error: string | null;
  latencyMs: number;
  tokens: Omit<CallResult, "text"> | null;
  costUsd: number;
  schemaValid: boolean;
  schemaIssues: string[];
  facts: FactCheck[];
  hallucinations: Hallucination[];
  rawOutput: string;
};

type CandidateReport = {
  id: string;
  skipped: string | null;
  temperature: string;
  runs: RunRecord[];
  metrics: {
    criticalFactExtraction: number;
    forbiddenHallucinations: number;
    schemaValidity: number;
    latencyP50Ms: number;
    latencyP95Ms: number;
    costPerAnalysisUsd: number;
    costPerAnalysisEur: number;
  } | null;
  pricingSource: string;
};

function loadFixtures(only: string[]): Fixture[] {
  return readdirSync(FIXTURES_DIR)
    .filter((name) => only.length === 0 || only.some((prefix) => name.startsWith(prefix)))
    .sort()
    .map((name) => {
      const dir = path.join(FIXTURES_DIR, name);
      return {
        name,
        input: readFileSync(path.join(dir, "input.txt"), "utf8"),
        expected: JSON.parse(readFileSync(path.join(dir, "expected.json"), "utf8")) as Expected,
        traps: JSON.parse(readFileSync(path.join(dir, "traps.json"), "utf8")) as Traps,
      };
    });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isTemperatureRejection(error: unknown): boolean {
  const status = (error as { status?: number; code?: number }).status ?? (error as { code?: number }).code;
  return (status === 400 || status === undefined) && /temperature/i.test(errorMessage(error));
}

async function evaluateCandidate(candidate: Candidate, fixtures: Fixture[]): Promise<CandidateReport> {
  const report: CandidateReport = {
    id: candidate.id,
    skipped: null,
    temperature: String(TEMPERATURE),
    runs: [],
    metrics: null,
    pricingSource: candidate.pricing.source,
  };
  if (!process.env[candidate.envKey]) {
    report.skipped = `${candidate.envKey} absente : candidat ignoré.`;
    return report;
  }

  let temperature: number | undefined = TEMPERATURE;
  for (const fixture of fixtures) {
    const started = performance.now();
    let result: CallResult | null = null;
    let error: string | null = null;
    try {
      try {
        result = await candidate.call(fixture.input, { temperature });
      } catch (first) {
        if (temperature === undefined || !isTemperatureRejection(first)) throw first;
        // Le modèle refuse le paramètre : on le retire pour toute la suite et on le note.
        temperature = undefined;
        report.temperature = `refusée par l'API (${errorMessage(first).slice(0, 160)}) — valeur par défaut du modèle`;
        result = await candidate.call(fixture.input, { temperature });
      }
    } catch (caught) {
      error = errorMessage(caught).slice(0, 500);
    }
    const latencyMs = Math.round(performance.now() - started);

    let parsed: unknown = null;
    let schemaValid = false;
    let schemaIssues: string[] = [];
    if (result) {
      try {
        parsed = JSON.parse(result.text);
        const validation = extractionSchema.safeParse(parsed);
        schemaValid = validation.success;
        schemaIssues = validation.success
          ? []
          : validation.error.issues.slice(0, 10).map((i) => `${i.path.join(".")}: ${i.message}`);
      } catch {
        schemaIssues = ["JSON illisible"];
      }
    }

    const facts = checkFacts(parsed, fixture.expected, fixture.traps);
    const hallucinations = parsed === null ? [] : findHallucinations(parsed, fixture.input, fixture.traps);
    const run: RunRecord = {
      fixture: fixture.name,
      error,
      latencyMs,
      tokens: result
        ? {
            inputTokens: result.inputTokens,
            cachedInputTokens: result.cachedInputTokens,
            outputTokens: result.outputTokens,
          }
        : null,
      costUsd: result ? costUsd(candidate, result) : 0,
      schemaValid,
      schemaIssues,
      facts: result ? facts : facts.map((f) => ({ ...f, ok: false })),
      hallucinations,
      rawOutput: result?.text ?? "",
    };
    report.runs.push(run);
    console.log(
      `[${candidate.id}] ${fixture.name} — ${error ? `ERREUR ${error.slice(0, 120)}` : `${latencyMs} ms, schéma ${schemaValid ? "ok" : "KO"}, faits ${run.facts.filter((f) => f.ok).length}/${run.facts.length}, hallucinations ${hallucinations.length}`}`,
    );
  }

  const answered = report.runs.filter((r) => r.tokens !== null);
  const allFacts = report.runs.flatMap((r) => r.facts);
  report.metrics = {
    criticalFactExtraction: round1((100 * allFacts.filter((f) => f.ok).length) / Math.max(1, allFacts.length)),
    forbiddenHallucinations: report.runs.reduce((sum, r) => sum + r.hallucinations.length, 0),
    schemaValidity: round1((100 * report.runs.filter((r) => r.schemaValid).length) / Math.max(1, report.runs.length)),
    latencyP50Ms: percentile(answered.map((r) => r.latencyMs), 50),
    latencyP95Ms: percentile(answered.map((r) => r.latencyMs), 95),
    costPerAnalysisUsd: round6(answered.reduce((sum, r) => sum + r.costUsd, 0) / Math.max(1, answered.length)),
    costPerAnalysisEur: round6(
      answered.reduce((sum, r) => sum + r.costUsd, 0) / Math.max(1, answered.length) / USD_PER_EUR,
    ),
  };
  return report;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

// Règle de sélection, dans l'ordre :
// 1. zéro hallucination interdite ; 2. schéma valide >= 95 % ;
// 3. meilleure extraction des faits critiques ; 4. à moins de 3 points, le moins cher.
function select(reports: CandidateReport[]): { winner: string | null; reason: string } {
  const eligible = reports.filter(
    (r) => r.metrics && r.metrics.forbiddenHallucinations === 0 && r.metrics.schemaValidity >= 95,
  );
  if (eligible.length === 0) return { winner: null, reason: "Aucun candidat ne passe les critères 1 et 2." };
  const best = Math.max(...eligible.map((r) => r.metrics?.criticalFactExtraction ?? 0));
  const close = eligible.filter((r) => best - (r.metrics?.criticalFactExtraction ?? 0) < 3);
  close.sort((a, b) => (a.metrics?.costPerAnalysisUsd ?? 0) - (b.metrics?.costPerAnalysisUsd ?? 0));
  const winner = close[0];
  const reason =
    close.length > 1
      ? `Critère 4 : ${close.map((r) => r.id).join(", ")} à moins de 3 points de ${best} %, le moins cher gagne.`
      : eligible.length > 1
        ? `Critère 3 : meilleure extraction des faits critiques (${best} %).`
        : "Seul candidat à passer les critères 1 et 2.";
  return { winner: winner.id, reason };
}

function table(reports: CandidateReport[]): string {
  const lines = [
    "| Candidat | Faits critiques | Hallucinations interdites | Schéma valide 1er coup | Latence p50 / p95 | Coût par analyse | Statut |",
    "|---|---|---|---|---|---|---|",
  ];
  for (const r of reports) {
    if (!r.metrics) {
      lines.push(`| ${r.id} | — | — | — | — | — | ${r.skipped} |`);
      continue;
    }
    const m = r.metrics;
    const status = m.forbiddenHallucinations > 0 ? "DISQUALIFIÉ" : m.schemaValidity < 95 ? "Schéma < 95 %" : "Éligible";
    lines.push(
      `| ${r.id} | ${m.criticalFactExtraction} % | ${m.forbiddenHallucinations} | ${m.schemaValidity} % | ${m.latencyP50Ms} / ${m.latencyP95Ms} ms | ${m.costPerAnalysisUsd.toFixed(5)} $ / ${m.costPerAnalysisEur.toFixed(5)} € | ${status} |`,
    );
  }
  return lines.join("\n");
}

async function main() {
  const onlyArg = process.argv.find((arg) => arg.startsWith("--only="));
  const only = onlyArg ? onlyArg.slice("--only=".length).split(",").filter(Boolean) : [];
  const fixtures = loadFixtures(only);
  console.log(`${fixtures.length} fixtures, ${CANDIDATES.length} candidats, température demandée ${TEMPERATURE}.`);

  const reports = await Promise.all(CANDIDATES.map((candidate) => evaluateCandidate(candidate, fixtures)));
  const selection = select(reports);

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  mkdirSync(RESULTS_DIR, { recursive: true });
  const file = path.join(RESULTS_DIR, `${timestamp}.json`);
  writeFileSync(
    file,
    JSON.stringify({ timestamp, fixtures: fixtures.map((f) => f.name), usdPerEur: USD_PER_EUR, selection, reports }, null, 2),
  );

  console.log(`\n${table(reports)}\n`);
  for (const r of reports) console.log(`Température ${r.id} : ${r.skipped ?? r.temperature}`);
  console.log(`\nSélection : ${selection.winner ?? "aucun"} — ${selection.reason}`);
  console.log(`Résultats : ${path.relative(ROOT, file)}`);
}

main().catch((error: unknown) => {
  console.error(errorMessage(error));
  process.exit(1);
});
