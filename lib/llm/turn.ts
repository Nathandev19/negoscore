import { callStructured, type ExtractOptions, type StructuredUsage } from "@/lib/llm/extract";
import { TURN_REASONING_EFFORT } from "@/lib/llm/model";
import { journalDeFuite, scriptsAutorises, tourSansFuites, type ScriptNomme } from "@/lib/llm/langue";
import { buildTurnUserMessage, TURN_SYSTEM_PROMPT, turnReadingJsonSchema } from "@/lib/llm/turn-prompt";
import { turnReadingSchema, type Ask, type Deal, type PointState, type TurnReading } from "@/lib/negotiation/types";

// Mission #080 — lecture d'une réponse de marque par le modèle. La sortie est
// validée par le schéma ; tout ce qu'elle affirme est ensuite vérifié par le
// code (lib/negotiation/turn.ts) avant d'être montré.

export type TurnReadResult = { reading: TurnReading; usage: StructuredUsage };

// Mission #210 — même contrôle que pour une analyse, et pour la même raison :
// les doutes, ce qu'il reste à préciser et la note de pertinence sont de la
// prose française qui va à l'écran. Les citations et le message suivant, eux,
// recopient la marque et ne sont pas contrôlés (lib/llm/langue.ts).
function parseReading(
  outputText: string,
  essai: { numero: number; derniere: boolean },
  autorises: ReadonlySet<ScriptNomme>,
): TurnReading | { problem: string } {
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
  const { lecture, fuites } = tourSansFuites(parsed.data, autorises);
  if (fuites.length === 0) return parsed.data;
  if (!essai.derniere) {
    console.warn(JSON.stringify({ event: "langue_fuite_reprise_tour", essai: essai.numero, ...journalDeFuite(fuites) }));
    return { problem: `langue étrangère dans ${fuites.map((fuite) => fuite.champ).join(", ")}` };
  }
  console.warn(JSON.stringify({ event: "langue_fuite_reparee_tour", essai: essai.numero, ...journalDeFuite(fuites) }));
  return lecture;
}

export async function readBrandReply(input: {
  deal: Deal;
  asks: readonly Ask[];
  // Mission #095 — ce que la marque a déjà renseigné, pour ne pas le redemander.
  points: readonly PointState[];
  lastMessage: string;
  brandReply: string;
}, options: ExtractOptions = {}): Promise<TurnReadResult> {
  // La RÉFÉRENCE de langue est tout ce que le modèle a reçu : l'état du deal
  // (qui porte le nom de la marque), le dernier message et la réponse collée.
  // Un script présent là-dedans a le droit de ressortir ; un autre, non.
  const entree = buildTurnUserMessage(input);
  const autorises = scriptsAutorises(entree);
  const { value, usage } = await callStructured({
    instructions: TURN_SYSTEM_PROMPT,
    input: entree,
    schemaName: "brand_reply_reading",
    schema: turnReadingJsonSchema(),
    parse: (outputText, essai) => parseReading(outputText, essai, autorises),
    // Mission #202 — l'effort de raisonnement d'un TOUR, qui n'est pas celui
    // de l'extraction d'une offre (lib/llm/model.ts explique pourquoi et avec
    // quelles mesures). Un appelant peut le remplacer : c'est ainsi que
    // evals/tour-effort.ts mesure un réglage par le chemin de la production,
    // et non par une copie qui pourrait en diverger.
    options: { reasoningEffort: TURN_REASONING_EFFORT, ...options },
  });
  return { reading: value, usage };
}
