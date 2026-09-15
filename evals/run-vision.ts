import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { extractionSchema } from "../lib/llm/prompt.ts";
import { CANDIDATES, costUsd, USD_PER_EUR } from "./candidates.ts";
import type { CallResult, Candidate } from "./candidates.ts";
import { checkFacts, findHallucinations, percentile } from "./scoring.ts";
import type { Expected, FactCheck, Hallucination, Traps } from "./scoring.ts";

// pnpm eval:vision   → les 8 captures de evals/fixtures-vision, Luna et Gemini.
// Mêmes 5 mesures qu'en texte. Chaque capture est notée avec expected.json et
// traps.json de la fixture texte dont elle est issue.

const ROOT = process.cwd();
const VISION_DIR = path.join(ROOT, "evals", "fixtures-vision");
const TEXT_DIR = path.join(ROOT, "evals", "fixtures");
const RESULTS_DIR = path.join(ROOT, "evals", "results");
const TEMPERATURE = 0;
const VISION_CANDIDATES = ["openai/gpt-5.6-luna", "google/gemini-3.6-flash"];

type Fixture = {
  name: string;
  source: string;
  degradation: string;
  image: { base64: string; mimeType: string };
  sourceText: string;
  expected: Expected;
  traps: Traps;
};

type RunRecord = {
  fixture: string;
  source: string;
  degradation: string;
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

type Metrics = {
  criticalFactExtraction: number;
  forbiddenHallucinations: number;
  schemaValidity: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
  costPerAnalysisUsd: number;
  costPerAnalysisEur: number;
};

type CandidateReport = { id: string; skipped: string | null; temperature: string; runs: RunRecord[]; metrics: Metrics | null };

function loadFixtures(): Fixture[] {
  return readdirSync(VISION_DIR)
    .filter((name) => /^v\d{2}-/.test(name))
    .sort()
    .map((name) => {
      const dir = path.join(VISION_DIR, name);
      const { source, degradation } = JSON.parse(readFileSync(path.join(dir, "source.json"), "utf8")) as {
        source: string;
        degradation: string;
      };
      const textDir = path.join(TEXT_DIR, source);
      return {
        name,
        source,
        degradation,
        image: { base64: readFileSync(path.join(dir, "input.png")).toString("base64"), mimeType: "image/png" },
        sourceText: readFileSync(path.join(textDir, "input.txt"), "utf8"),
        expected: JSON.parse(readFileSync(path.join(textDir, "expected.json"), "utf8")) as Expected,
        traps: JSON.parse(readFileSync(path.join(textDir, "traps.json"), "utf8")) as Traps,
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

const round1 = (value: number) => Math.round(value * 10) / 10;
const round6 = (value: number) => Math.round(value * 1_000_000) / 1_000_000;

async function evaluate(candidate: Candidate, fixtures: Fixture[]): Promise<CandidateReport> {
  const report: CandidateReport = { id: candidate.id, skipped: null, temperature: String(TEMPERATURE), runs: [], metrics: null };
  if (!process.env[candidate.envKey]) {
    report.skipped = `${candidate.envKey} absente : candidat ignoré.`;
    return report;
  }
  const callImage = candidate.callImage;
  if (!callImage) {
    report.skipped = "Pas de mode image pour ce candidat.";
    return report;
  }

  let temperature: number | undefined = TEMPERATURE;
  for (const fixture of fixtures) {
    const started = performance.now();
    let result: CallResult | null = null;
    let error: string | null = null;
    try {
      try {
        result = await callImage(fixture.image, { temperature });
      } catch (first) {
        if (temperature === undefined || !isTemperatureRejection(first)) throw first;
        temperature = undefined;
        report.temperature = `refusée par l'API (${errorMessage(first).slice(0, 160)}) — valeur par défaut du modèle`;
        result = await callImage(fixture.image, { temperature });
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
    // Montants autorisés : ceux du texte source, qui est exactement le texte affiché.
    const hallucinations = parsed === null ? [] : findHallucinations(parsed, fixture.sourceText, fixture.traps);
    const run: RunRecord = {
      fixture: fixture.name,
      source: fixture.source,
      degradation: fixture.degradation,
      error,
      latencyMs,
      tokens: result
        ? { inputTokens: result.inputTokens, cachedInputTokens: result.cachedInputTokens, outputTokens: result.outputTokens }
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
  const totalCost = answered.reduce((sum, r) => sum + r.costUsd, 0) / Math.max(1, answered.length);
  report.metrics = {
    criticalFactExtraction: round1((100 * allFacts.filter((f) => f.ok).length) / Math.max(1, allFacts.length)),
    forbiddenHallucinations: report.runs.reduce((sum, r) => sum + r.hallucinations.length, 0),
    schemaValidity: round1((100 * report.runs.filter((r) => r.schemaValid).length) / Math.max(1, report.runs.length)),
    latencyP50Ms: percentile(answered.map((r) => r.latencyMs), 50),
    latencyP95Ms: percentile(answered.map((r) => r.latencyMs), 95),
    costPerAnalysisUsd: round6(totalCost),
    costPerAnalysisEur: round6(totalCost / USD_PER_EUR),
  };
  return report;
}

// Règle de décision de la mission #003 :
// - Luna >= 90 % d'extraction → Luna pour tout ;
// - Luna < 90 % et Gemini >= Luna + 8 points → Luna texte, Gemini image ;
// - les deux < 80 % → pas de mode image, étudier une voie OCR séparée.
// Les critères éliminatoires de #002 (hallucinations, schéma) sont rapportés.
function decide(reports: CandidateReport[]): { decision: string; rule: string } {
  const luna = reports.find((r) => r.id === "openai/gpt-5.6-luna")?.metrics;
  const gemini = reports.find((r) => r.id === "google/gemini-3.6-flash")?.metrics;
  if (!luna) return { decision: "AUCUNE", rule: "Luna n'a pas pu être évalué." };
  if (luna.criticalFactExtraction >= 90) {
    return { decision: "LUNA_POUR_TOUT", rule: `Luna à ${luna.criticalFactExtraction} % ≥ 90 % : un seul modèle pour le texte et l'image.` };
  }
  if (gemini && gemini.criticalFactExtraction - luna.criticalFactExtraction >= 8) {
    return {
      decision: "LUNA_TEXTE_GEMINI_IMAGE",
      rule: `Luna à ${luna.criticalFactExtraction} % < 90 % et Gemini à ${gemini.criticalFactExtraction} % (≥ 8 points d'écart).`,
    };
  }
  if (luna.criticalFactExtraction < 80 && (!gemini || gemini.criticalFactExtraction < 80)) {
    return { decision: "PAS_DE_MODE_IMAGE", rule: "Les deux candidats sont sous 80 % : étudier une voie OCR séparée." };
  }
  return {
    decision: "HORS_REGLE",
    rule: `Luna à ${luna.criticalFactExtraction} %, Gemini à ${gemini?.criticalFactExtraction ?? "—"} % : aucun cas de la règle ne s'applique.`,
  };
}

function table(reports: CandidateReport[]): string {
  const lines = [
    "| Candidat | Faits critiques | Hallucinations interdites | Schéma valide 1er coup | Latence p50 / p95 | Coût par analyse |",
    "|---|---|---|---|---|---|",
  ];
  for (const r of reports) {
    if (!r.metrics) {
      lines.push(`| ${r.id} | — | — | — | — | ${r.skipped} |`);
      continue;
    }
    const m = r.metrics;
    lines.push(
      `| ${r.id} | ${m.criticalFactExtraction} % | ${m.forbiddenHallucinations} | ${m.schemaValidity} % | ${m.latencyP50Ms} / ${m.latencyP95Ms} ms | ${m.costPerAnalysisUsd.toFixed(5)} $ / ${m.costPerAnalysisEur.toFixed(5)} € |`,
    );
  }
  return lines.join("\n");
}

async function main() {
  const fixtures = loadFixtures();
  const candidates = VISION_CANDIDATES.map((id) => CANDIDATES.find((c) => c.id === id)).filter(
    (c): c is Candidate => c !== undefined,
  );
  console.log(`${fixtures.length} images, ${candidates.length} candidats, température demandée ${TEMPERATURE}.`);

  const reports = await Promise.all(candidates.map((candidate) => evaluate(candidate, fixtures)));
  const decision = decide(reports);

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  mkdirSync(RESULTS_DIR, { recursive: true });
  const file = path.join(RESULTS_DIR, `vision-${timestamp}.json`);
  writeFileSync(
    file,
    JSON.stringify({ timestamp, fixtures: fixtures.map((f) => `${f.name} ← ${f.source}`), usdPerEur: USD_PER_EUR, decision, reports }, null, 2),
  );

  console.log(`\n${table(reports)}\n`);
  for (const r of reports) {
    if (!r.metrics) continue;
    const perFixture = r.runs.map((run) => `${run.fixture} ${run.facts.filter((f) => f.ok).length}/${run.facts.length}`);
    console.log(`Détail ${r.id} : ${perFixture.join(", ")}`);
  }
  for (const r of reports) console.log(`Température ${r.id} : ${r.skipped ?? r.temperature}`);
  console.log(`\nDécision : ${decision.decision} — ${decision.rule}`);
  console.log(`Résultats : ${path.relative(ROOT, file)}`);
}

main().catch((error: unknown) => {
  console.error(errorMessage(error));
  process.exit(1);
});
