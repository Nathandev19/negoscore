import { describe, expect, it } from "vitest";
import sample from "../lib/fixtures/analysis-sample.json";
import { analysisSchema } from "../lib/schema";

describe("fixture", () => {
  it("analysis-sample.json respecte le schéma d'analyse", () => {
    const result = analysisSchema.safeParse(sample);
    expect(result.error?.issues).toBeUndefined();
    expect(result.success).toBe(true);
  });
});
