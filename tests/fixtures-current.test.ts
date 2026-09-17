import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { composeAnalysis, SCHEMA_VERSION } from "@/lib/analysis/compose";
import { PREVIEW_STATES, previewAnalysis } from "@/lib/fixtures/preview-states";
import sampleExtraction from "@/lib/fixtures/sample-extraction.json";
import { extractionSchema } from "@/lib/llm/prompt";
import rates from "@/lib/rates/fr-2026.2.json";
import { sampleAnalysis } from "@/lib/sample-analysis";
import { analysisSchema, type Analysis } from "@/lib/schema";

// Mission #037 B4 : une fixture affichée ne doit jamais montrer un état périmé
// du moteur (libellés, montants, score, version de table ou de schéma). C'est
// ce qui a laissé « Exclusivité cosmétique 3 mois » sur /analyse/demo.

const ROOT = process.cwd();
const FIXTURES_DIR = path.join(ROOT, "lib", "fixtures");

// Analyses enregistrées volontairement dans un format ancien, pour tester la
// relecture des analyses déjà en base. Jamais affichées : aucun fichier de
// app/, components/ ou lib/ ne doit les importer (vérifié ci-dessous).
const LEGACY_TEST_ONLY = ["analysis-legacy-1.0.json"];

// Champs calculés par le moteur à partir du deal, que l'utilisatrice voit.
function engineView(analysis: Analysis) {
  return {
    schema_version: analysis.schema_version,
    evaluability: analysis.evaluability,
    score: analysis.score,
    estimate: {
      rate_table_version: analysis.estimate.rate_table_version,
      base: [analysis.estimate.base_low, analysis.estimate.base_high],
      total: [analysis.estimate.total_low, analysis.estimate.total_high],
      lines: analysis.estimate.lines.map((line) => [line.label, line.eur_low, line.eur_high]),
      assumptions: analysis.estimate.assumptions,
    },
    counter_offer: [analysis.counter_offer.amount_low, analysis.counter_offer.amount_high],
    fr_legal: analysis.fr_legal,
    escalate: analysis.escalate_to_professional,
  };
}

// Ce que le moteur d'aujourd'hui produit pour le même deal. Les sujets des points
// à négocier ne sont pas enregistrés dans une analyse : ils n'influencent que
// l'impact de chaque point, qui n'est pas comparé.
function recomposed(stored: Analysis): Analysis {
  return composeAnalysis({
    language: stored.language,
    confidence: stored.confidence,
    input_quality: stored.input_quality,
    deal: stored.deal,
    good_points: stored.good_points,
    negotiate: stored.negotiate.map((item) => ({ label: item.label, why: item.why, priority: item.priority, topic: "other" })),
    red_flags: stored.red_flags,
    counter_offer: { changes: stored.counter_offer.changes },
    ready_to_send_message: stored.ready_to_send_message,
  });
}

function staleness(stored: Analysis): string[] {
  const before = engineView(stored);
  const after = engineView(recomposed(stored));
  return (Object.keys(before) as Array<keyof typeof before>)
    .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .map((key) => `${key} : ${JSON.stringify(before[key])} ≠ ${JSON.stringify(after[key])}`);
}

function storedAnalysisFixtures(): Array<{ name: string; analysis: Analysis }> {
  return readdirSync(FIXTURES_DIR)
    .filter((name) => name.endsWith(".json"))
    .flatMap((name) => {
      const parsed = analysisSchema.safeParse(JSON.parse(readFileSync(path.join(FIXTURES_DIR, name), "utf8")));
      return parsed.success ? [{ name, analysis: parsed.data }] : [];
    });
}

describe("fixtures affichées : état du moteur d'aujourd'hui", () => {
  it("l'exemple public (accueil, démo) est recalculé par le moteur actuel", () => {
    expect(sampleAnalysis).toEqual(composeAnalysis(extractionSchema.parse(sampleExtraction)));
    expect(sampleAnalysis.schema_version).toBe(SCHEMA_VERSION);
    expect(sampleAnalysis.estimate.rate_table_version).toBe(rates.version);
    expect(staleness(sampleAnalysis)).toEqual([]);
    const labels = sampleAnalysis.estimate.lines.map((line) => line.label);
    expect(labels).not.toContain("Exclusivité cosmétique 3 mois");
    expect(labels).toContain("Exclusivité 3 mois");
  });

  it("chaque état de prévisualisation est à jour", () => {
    for (const state of PREVIEW_STATES) {
      const { analysis } = previewAnalysis(state);
      if (!analysis.counter_offer || !analysis.ready_to_send_message) continue; // vue verrouillée : même analyse que « débloqué »
      expect(staleness(analysis as Analysis), state).toEqual([]);
    }
  });

  it("aucune analyse enregistrée dans lib/fixtures n'est périmée, sauf les formats anciens réservés aux tests", () => {
    const fixtures = storedAnalysisFixtures();
    for (const { name, analysis } of fixtures) {
      if (LEGACY_TEST_ONLY.includes(name)) continue;
      expect(staleness(analysis), name).toEqual([]);
    }
  });

  it("le contrôle attrape bien une fixture périmée : l'ancienne fixture de démo est signalée", () => {
    const legacy = storedAnalysisFixtures().find((f) => f.name === "analysis-legacy-1.0.json");
    expect(legacy).toBeDefined();
    const stale = staleness(legacy!.analysis).join("\n");
    expect(stale).toContain("schema_version");
    expect(stale).toContain("Exclusivité cosmétique 3 mois");
    expect(stale).toContain("demo-2026-09");
  });

  it("les formats anciens ne sont importés par aucun code affiché", () => {
    const sources = ["app", "components", "lib"].flatMap((dir) =>
      readdirSync(path.join(ROOT, dir), { recursive: true, withFileTypes: true })
        .filter((e) => e.isFile() && /\.(tsx?|jsx?)$/.test(e.name))
        .map((e) => path.join(e.parentPath, e.name)),
    );
    for (const legacy of LEGACY_TEST_ONLY) {
      const importers = sources.filter((file) => readFileSync(file, "utf8").includes(legacy));
      expect(importers.map((file) => path.relative(ROOT, file)), legacy).toEqual([]);
    }
  });
});
