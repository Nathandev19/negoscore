import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { extractDeal, type ExtractOptions, type ExtractResult } from "@/lib/llm/extract";
import { MODEL } from "@/lib/llm/model";
import { checkFacts, findHallucinations, percentile } from "./scoring.ts";
import type { Expected, FactCheck, Hallucination, Traps } from "./scoring.ts";

// Éval comparative des réglages de latence (missions #032 F et #033 B).
// Même fonction d'extraction que la production (lib/llm/extract.ts : prompt,
// schéma, une reprise si la sortie est invalide), sur toutes les fixtures
// texte, une passe complète par variante, dans l'ordre.
//
//   --experiment=effort     reasoning.effort medium, puis low (mesuré le 17/09/2026)
//   --experiment=verbosity  text.verbosity medium, puis low, effort constant medium
//
// Les valeurs « medium » sont les valeurs par défaut de l'API, envoyées ici
// explicitement. Production depuis le 17/09/2026 : effort non envoyé (medium),
// verbosité « low » (lib/llm/model.ts). Une verbosité peut n'avoir
// aucun effet sur une sortie contrainte par un schéma JSON strict : l'éval le
// montrera, c'est un résultat valable.
//
// CONSOMME DE L'API. Sans --confirm, le script n'appelle rien : il affiche le
// nombre d'appels et le coût estimé, puis s'arrête.
//
// pnpm eval:effort                          → plan seulement, aucun appel
// pnpm eval:verbosity                       → plan seulement, aucun appel
// pnpm eval:verbosity --confirm             → les 26 fixtures × 2 variantes
// pnpm eval:verbosity --confirm --only=15,16,17

const ROOT = process.cwd();
const FIXTURES_DIR = path.join(ROOT, "evals", "fixtures");
const RESULTS_DIR = path.join(ROOT, "evals", "results");

type Variant = { id: string; options: ExtractOptions };

export const EXPERIMENTS: Record<string, Variant[]> = {
  effort: [
    // Verbosité non envoyée : conditions de la mesure du 17/09/2026.
    { id: "effort-medium", options: { reasoningEffort: "medium", textVerbosity: null } },
    { id: "effort-low", options: { reasoningEffort: "low", textVerbosity: null } },
  ],
  verbosity: [
    { id: "verbosity-medium", options: { reasoningEffort: "medium", textVerbosity: "medium" } },
    { id: "verbosity-low", options: { reasoningEffort: "medium", textVerbosity: "low" } },
  ],
};

// Le pire cas qu'on cherche à réparer : les contrats longs, détaillés fixture
// par fixture pour qu'une moyenne ne les noie pas.
export const LONG_CONTRACTS = ["15-contrat-cosmetique", "16-contrat-app-sport", "17-contrat-boisson"];

// Coût moyen mesuré d'une extraction texte, effort medium, sur les 26 fixtures :
// 0,040001 € au total, evals/results/effort-2026-09-17T12-50-01-154Z.json.
const MEASURED_COST_EUR_PER_EXTRACTION = 0.040001 / 26;
// Pire cas facturé par extraction : 2 essais (sortie invalide) × 2 requêtes
// HTTP (une reprise réseau du SDK, maxRetries: 1).
const WORST_CASE_REQUESTS_PER_EXTRACTION = 4;

type Fixture = { name: string; input: string; expected: Expected; traps: Traps };

type Run = {
  fixture: string;
  variant: string;
  error: string | null;
  latencyMs: number;
  attempts: number;
  schemaValidFirstTry: boolean;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  // Coût des extractions abouties. Une extraction en échec est facturée mais
  // son coût n'est pas connu ici : il n'est pas compté.
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

export function plan(fixtureCount: number, variants: Variant[]) {
  const extractions = fixtureCount * variants.length;
  const estimatedEur = extractions * MEASURED_COST_EUR_PER_EXTRACTION;
  const worstRequests = extractions * WORST_CASE_REQUESTS_PER_EXTRACTION;
  return {
    extractions,
    estimatedEur,
    estimatedUsd: estimatedEur * MODEL.usdPerEur,
    worstRequests,
    worstEur: worstRequests * MEASURED_COST_EUR_PER_EXTRACTION,
  };
}

async function runOne(fixture: Fixture, variant: Variant): Promise<Run> {
  const started = performance.now();
  let result: ExtractResult | null = null;
  let error: string | null = null;
  try {
    result = await extractDeal(fixture.input, variant.options);
  } catch (caught) {
    error = (caught instanceof Error ? caught.message : String(caught)).slice(0, 300);
  }
  const facts = checkFacts(result?.extraction ?? null, fixture.expected, fixture.traps);
  return {
    fixture: fixture.name,
    variant: variant.id,
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
  const experiment = args.find((a) => a.startsWith("--experiment="))?.slice("--experiment=".length) ?? "effort";
  const variants = EXPERIMENTS[experiment];
  if (!variants) throw new Error(`Expérience inconnue : ${experiment} (effort ou verbosity).`);
  const only = (args.find((a) => a.startsWith("--only="))?.slice("--only=".length) ?? "").split(",").filter(Boolean);
  const fixtures = loadFixtures(only);
  const p = plan(fixtures.length, variants);

  console.log(`Expérience : ${experiment} · fixtures texte : ${fixtures.length} · variantes : ${variants.map((v) => v.id).join(" puis ")}`);
  console.log(`Extractions : ${p.extractions} (une par fixture et par variante).`);
  console.log(
    `Coût estimé : ${p.estimatedEur.toFixed(3)} € (${p.estimatedUsd.toFixed(3)} $), sur la base de ${MEASURED_COST_EUR_PER_EXTRACTION.toFixed(6)} € mesurés par extraction (effort medium).`,
  );
  console.log(`Pire cas : ${p.worstRequests} requêtes facturées, ${p.worstEur.toFixed(3)} € (chaque extraction reprise deux fois).`);

  if (!args.includes("--confirm")) {
    console.log("Aucun appel lancé. Relancer avec --confirm pour exécuter.");
    return;
  }
  if (!process.env[MODEL.envKey]) throw new Error(`${MODEL.envKey} absente : rien n'a été lancé.`);

  const runs: Run[] = [];
  // Une passe complète par variante, dans l'ordre.
  for (const variant of variants) {
    for (const fixture of fixtures) {
      const run = await runOne(fixture, variant);
      runs.push(run);
      const ok = run.facts.filter((f) => f.ok).length;
      console.log(
        `[${variant.id}] ${fixture.name} — ${run.error ? `ERREUR ${run.error.slice(0, 100)}` : `${run.latencyMs} ms, sortie ${run.outputTokens} jetons (raisonnement ${run.reasoningTokens}), faits ${ok}/${run.facts.length}, hallucinations ${run.hallucinations.length}`}`,
      );
    }
  }

  const byVariant = Object.fromEntries(variants.map((v) => [v.id, summary(runs.filter((r) => r.variant === v.id))]));
  const [reference, candidate] = variants;
  // Faits qui changent d'une passe à l'autre : c'est là que se lit le prix d'un réglage plus bas.
  const differences = fixtures.flatMap((fixture) => {
    const a = runs.find((r) => r.fixture === fixture.name && r.variant === reference.id);
    const b = runs.find((r) => r.fixture === fixture.name && r.variant === candidate.id);
    if (!a || !b) return [];
    return a.facts
      .filter((fact) => fact.ok !== b.facts.find((f) => f.fact === fact.fact)?.ok)
      .map((fact) => ({ fixture: fixture.name, fact: fact.fact, [reference.id]: fact.ok, [candidate.id]: !fact.ok }));
  });
  const longContracts = LONG_CONTRACTS.filter((name) => fixtures.some((f) => f.name === name)).map((name) => ({
    fixture: name,
    ...Object.fromEntries(
      variants.map((v) => {
        const run = runs.find((r) => r.fixture === name && r.variant === v.id);
        return [v.id, run ? { latencyMs: run.latencyMs, outputTokens: run.outputTokens, reasoningTokens: run.reasoningTokens, error: run.error } : null];
      }),
    ),
  }));

  mkdirSync(RESULTS_DIR, { recursive: true });
  const file = path.join(RESULTS_DIR, `${experiment}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, `${JSON.stringify({ model: MODEL.id, experiment, variants, byVariant, longContracts, differences, runs }, null, 2)}\n`);

  console.log("\n| Variante | Faits exacts | Hallucinations | Schéma 1er essai | Latence p50 / p95 | Sortie moyenne (dont raisonnement) | Coût total | Erreurs |");
  console.log("|---|---|---|---|---|---|---|---|");
  for (const v of variants) {
    const s = byVariant[v.id];
    console.log(
      `| ${v.id} | ${s.factAccuracyPct} % | ${s.hallucinations} | ${s.schemaFirstTryPct} % | ${s.latencyP50Ms} / ${s.latencyP95Ms} ms | ${s.meanOutputTokens} (${s.meanReasoningTokens}) | ${s.totalCostEur} € | ${s.errors} |`,
    );
  }
  console.log(`\nContrats longs (pire cas), latence et jetons de sortie par variante :`);
  console.log(`| Fixture | ${variants.map((v) => `${v.id} latence | ${v.id} sortie`).join(" | ")} |`);
  console.log(`|---|${variants.map(() => "---|---").join("|")}|`);
  for (const row of longContracts) {
    const cells = variants.map((v) => {
      const cell = (row as Record<string, unknown>)[v.id] as { latencyMs: number; outputTokens: number; error: string | null } | null;
      return cell && !cell.error ? `${cell.latencyMs} ms | ${cell.outputTokens}` : "erreur | —";
    });
    console.log(`| ${row.fixture} | ${cells.join(" | ")} |`);
  }
  console.log(`\nFaits qui diffèrent entre ${reference.id} et ${candidate.id} : ${differences.length}`);
  for (const d of differences) {
    console.log(`- ${d.fixture} · ${d.fact} : ${reference.id} ${d[reference.id] ? "ok" : "faux"}, ${candidate.id} ${d[candidate.id] ? "ok" : "faux"}`);
  }
  console.log(`\nRésultats : ${path.relative(ROOT, file)}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
