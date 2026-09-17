import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PREVIEW_STATES, previewAnalysis } from "@/lib/fixtures/preview-states";
import { extractionSchema } from "@/lib/llm/prompt";
import { sampleAnalysis } from "@/lib/sample-analysis";
import { analysisSchema, type Analysis } from "@/lib/schema";

// Offres du relevé de la mission #038, sans appel au modèle (voir evals/plausibility.ts) :
// 26 offres distinctes (inStats) et, hors statistiques, les doublons du pipeline,
// les états de prévisualisation et l'exemple public.

type Deal = Analysis["deal"];
export type Row = { source: string; offer: string; inStats: boolean; deal: Deal };

const ROOT = process.cwd();

export function collectDeals(): Row[] {
  const rows: Row[] = [];
  const run = JSON.parse(readFileSync(path.join(ROOT, "evals/results/2026-09-15T07-45-12-414Z.json"), "utf8")) as {
    reports: Array<{ id: string; runs: Array<{ fixture: string; rawOutput: string }> }>;
  };
  const production = run.reports.find((report) => report.id === "openai/gpt-5.6-luna");
  for (const record of production?.runs ?? []) {
    const extraction = extractionSchema.safeParse(JSON.parse(record.rawOutput));
    if (extraction.success) rows.push({ source: "éval 15/09", offer: record.fixture, inStats: true, deal: extraction.data.deal });
  }
  for (const file of readdirSync(path.join(ROOT, "evals/results/pipeline")).filter((f) => f.endsWith(".json")).sort()) {
    const stored = JSON.parse(readFileSync(path.join(ROOT, "evals/results/pipeline", file), "utf8")) as { analysis: unknown };
    const parsed = analysisSchema.safeParse(stored.analysis);
    if (!parsed.success) continue;
    const offer = file.replace(/\.json$/, "");
    const alreadyInEval = rows.some((row) => row.offer === offer);
    rows.push({ source: "pipeline", offer, inStats: !alreadyInEval, deal: parsed.data.deal });
  }
  const nova = JSON.parse(readFileSync(path.join(ROOT, "tests/fixtures/deal-26-nova-sportswear.json"), "utf8")) as Deal;
  rows.push({ source: "tests (#019)", offer: "26-dm-nova-sportswear", inStats: true, deal: analysisSchema.shape.deal.parse(nova) });
  for (const state of PREVIEW_STATES) {
    if (state === "verrouille") continue; // même analyse que « debloque »
    const { analysis } = previewAnalysis(state);
    rows.push({ source: "prévisualisation", offer: state, inStats: false, deal: analysis.deal });
  }
  rows.push({ source: "exemple public", offer: "accueil et démo", inStats: false, deal: sampleAnalysis.deal });
  return rows;
}
