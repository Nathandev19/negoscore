import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { composeAnalysis } from "@/lib/analysis/compose";
import { PREVIEW_STATES, previewAnalysis } from "@/lib/fixtures/preview-states";
import { extractionSchema } from "@/lib/llm/prompt";
import { analysisSchema, type Analysis } from "@/lib/schema";

// Analyses réelles des fixtures, recalculées par le moteur actuel, sans appel au
// modèle : sorties du modèle de production enregistrées par l'éval du
// 15/09/2026, analyses du pipeline, et états de prévisualisation. Sert aux
// vérifications d'affichage (formats, longueur des libellés). Lecture disque :
// tests et page de développement seulement.

const ROOT = process.cwd();
const EVAL_RUN = path.join(ROOT, "evals", "results", "2026-09-15T07-45-12-414Z.json");
const PIPELINE_DIR = path.join(ROOT, "evals", "results", "pipeline");
const PRODUCTION_MODEL = "openai/gpt-5.6-luna";

export type NamedAnalysis = { name: string; analysis: Analysis };

export function evalAnalyses(): NamedAnalysis[] {
  const out: NamedAnalysis[] = [];

  const run = JSON.parse(readFileSync(EVAL_RUN, "utf8")) as {
    reports: Array<{ id: string; runs: Array<{ fixture: string; rawOutput: string }> }>;
  };
  const production = run.reports.find((report) => report.id === PRODUCTION_MODEL);
  for (const record of production?.runs ?? []) {
    try {
      const extraction = extractionSchema.safeParse(JSON.parse(record.rawOutput));
      if (extraction.success) out.push({ name: `éval ${record.fixture}`, analysis: composeAnalysis(extraction.data) });
    } catch {
      // sortie illisible : ignorée
    }
  }

  for (const file of readdirSync(PIPELINE_DIR).filter((name) => name.endsWith(".json")).sort()) {
    const stored = JSON.parse(readFileSync(path.join(PIPELINE_DIR, file), "utf8")) as { analysis: unknown };
    const parsed = analysisSchema.safeParse(stored.analysis);
    if (!parsed.success) continue;
    // Recomposé avec le moteur actuel : les libellés sont ceux d'aujourd'hui.
    const { deal } = parsed.data;
    const topics = parsed.data.negotiate.map((item) => ({ label: item.label, why: item.why, priority: item.priority, topic: "other" as const }));
    out.push({
      name: `pipeline ${file.replace(/\.json$/, "")}`,
      analysis: composeAnalysis({
        language: parsed.data.language,
        confidence: parsed.data.confidence,
        input_quality: parsed.data.input_quality,
        deal,
        good_points: parsed.data.good_points,
        negotiate: topics,
        red_flags: parsed.data.red_flags,
        counter_offer: { changes: parsed.data.counter_offer.changes },
        ready_to_send_message: parsed.data.ready_to_send_message,
      }),
    });
  }

  for (const state of PREVIEW_STATES) {
    const { analysis } = previewAnalysis(state);
    if ("counter_offer" in analysis && analysis.counter_offer && analysis.ready_to_send_message) {
      out.push({ name: `prévisualisation ${state}`, analysis: analysis as Analysis });
    }
  }
  return out;
}
