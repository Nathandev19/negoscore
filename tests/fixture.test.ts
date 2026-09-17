import { describe, expect, it } from "vitest";
import sample from "../lib/fixtures/analysis-legacy-1.0.json";
import { extractionSchema } from "../lib/llm/prompt";
import sampleExtraction from "../lib/fixtures/sample-extraction.json";
import { analysisSchema } from "../lib/schema";

describe("fixture", () => {
  it("sample-extraction.json respecte le schéma d'extraction du modèle", () => {
    const result = extractionSchema.safeParse(sampleExtraction);
    expect(result.error?.issues).toBeUndefined();
  });

  it("analysis-legacy-1.0.json (format 1.0, tests de relecture) respecte le schéma d'analyse", () => {
    const result = analysisSchema.safeParse(sample);
    expect(result.error?.issues).toBeUndefined();
    expect(result.success).toBe(true);
  });
});
