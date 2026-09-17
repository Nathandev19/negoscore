import OpenAI from "openai";
import { MODEL, type ReasoningEffort } from "@/lib/llm/model";
import {
  buildUserMessage,
  extractionJsonSchema,
  extractionSchema,
  IMAGE_USER_MESSAGE,
  PDF_USER_MESSAGE,
  SYSTEM_PROMPT,
  type Extraction,
} from "@/lib/llm/prompt";

export class MissingApiKeyError extends Error {}
export class ExtractionError extends Error {}

// Un appel, plus une seule reprise si la sortie est invalide.
const MAX_ATTEMPTS = 2;
const TIMEOUT_MS = 55_000;
// Échéance globale de l'extraction, reprises comprises. Elle reste sous la
// durée maximale de la route (120 s) : en cas de dépassement, la route a
// toujours le temps de répondre et de ne rien décompter, au lieu d'être coupée
// par l'hébergeur au milieu de l'appel.
export const EXTRACTION_BUDGET_MS = 95_000;
// Au-delà, la quantité extraite est une erreur de lecture (vue en éval : 32025).
const MAX_PLAUSIBLE_QUANTITY = 50;

// Réglages d'un appel. Sans valeur : ceux de MODEL (production).
export type ExtractOptions = { reasoningEffort?: ReasoningEffort | null };

export type ExtractResult = {
  extraction: Extraction;
  model: string;
  inputTokens: number;
  outputTokens: number;
  // Part des jetons de sortie consacrée au raisonnement (comptée dans outputTokens).
  reasoningTokens: number;
  reasoningEffort: ReasoningEffort | null;
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

export type ImageInput = { base64: string; mimeType: string };

export function extractDeal(offerText: string, options: ExtractOptions = {}): Promise<ExtractResult> {
  return run(buildUserMessage(offerText), options);
}

// Même modèle, même prompt système, même schéma : seule l'entrée change.
export function extractDealFromImage(image: ImageInput): Promise<ExtractResult> {
  return run([
    {
      role: "user",
      content: [
        { type: "input_text", text: IMAGE_USER_MESSAGE },
        { type: "input_image", image_url: `data:${image.mimeType};base64,${image.base64}`, detail: "high" },
      ],
    },
  ]);
}

export type PdfInput = { base64: string; filename: string };

// PDF en entrée directe (bloc input_file) : le fournisseur envoie au modèle le
// texte extrait et l'image de chaque page. Même modèle, même prompt système,
// même schéma. Les jetons du PDF sont comptés dans usage.input_tokens : le
// calcul du coût reste le même. Doc : developers.openai.com/api/docs/guides/pdf-files
export function extractDealFromPdf(pdf: PdfInput): Promise<ExtractResult> {
  return run([
    {
      role: "user",
      content: [
        { type: "input_text", text: PDF_USER_MESSAGE },
        {
          type: "input_file",
          filename: pdf.filename,
          file_data: `data:application/pdf;base64,${pdf.base64}`,
          detail: "high",
        },
      ],
    },
  ]);
}

async function run(input: OpenAI.Responses.ResponseCreateParams["input"], options: ExtractOptions = {}): Promise<ExtractResult> {
  const apiKey = process.env[MODEL.envKey];
  if (!apiKey) throw new MissingApiKeyError(`${MODEL.envKey} absente`);

  const client = new OpenAI({ apiKey, timeout: TIMEOUT_MS, maxRetries: 1 });
  const deadline = AbortSignal.timeout(EXTRACTION_BUDGET_MS);
  const schema = extractionJsonSchema();
  const started = performance.now();
  let inputTokens = 0;
  let cachedInputTokens = 0;
  let outputTokens = 0;
  let reasoningTokens = 0;
  const reasoningEffort = options.reasoningEffort === undefined ? MODEL.reasoningEffort : options.reasoningEffort;
  let schemaValidFirstTry = false;
  let lastProblem = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await client.responses.create({
      model: MODEL.id,
      instructions: SYSTEM_PROMPT,
      input,
      max_output_tokens: 16000,
      text: { format: { type: "json_schema", name: "deal_analysis", schema, strict: true } },
      // Paramètre absent quand l'effort vaut null : valeur par défaut de l'API.
      ...(reasoningEffort ? { reasoning: { effort: reasoningEffort } } : {}),
    }, { signal: deadline });
    inputTokens += response.usage?.input_tokens ?? 0;
    cachedInputTokens += response.usage?.input_tokens_details?.cached_tokens ?? 0;
    outputTokens += response.usage?.output_tokens ?? 0;
    reasoningTokens += response.usage?.output_tokens_details?.reasoning_tokens ?? 0;

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
        reasoningTokens,
        reasoningEffort,
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
