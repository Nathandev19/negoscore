import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { extractDeal, type ExtractResult } from "@/lib/llm/extract";
import { MODEL, type ReasoningEffort } from "@/lib/llm/model";
import { checkFacts, findHallucinations, percentile } from "./scoring.ts";
import type { Expected, FactCheck, Hallucination, Traps } from "./scoring.ts";

// Éval comparative de l'effort de raisonnement (mission #032, partie F).
// Même fonction d'extraction que la production (lib/llm/extract.ts : prompt,
// schéma, une reprise si la sortie est invalide), sur toutes les fixtures
// texte, d'abord avec « medium » (la valeur par défaut de l'API, donc la
// production actuelle, envoyée ici explicitement), puis avec « low ».
//
// CONSOMME DE L'API. Sans --confirm, le script n'appelle rien : il affiche le
// nombre d'appels et le coût estimé, puis s'arrête.
//
// pnpm eval:effort                       → plan seulement, aucun appel
// pnpm eval:effort --confirm             → les 26 fixtures × 2 efforts
// pnpm eval:effort --confirm --only=01,18

const ROOT = process.cwd();
const FIXTURES_DIR = path.join(ROOT, "evals", "fixtures");
const RESULTS_DIR = path.join(ROOT, "evals", "results");
export const EFFORTS: ReasoningEffort[] = ["medium", "low"];

// Coût moyen mesuré d'une extraction texte avec ce modèle (effort par défaut) :
// 0,001979 $ sur 20 fixtures, evals/results/2026-09-15T07-45-12-414Z.json.
const MEASURED_COST_USD_PER_CALL = 0.001979;
// Pire cas facturé par extraction : 2 essais (sortie invalide) × 2 requêtes
// HTTP (une reprise réseau du SDK, maxRetries: 1).
const WORST_CASE_REQUESTS_PER_EXTRACTION = 4;

type Fixture = { name: string; input: string; expected: Expected; traps: Traps };

type Run = {
  fixture: string;
  effort: ReasoningEffort;
  error: string | null;
  latencyMs: number;
  attempts: number;
  schemaValidFirstTry: boolean;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  costEur: number;
  facts: FactCheck[];
  hallucinations: Hallucination[];
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

export function plan(fixtureCount: number) {
  const extractions = fixtureCount * EFFORTS.length;
  const estimatedUsd = extractions * MEASURED_COST_USD_PER_CALL;
  const worstRequests = extractions * WORST_CASE_REQUESTS_PER_EXTRACTION;
  return {
    extractions,
    estimatedUsd,
    estimatedEur: estimatedUsd / MODEL.usdPerEur,
    worstRequests,
    worstUsd: worstRequests * MEASURED_COST_USD_PER_CALL,
  };
}

async function runOne(fixture: Fixture, effort: ReasoningEffort): Promise<Run> {
  const started = performance.now();
  let result: ExtractResult | null = null;
  let error: string | null = null;
  try {
    result = await extractDeal(fixture.input, { reasoningEffort: effort });
  } catch (caught) {
    error = (caught instanceof Error ? caught.message : String(caught)).slice(0, 300);
  }
  const facts = checkFacts(result?.extraction ?? null, fixture.expected, fixture.traps);
  return {
    fixture: fixture.name,
    effort,
    error,
    latencyMs: result?.latencyMs ?? Math.round(performance.now() - started),
    attempts: result?.attempts ?? 0,
    schemaValidFirstTry: result?.schemaValidFirstTry ?? false,
    inputTokens: result?.inputTokens ?? 0,
    outputTokens: result?.outputTokens ?? 0,
    reasoningTokens: result?.reasoningTokens ?? 0,
    costEur: result?.costEur ?? 0,
    facts: result ? facts : facts.map((f) => ({ ...f, ok: false })),
    hallucinations: result ? findHallucinations(result.extraction, fixture.input, fixture.traps) : [],
  };
}

function summary(runs: Run[]) {
  const answered = runs.filter((r) => r.error === null);
  const facts = runs.flatMap((r) => r.facts);
  const mean = (values: number[]) => Math.round(values.reduce((a, b) => a + b, 0) / Math.max(1, values.length));
  return {
    runs: runs.length,
    errors: runs.length - answered.length,
    factAccuracyPct: Math.round((1000 * facts.filter((f) => f.ok).length) / Math.max(1, facts.length)) / 10,
    hallucinations: runs.reduce((sum, r) => sum + r.hallucinations.length, 0),
    schemaFirstTryPct: Math.round((1000 * answered.filter((r) => r.schemaValidFirstTry).length) / Math.max(1, answered.length)) / 10,
    retries: answered.filter((r) => r.attempts > 1).length,
    latencyP50Ms: percentile(answered.map((r) => r.latencyMs), 50),
    latencyP95Ms: percentile(answered.map((r) => r.latencyMs), 95),
    meanOutputTokens: mean(answered.map((r) => r.outputTokens)),
    meanReasoningTokens: mean(answered.map((r) => r.reasoningTokens)),
    totalCostEur: Math.round(answered.reduce((sum, r) => sum + r.costEur, 0) * 1_000_000) / 1_000_000,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const only = (args.find((a) => a.startsWith("--only="))?.slice("--only=".length) ?? "").split(",").filter(Boolean);
  const fixtures = loadFixtures(only);
  const p = plan(fixtures.length);

  console.log(`Fixtures texte : ${fixtures.length} · efforts : ${EFFORTS.join(" puis ")}`);
  console.log(`Extractions : ${p.extractions} (une par fixture et par effort).`);
  console.log(`Coût estimé : ${p.estimatedUsd.toFixed(3)} $ (${p.estimatedEur.toFixed(3)} €), sur la base de ${MEASURED_COST_USD_PER_CALL} $ mesurés par extraction.`);
  console.log(`Pire cas : ${p.worstRequests} requêtes facturées, ${p.worstUsd.toFixed(3)} $ (chaque extraction reprise deux fois).`);

  if (!args.includes("--confirm")) {
    console.log("Aucun appel lancé. Relancer avec --confirm pour exécuter.");
    return;
  }
  if (!process.env[MODEL.envKey]) throw new Error(`${MODEL.envKey} absente : rien n'a été lancé.`);

  const runs: Run[] = [];
  // Une passe complète par effort, dans l'ordre demandé : medium, puis low.
  for (const effort of EFFORTS) {
    for (const fixture of fixtures) {
      const run = await runOne(fixture, effort);
      runs.push(run);
      const ok = run.facts.filter((f) => f.ok).length;
      console.log(
        `[${effort}] ${fixture.name} — ${run.error ? `ERREUR ${run.error.slice(0, 100)}` : `${run.latencyMs} ms, sortie ${run.outputTokens} jetons (raisonnement ${run.reasoningTokens}), faits ${ok}/${run.facts.length}, hallucinations ${run.hallucinations.length}`}`,
      );
    }
  }

  const byEffort = Object.fromEntries(EFFORTS.map((effort) => [effort, summary(runs.filter((r) => r.effort === effort))]));
  // Faits qui changent d'une passe à l'autre : c'est là que se lit le prix d'un effort plus bas.
  const regressions = fixtures.flatMap((fixture) => {
    const medium = runs.find((r) => r.fixture === fixture.name && r.effort === "medium");
    const low = runs.find((r) => r.fixture === fixture.name && r.effort === "low");
    if (!medium || !low) return [];
    return medium.facts
      .filter((fact) => fact.ok !== low.facts.find((f) => f.fact === fact.fact)?.ok)
      .map((fact) => ({ fixture: fixture.name, fact: fact.fact, medium: fact.ok, low: !fact.ok }));
  });

  mkdirSync(RESULTS_DIR, { recursive: true });
  const file = path.join(RESULTS_DIR, `effort-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, `${JSON.stringify({ model: MODEL.id, efforts: EFFORTS, byEffort, regressions, runs }, null, 2)}\n`);

  console.log("\n| Effort | Faits exacts | Hallucinations | Schéma 1er essai | Latence p50 / p95 | Sortie moyenne (dont raisonnement) | Coût total | Erreurs |");
  console.log("|---|---|---|---|---|---|---|---|");
  for (const effort of EFFORTS) {
    const s = byEffort[effort];
    console.log(
      `| ${effort} | ${s.factAccuracyPct} % | ${s.hallucinations} | ${s.schemaFirstTryPct} % | ${s.latencyP50Ms} / ${s.latencyP95Ms} ms | ${s.meanOutputTokens} (${s.meanReasoningTokens}) | ${s.totalCostEur} € | ${s.errors} |`,
    );
  }
  console.log(`\nFaits qui diffèrent entre medium et low : ${regressions.length}`);
  for (const r of regressions) console.log(`- ${r.fixture} · ${r.fact} : medium ${r.medium ? "ok" : "faux"}, low ${r.low ? "ok" : "faux"}`);
  console.log(`\nRésultats : ${path.relative(ROOT, file)}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
