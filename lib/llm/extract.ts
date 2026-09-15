import OpenAI from "openai";
import { MODEL } from "@/lib/llm/model";
import {
  buildUserMessage,
  extractionJsonSchema,
  extractionSchema,
  SYSTEM_PROMPT,
  type Extraction,
} from "@/lib/llm/prompt";

export class MissingApiKeyError extends Error {}
export class ExtractionError extends Error {}

// Un appel, plus une seule reprise si la sortie est invalide.
const MAX_ATTEMPTS = 2;
const TIMEOUT_MS = 55_000;
// Au-delà, la quantité extraite est une erreur de lecture (vue en éval : 32025).
const MAX_PLAUSIBLE_QUANTITY = 50;

export type ExtractResult = {
  extraction: Extraction;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costEur: number;
  latencyMs: number;
  schemaValidFirstTry: boolean;
  attempts: number;
};

function problemWith(outputText: string): { extraction: Extraction } | { problem: string } {
  let json: unknown;
  try {
    json = JSON.parse(outputText);
  } catch {
    return { problem: "JSON illisible" };
  }
  const parsed = extractionSchema.safeParse(json);
  if (!parsed.success) {
    return { problem: parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join(" ; ") };
  }
  const implausible = parsed.data.deal.deliverables.find(
    (d) => !Number.isInteger(d.quantity) || d.quantity < 1 || d.quantity > MAX_PLAUSIBLE_QUANTITY,
  );
  if (implausible) return { problem: `quantité invraisemblable : ${implausible.quantity}` };
  return { extraction: parsed.data };
}

export async function extractDeal(offerText: string): Promise<ExtractResult> {
  const apiKey = process.env[MODEL.envKey];
  if (!apiKey) throw new MissingApiKeyError(`${MODEL.envKey} absente`);

  const client = new OpenAI({ apiKey, timeout: TIMEOUT_MS, maxRetries: 1 });
  const schema = extractionJsonSchema();
  const started = performance.now();
  let inputTokens = 0;
  let cachedInputTokens = 0;
  let outputTokens = 0;
  let schemaValidFirstTry = false;
  let lastProblem = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await client.responses.create({
      model: MODEL.id,
      instructions: SYSTEM_PROMPT,
      input: buildUserMessage(offerText),
      max_output_tokens: 16000,
      text: { format: { type: "json_schema", name: "deal_analysis", schema, strict: true } },
    });
    inputTokens += response.usage?.input_tokens ?? 0;
    cachedInputTokens += response.usage?.input_tokens_details?.cached_tokens ?? 0;
    outputTokens += response.usage?.output_tokens ?? 0;

    const result = problemWith(response.output_text);
    if ("extraction" in result) {
      if (attempt === 1) schemaValidFirstTry = true;
      const { input, cachedInput, output } = MODEL.pricingUsdPerMillion;
      const costUsd =
        ((inputTokens - cachedInputTokens) * input + cachedInputTokens * cachedInput + outputTokens * output) /
        1_000_000;
      return {
        extraction: result.extraction,
        model: MODEL.id,
        inputTokens,
        outputTokens,
        costEur: costUsd / MODEL.usdPerEur,
        latencyMs: Math.round(performance.now() - started),
        schemaValidFirstTry,
        attempts: attempt,
      };
    }
    lastProblem = result.problem;
  }

  throw new ExtractionError(`Sortie invalide après ${MAX_ATTEMPTS} essais : ${lastProblem}`);
}
