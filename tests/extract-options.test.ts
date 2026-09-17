import { beforeEach, describe, expect, it, vi } from "vitest";
import { baseExtraction } from "@/lib/fixtures/preview-states";

// F1 / F3 : l'effort de raisonnement est réglable, mais la production n'envoie
// toujours rien (valeur par défaut de l'API, « medium ») tant que la mesure
// n'a pas parlé. Client OpenAI simulé : aucun appel réseau.

const calls = vi.hoisted(() => ({ bodies: [] as Array<Record<string, unknown>> }));

vi.mock("openai", () => {
  class OpenAI {
    responses = {
      create: async (body: Record<string, unknown>) => {
        calls.bodies.push(body);
        return {
          output_text: JSON.stringify(baseExtractionForMock()),
          usage: { input_tokens: 1000, input_tokens_details: { cached_tokens: 0 }, output_tokens: 900, output_tokens_details: { reasoning_tokens: 400 } },
        };
      },
    };
  }
  return { default: OpenAI };
});

// Référence résolue au moment de l'appel (vi.mock est remonté en tête de fichier).
function baseExtractionForMock() {
  return baseExtraction();
}

const { extractDeal } = await import("@/lib/llm/extract");
const { MODEL } = await import("@/lib/llm/model");

beforeEach(() => {
  calls.bodies = [];
  vi.stubEnv("OPENAI_API_KEY", "cle-de-test");
});

describe("effort de raisonnement", () => {
  it("par défaut (production) : null, et le paramètre n'est pas envoyé", async () => {
    expect(MODEL.reasoningEffort).toBeNull();
    const result = await extractDeal("Offre de test assez longue pour passer.");
    expect(calls.bodies).toHaveLength(1);
    expect("reasoning" in calls.bodies[0]).toBe(false);
    expect(result.reasoningEffort).toBeNull();
    expect(result.reasoningTokens).toBe(400);
  });

  it("verbosité : null par défaut, rien d'envoyé ; réglable par appel pour l'éval", async () => {
    expect(MODEL.textVerbosity).toBeNull();
    const result = await extractDeal("Offre de test.");
    expect((calls.bodies[0].text as Record<string, unknown>).verbosity).toBeUndefined();
    expect(result.textVerbosity).toBeNull();
    await extractDeal("Offre de test.", { textVerbosity: "low" });
    expect((calls.bodies[1].text as Record<string, unknown>).verbosity).toBe("low");
    expect("reasoning" in calls.bodies[1]).toBe(false);
  });

  it("réglable par appel pour l'éval : low puis medium envoyés explicitement", async () => {
    await extractDeal("Offre de test.", { reasoningEffort: "low" });
    await extractDeal("Offre de test.", { reasoningEffort: "medium" });
    expect(calls.bodies.map((b) => b.reasoning)).toEqual([{ effort: "low" }, { effort: "medium" }]);
  });
});
