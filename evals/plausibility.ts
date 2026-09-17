import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { composeAnalysis } from "@/lib/analysis/compose";
import { evaluability } from "@/lib/analysis/evaluability";
import { normalizeDeal } from "@/lib/analysis/normalize";
import { isFarAboveOffer } from "@/lib/rates/engine";
import type { Analysis } from "@/lib/schema";
import { collectDeals } from "./survey-deals.ts";

// Mission #038 : à quelle fréquence l'alarme de vraisemblance se déclenche-t-elle ?
// AUCUN APPEL AU MODÈLE. Toutes les analyses sont recalculées par le moteur
// déterministe, à partir de deals déjà extraits :
//   - fixtures 01 à 20 : sorties du modèle de production enregistrées par l'éval
//     du 15/09/2026 (evals/results/2026-09-15T07-45-12-414Z.json) ;
//   - fixtures 21 à 25 : analyses du pipeline (evals/results/pipeline) ;
//   - fixture 26 : deal NOVA de tests/fixtures (mission #019) ;
//   - en plus, hors statistiques : les 3 autres analyses du pipeline (04, 17, 18,
//     deuxième extraction des mêmes offres), les états de prévisualisation et
//     l'exemple public (variantes synthétiques de la même offre).
// Relevé refait avec le moteur et la table d'avant la mission #026 (barème de
// volume par paliers, fr-2026.1), extraits de git dans .cache/, sans rien modifier.
//
// node --import ./evals/register-alias.mjs --disable-warning=MODULE_TYPELESS_PACKAGE_JSON evals/plausibility.ts

const ROOT = process.cwd();
const PRE_026 = "4afd151^";

type Deal = Analysis["deal"];
type Estimate = Analysis["estimate"];
type Score = NonNullable<Analysis["score"]>;

type EngineModule = { computeEstimate: (deal: Deal) => Estimate };
type ScoreModule = { computeScore: (deal: Deal, estimate: Estimate) => Score };

// Moteur et table d'avant #026, lus dans git et écrits dans .cache (ignoré).
async function preEngine(): Promise<{ engine: EngineModule; score: ScoreModule }> {
  const dir = path.join(ROOT, ".cache", "pre-026");
  mkdirSync(dir, { recursive: true });
  const show = (file: string) => execFileSync("git", ["show", `${PRE_026}:${file}`], { cwd: ROOT, encoding: "utf8" });
  writeFileSync(path.join(dir, "fr-2026.1.json"), show("lib/rates/fr-2026.1.json"));
  writeFileSync(path.join(dir, "engine.ts"), show("lib/rates/engine.ts").replace('"@/lib/rates/fr-2026.1.json"', '"@/.cache/pre-026/fr-2026.1.json"'));
  writeFileSync(path.join(dir, "score.ts"), show("lib/rates/score.ts"));
  const engine = (await import(pathToFileURL(path.join(dir, "engine.ts")).href)) as EngineModule;
  const score = (await import(pathToFileURL(path.join(dir, "score.ts")).href)) as ScoreModule;
  return { engine, score };
}

type Measure = {
  amount: number | null;
  low: number | null;
  high: number | null;
  ratio: number | null;
  alarm: boolean;
  state: string;
  score: Score | null;
  assumptions: string[];
};

function measureCurrent(deal: Deal): Measure {
  const analysis = composeAnalysis({
    language: "fr",
    confidence: "medium",
    input_quality: { readable: true, missing_critical: [] },
    deal,
    good_points: [],
    negotiate: [],
    red_flags: [],
    counter_offer: { changes: [] },
    ready_to_send_message: { tone: "cordial", text: "Bonjour." },
  });
  return summarize(analysis.deal.payment.amount_eur, analysis.estimate, analysis.evaluability, analysis.score);
}

function measurePre(deal: Deal, pre: { engine: EngineModule; score: ScoreModule }): Measure {
  // L'ancien moteur ne connaît pas la quantité non précisée : un contenu, comme aujourd'hui.
  const normalized = normalizeDeal({ ...deal, deliverables: deal.deliverables.map((d) => ({ ...d, quantity: d.quantity ?? 1 })) });
  const state = evaluability(normalized);
  const estimate = pre.engine.computeEstimate(normalized);
  const empty = state === "incomplete";
  return summarize(
    normalized.payment.amount_eur,
    empty ? { ...estimate, total_low: null, total_high: null, assumptions: [] } : estimate,
    state,
    state === "complete" ? pre.score.computeScore(normalized, estimate) : null,
  );
}

function summarize(amount: number | null, estimate: Estimate, state: string, score: Score | null): Measure {
  const low = estimate.total_low;
  return {
    amount,
    low,
    high: estimate.total_high,
    ratio: amount && amount > 0 && low !== null ? Math.round((low / amount) * 100) / 100 : null,
    // Même règle dans les deux moteurs (rapport 3) ; le texte de l'alarme a changé en #039.
    alarm: isFarAboveOffer(amount, low),
    state,
    score,
    assumptions: estimate.assumptions,
  };
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const position = (sorted.length - 1) * q;
  const below = Math.floor(position);
  const above = Math.ceil(position);
  return Math.round((sorted[below] + (sorted[above] - sorted[below]) * (position - below)) * 100) / 100;
}

function stats(measures: Measure[]) {
  const priced = measures.filter((m) => m.ratio !== null);
  const ratios = priced.map((m) => m.ratio as number).sort((a, b) => a - b);
  const alarms = measures.filter((m) => m.alarm).length;
  return {
    offers: measures.length,
    withAmountAndRange: priced.length,
    alarms,
    alarmPctOfOffers: Math.round((1000 * alarms) / measures.length) / 10,
    alarmPctOfPriced: Math.round((1000 * alarms) / Math.max(1, priced.length)) / 10,
    ratioQ1: quantile(ratios, 0.25),
    ratioMedian: quantile(ratios, 0.5),
    ratioQ3: quantile(ratios, 0.75),
    amountAboveLow: priced.filter((m) => (m.amount as number) > (m.low as number)).length,
  };
}

const eur = (value: number | null) => (value === null ? "—" : `${value}`);
const scoreText = (m: Measure) => (m.score ? `${m.score.value} ${m.score.band}` : m.state);

// Hypothèse ramenée à son modèle : les nombres deviennent « N ».
function template(assumption: string): string {
  return assumption.replace(/\d+([,.]\d+)?/g, "N");
}

async function main() {
  const rows = collectDeals();
  const pre = await preEngine();
  const measured = rows.map((row) => ({ row, now: measureCurrent(row.deal), before: measurePre(row.deal, pre) }));

  const lines: string[] = [];
  lines.push("| Source | Offre | Stat. | Montant | Aujourd'hui : bas – haut | Rapport bas/montant | Alarme | Score | Avant #026 : bas – haut | Rapport | Alarme | Score |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const { row, now, before } of measured) {
    lines.push(
      `| ${row.source} | ${row.offer} | ${row.inStats ? "oui" : "non"} | ${eur(now.amount)} | ${eur(now.low)} – ${eur(now.high)} | ${now.ratio ?? "—"} | ${now.alarm ? "OUI" : "non"} | ${scoreText(now)} | ${eur(before.low)} – ${eur(before.high)} | ${before.ratio ?? "—"} | ${before.alarm ? "OUI" : "non"} | ${scoreText(before)} |`,
    );
  }

  const inStats = measured.filter((m) => m.row.inStats);
  const statsNow = stats(inStats.map((m) => m.now));
  const statsBefore = stats(inStats.map((m) => m.before));
  const statsAllNow = stats(measured.map((m) => m.now));

  const counts = new Map<string, number>();
  for (const { now } of inStats) {
    for (const t of new Set(now.assumptions.map(template))) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const assumptionLines = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => `| ${n} / ${inStats.length} | ${t} |`);

  const report = [
    "# Alarme de vraisemblance — relevé du moteur (mission #038)",
    "",
    lines.join("\n"),
    "",
    "## Statistiques sur les 26 offres distinctes (colonne Stat. = oui)",
    "",
    "| | Aujourd'hui (fr-2026.2) | Avant #026 (fr-2026.1) |",
    "|---|---|---|",
    ...Object.keys(statsNow).map((key) => `| ${key} | ${statsNow[key as keyof typeof statsNow]} | ${statsBefore[key as keyof typeof statsBefore]} |`),
    "",
    `Toutes lignes confondues (aujourd'hui) : ${JSON.stringify(statsAllNow)}`,
    "",
    "## Hypothèses affichées, par fréquence (26 offres, moteur actuel)",
    "",
    "| Offres | Hypothèse (nombres remplacés par N) |",
    "|---|---|",
    ...assumptionLines,
  ].join("\n");

  mkdirSync(path.join(ROOT, "evals/results"), { recursive: true });
  const file = path.join(ROOT, "evals/results/plausibility-2026-09-17.md");
  writeFileSync(file, `${report}\n`);
  console.log(report);
  console.log(`\nRésultats : ${path.relative(ROOT, file)}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
