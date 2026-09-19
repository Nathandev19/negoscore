import OpenAI from "openai";
import { MODEL, type ReasoningEffort, type TextVerbosity } from "@/lib/llm/model";
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

// Quantité d'un livrable, à la frontière du modèle. Deux cas à ne pas confondre :
//   - null ou 0 : la marque n'a pas dit combien (vu en éval : « quelques vidéos »
//     → 0). C'est une information manquante : la quantité devient null, et le
//     moteur suppose un contenu en l'écrivant dans ses hypothèses ;
//   - négative, non entière ou au-delà de 50 : c'est une erreur de lecture, la
//     sortie est rejetée (le modèle est rappelé une fois).
export type QuantityCheck = { kind: "unknown" } | { kind: "count"; value: number } | { kind: "aberrant"; value: number };

export function checkQuantity(quantity: number | null): QuantityCheck {
  if (quantity === null || quantity === 0) return { kind: "unknown" };
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > MAX_PLAUSIBLE_QUANTITY) return { kind: "aberrant", value: quantity };
  return { kind: "count", value: quantity };
}

// Réglages d'un appel. Sans valeur : ceux de MODEL (production).
export type ExtractOptions = { reasoningEffort?: ReasoningEffort | null; textVerbosity?: TextVerbosity | null };

export type ExtractResult = {
  extraction: Extraction;
  model: string;
  inputTokens: number;
  outputTokens: number;
  // Part des jetons de sortie consacrée au raisonnement (comptée dans outputTokens).
  reasoningTokens: number;
  reasoningEffort: ReasoningEffort | null;
  textVerbosity: TextVerbosity | null;
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
  const checks = parsed.data.deal.deliverables.map((d) => checkQuantity(d.quantity));
  const aberrant = checks.find((check) => check.kind === "aberrant");
  if (aberrant) return { problem: `quantité invraisemblable : ${aberrant.value}` };
  const deliverables = parsed.data.deal.deliverables.map((d, index) => ({
    ...d,
    quantity: checks[index].kind === "unknown" ? null : d.quantity,
  }));
  return { extraction: { ...parsed.data, deal: { ...parsed.data.deal, deliverables } } };
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
  const result = await callStructured({
    instructions: SYSTEM_PROMPT,
    input,
    schemaName: "deal_analysis",
    schema: extractionJsonSchema(),
    parse: problemWith,
    options,
  });
  return { ...result.usage, extraction: result.value.extraction };
}

export type StructuredUsage = Omit<ExtractResult, "extraction">;

// Appel au modèle avec sortie JSON stricte, commun à l'analyse et aux tours de
// négociation (mission #080) : même modèle, même délai global, une seule
// reprise si la sortie est invalide, même calcul du coût.
export async function callStructured<T>({
  instructions,
  input,
  schemaName,
  schema,
  parse,
  options = {},
}: {
  instructions: string;
  input: OpenAI.Responses.ResponseCreateParams["input"];
  schemaName: string;
  schema: { [key: string]: unknown };
  parse: (outputText: string) => T | { problem: string };
  options?: ExtractOptions;
}): Promise<{ value: T; usage: StructuredUsage }> {
  const apiKey = process.env[MODEL.envKey];
  if (!apiKey) throw new MissingApiKeyError(`${MODEL.envKey} absente`);

  const client = new OpenAI({ apiKey, timeout: TIMEOUT_MS, maxRetries: 1 });
  const deadline = AbortSignal.timeout(EXTRACTION_BUDGET_MS);
  const started = performance.now();
  let inputTokens = 0;
  let cachedInputTokens = 0;
  let outputTokens = 0;
  let reasoningTokens = 0;
  const reasoningEffort = options.reasoningEffort === undefined ? MODEL.reasoningEffort : options.reasoningEffort;
  const textVerbosity = options.textVerbosity === undefined ? MODEL.textVerbosity : options.textVerbosity;
  let schemaValidFirstTry = false;
  let lastProblem = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await client.responses.create({
      model: MODEL.id,
      instructions,
      input,
      max_output_tokens: 16000,
      text: {
        format: { type: "json_schema", name: schemaName, schema, strict: true },
        // Absent quand la verbosité vaut null : valeur par défaut de l'API.
        ...(textVerbosity ? { verbosity: textVerbosity } : {}),
      },
      // Paramètre absent quand l'effort vaut null : valeur par défaut de l'API.
      ...(reasoningEffort ? { reasoning: { effort: reasoningEffort } } : {}),
    }, { signal: deadline });
    inputTokens += response.usage?.input_tokens ?? 0;
    cachedInputTokens += response.usage?.input_tokens_details?.cached_tokens ?? 0;
    outputTokens += response.usage?.output_tokens ?? 0;
    reasoningTokens += response.usage?.output_tokens_details?.reasoning_tokens ?? 0;

    const result = parse(response.output_text);
    if (!(typeof result === "object" && result !== null && "problem" in result)) {
      if (attempt === 1) schemaValidFirstTry = true;
      const { input: inputPrice, cachedInput, output } = MODEL.pricingUsdPerMillion;
      const costUsd =
        ((inputTokens - cachedInputTokens) * inputPrice + cachedInputTokens * cachedInput + outputTokens * output) /
        1_000_000;
      return {
        value: result,
        usage: {
          model: MODEL.id,
          inputTokens,
          outputTokens,
          reasoningTokens,
          reasoningEffort,
          textVerbosity,
          costEur: costUsd / MODEL.usdPerEur,
          latencyMs: Math.round(performance.now() - started),
          schemaValidFirstTry,
          attempts: attempt,
        },
      };
    }
    lastProblem = result.problem;
  }

  throw new ExtractionError(`Sortie invalide après ${MAX_ATTEMPTS} essais : ${lastProblem}`);
}
