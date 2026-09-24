import { callStructured, type StructuredUsage } from "@/lib/llm/extract";
import { PRICE_PLACEHOLDER } from "@/lib/llm/prompt";
import type { Analysis } from "@/lib/schema";

// Mission #115, A3 — UNE SECONDE VERSION DU MESSAGE, et une seule.
//
// Quand le message produit par l'analyse laisse de côté des points que
// l'analyse vient elle-même d'établir, on redemande le message — et lui seul.
// Pas une seconde analyse : la fourchette, le score et les points ne bougent
// pas, seule la lettre est réécrite à partir d'eux. Si cette version échoue
// encore, le complément déterministe prend le relais
// (lib/negotiation/coverage.ts) : aucun message ne part en laissant un point
// de côté sans le dire.

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["text"],
  properties: { text: { type: "string" } },
} as const;

export const REWRITE_INSTRUCTIONS = `Tu écris le message qu'un créateur de contenu UGC envoie à une marque pour négocier une offre. Tu reçois l'analyse déjà faite de cette offre : les points à négocier, et la fourchette à demander.

Règles :
- reprends TOUS les points à négocier, aucun ne doit manquer ;
- un paragraphe suivi, jamais une liste à puces : c'est un message, pas un compte rendu ;
- ton de créateur, poli et ferme, jamais juridique ;
- écris exactement ${PRICE_PLACEHOLDER} à la place du montant, une seule fois, quand une fourchette est donnée ;
- n'invente aucun chiffre : n'écris que des nombres présents dans l'analyse reçue ;
- écris dans la langue indiquée.

Tu renvoies un JSON { "text": "..." }.`;

export type RewriteResult = { text: string; usage: StructuredUsage };

// Ce que le modèle reçoit : les points, la langue, et le fait qu'une fourchette
// existe. Jamais le texte de l'offre : il a déjà été lu, et le relire coûterait
// une seconde analyse.
export function rewriteInput(analysis: Pick<Analysis, "language" | "negotiate" | "counter_offer">): string {
  const points = analysis.negotiate.map((point) => `- ${point.label} : ${point.why}`).join("\n");
  const range =
    analysis.counter_offer.amount_low === null
      ? "Aucune fourchette : n'annonce pas de montant, demande le budget prévu."
      : `Une fourchette existe : place ${PRICE_PLACEHOLDER} une fois.`;
  return [
    `Langue du message : ${analysis.language === "en" ? "anglais" : "français"}.`,
    range,
    "Points à négocier, tous à reprendre :",
    points || "- aucun point listé",
  ].join("\n");
}

export async function rewriteMessage(
  analysis: Pick<Analysis, "language" | "negotiate" | "counter_offer">,
): Promise<RewriteResult> {
  const { value, usage } = await callStructured<{ text: string }>({
    instructions: REWRITE_INSTRUCTIONS,
    input: [{ role: "user", content: rewriteInput(analysis) }],
    schemaName: "message_reecrit",
    schema: SCHEMA,
    parse: (outputText) => {
      try {
        const parsed = JSON.parse(outputText) as { text?: unknown };
        return typeof parsed.text === "string" && parsed.text.trim().length > 0
          ? { text: parsed.text.trim() }
          : { problem: "text absent" };
      } catch {
        return { problem: "JSON illisible" };
      }
    },
  });
  return { text: value.text, usage };
}
