import { callStructured, type ExtractOptions, type StructuredUsage } from "@/lib/llm/extract";
import { TURN_REASONING_EFFORT } from "@/lib/llm/model";
import { buildTurnUserMessage, TURN_SYSTEM_PROMPT, turnReadingJsonSchema } from "@/lib/llm/turn-prompt";
import { turnReadingSchema, type Ask, type Deal, type PointState, type TurnReading } from "@/lib/negotiation/types";

// Mission #080 — lecture d'une réponse de marque par le modèle. La sortie est
// validée par le schéma ; tout ce qu'elle affirme est ensuite vérifié par le
// code (lib/negotiation/turn.ts) avant d'être montré.

export type TurnReadResult = { reading: TurnReading; usage: StructuredUsage };

function parseReading(outputText: string): TurnReading | { problem: string } {
  let json: unknown;
  try {
    json = JSON.parse(outputText);
  } catch {
    return { problem: "JSON illisible" };
  }
  const parsed = turnReadingSchema.safeParse(json);
  if (!parsed.success) {
    return { problem: parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join(" ; ") };
  }
  return parsed.data;
}

export async function readBrandReply(input: {
  deal: Deal;
  asks: readonly Ask[];
  // Mission #095 — ce que la marque a déjà renseigné, pour ne pas le redemander.
  points: readonly PointState[];
  lastMessage: string;
  brandReply: string;
}, options: ExtractOptions = {}): Promise<TurnReadResult> {
  const { value, usage } = await callStructured({
    instructions: TURN_SYSTEM_PROMPT,
    input: buildTurnUserMessage(input),
    schemaName: "brand_reply_reading",
    schema: turnReadingJsonSchema(),
    parse: parseReading,
    // Mission #202 — l'effort de raisonnement d'un TOUR, qui n'est pas celui
    // de l'extraction d'une offre (lib/llm/model.ts explique pourquoi et avec
    // quelles mesures). Un appelant peut le remplacer : c'est ainsi que
    // evals/tour-effort.ts mesure un réglage par le chemin de la production,
    // et non par une copie qui pourrait en diverger.
    options: { reasoningEffort: TURN_REASONING_EFFORT, ...options },
  });
  return { reading: value, usage };
}
