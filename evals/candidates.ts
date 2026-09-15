import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import { buildUserMessage, extractionJsonSchema, SYSTEM_PROMPT } from "../lib/llm/prompt.ts";

// Les trois candidats de l'éval. Même prompt, même schéma, même température
// demandée (0), mêmes limites. Prix publics relevés le 15/09/2026, en dollars
// par million de tokens.

export const USD_PER_EUR = 1.1592; // Taux de référence BCE du 11/09/2026.
const MAX_OUTPUT_TOKENS = 16000;
const TIMEOUT_MS = 180_000;

export type CallResult = {
  text: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
};

export type CallOptions = { temperature: number | undefined };

export type Candidate = {
  id: string;
  envKey: string;
  pricing: { input: number; cachedInput: number; output: number; source: string };
  call: (offerText: string, options: CallOptions) => Promise<CallResult>;
};

const schema = extractionJsonSchema();

export const CANDIDATES: Candidate[] = [
  {
    id: "google/gemini-3.6-flash",
    envKey: "GOOGLE_API_KEY",
    pricing: {
      input: 0.75,
      cachedInput: 0.075,
      output: 3.75,
      source: "ai.google.dev/gemini-api/docs/pricing — tarif de lancement jusqu'au 31/12/2026 (1,50 $ / 7,50 $ ensuite), tokens de réflexion facturés en sortie",
    },
    async call(offerText, { temperature }) {
      const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY, httpOptions: { timeout: TIMEOUT_MS } });
      const res = await ai.models.generateContent({
        model: "gemini-3.6-flash",
        contents: buildUserMessage(offerText),
        config: {
          systemInstruction: SYSTEM_PROMPT,
          temperature,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          responseMimeType: "application/json",
          responseJsonSchema: schema,
        },
      });
      const usage = res.usageMetadata;
      return {
        text: res.text ?? "",
        inputTokens: usage?.promptTokenCount ?? 0,
        cachedInputTokens: usage?.cachedContentTokenCount ?? 0,
        outputTokens: (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0),
      };
    },
  },
  {
    id: "anthropic/claude-sonnet-5",
    envKey: "ANTHROPIC_API_KEY",
    pricing: {
      input: 2,
      cachedInput: 0.2,
      output: 10,
      source: "Tarifs API Anthropic (claude-sonnet-5) : 2 $ entrée, 10 $ sortie",
    },
    async call(offerText, { temperature }) {
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: TIMEOUT_MS });
      // output_config.format refuse ce schéma (« compiled grammar is too large ») :
      // le même schéma passe par un outil forcé, non strict. La validité est
      // donc mesurée sans décodage contraint pour ce candidat.
      const res = await client.messages.create({
        model: "claude-sonnet-5",
        max_tokens: MAX_OUTPUT_TOKENS,
        ...(temperature === undefined ? {} : { temperature }),
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildUserMessage(offerText) }],
        tools: [
          {
            name: "enregistrer_analyse",
            description: "Enregistre l'analyse de l'offre.",
            input_schema: schema as Anthropic.Tool.InputSchema,
          },
        ],
        tool_choice: { type: "tool", name: "enregistrer_analyse" },
      });
      const toolUse = res.content.find((block) => block.type === "tool_use");
      const text = toolUse ? JSON.stringify(toolUse.input) : "";
      return {
        text,
        inputTokens: res.usage.input_tokens + (res.usage.cache_read_input_tokens ?? 0),
        cachedInputTokens: res.usage.cache_read_input_tokens ?? 0,
        outputTokens: res.usage.output_tokens,
      };
    },
  },
  {
    id: "openai/gpt-5.6-luna",
    envKey: "OPENAI_API_KEY",
    pricing: {
      input: 0.2,
      cachedInput: 0.02,
      output: 1.2,
      source: "developers.openai.com/api/docs/pricing — contexte court",
    },
    async call(offerText, { temperature }) {
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: TIMEOUT_MS });
      const res = await client.responses.create({
        model: "gpt-5.6-luna",
        instructions: SYSTEM_PROMPT,
        input: buildUserMessage(offerText),
        temperature,
        max_output_tokens: MAX_OUTPUT_TOKENS,
        text: { format: { type: "json_schema", name: "deal_analysis", schema, strict: true } },
      });
      return {
        text: res.output_text,
        inputTokens: res.usage?.input_tokens ?? 0,
        cachedInputTokens: res.usage?.input_tokens_details?.cached_tokens ?? 0,
        outputTokens: res.usage?.output_tokens ?? 0,
      };
    },
  },
];

export function costUsd(candidate: Candidate, result: CallResult): number {
  const { input, cachedInput, output } = candidate.pricing;
  const uncached = result.inputTokens - result.cachedInputTokens;
  return (uncached * input + result.cachedInputTokens * cachedInput + result.outputTokens * output) / 1_000_000;
}
