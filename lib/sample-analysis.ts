import sample from "@/lib/fixtures/analysis-sample.json";
import { analysisSchema, type Analysis } from "@/lib/schema";

export const sampleAnalysis: Analysis = analysisSchema.parse(sample);
