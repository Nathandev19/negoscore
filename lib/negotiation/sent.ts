import { isMissingColumn, isMissingRelation, selectRows, upsertRow } from "@/lib/supabase/server";

// Mission #080 bis, B — le message que la créatrice a réellement envoyé, tour
// par tour (migration 20260919000023). La marque répond à CE message : c'est
// lui qui nourrit la lecture du tour suivant.
//
// Trois sources, dans cet ordre de priorité :
//   1. corrigé au moment de coller la réponse suivante (B3) ;
//   2. le texte à l'écran au moment de la copie (B1) ;
//   3. à défaut, le message proposé par l'outil, gardé comme hypothèse (B2).
// Aucun crédit, aucun appel au modèle (B4) : du texte, enregistré tel quel.

export const SENT_TABLE = "negotiation_sent_messages";
export const MAX_SENT_LENGTH = 8000;

export type SentSource = "copied" | "corrected";
export type SentMessage = { turnNumber: number; text: string; source: SentSource; updatedAt: string };

// Messages enregistrés d'une analyse, par numéro de tour. Table absente
// (migration 023 pas encore appliquée) : aucun, le message proposé fait foi.
export async function loadSentMessages(analysisId: string): Promise<Map<number, SentMessage>> {
  try {
    const rows = await selectRows<{ turn_number: number; text: string; source: SentSource; updated_at: string }>(
      SENT_TABLE,
      `select=turn_number,text,source,updated_at&analysis_id=eq.${analysisId}`,
    );
    return new Map(rows.map((row) => [row.turn_number, { turnNumber: row.turn_number, text: row.text, source: row.source, updatedAt: row.updated_at }]));
  } catch (caught) {
    if (isMissingRelation(caught) || isMissingColumn(caught)) return new Map();
    throw caught;
  }
}

// Remplace le message enregistré pour ce tour. false : table absente.
export async function saveSentMessage(input: {
  analysisId: string;
  userId: string;
  turnNumber: number;
  text: string;
  source: SentSource;
}): Promise<boolean> {
  try {
    await upsertRow(
      SENT_TABLE,
      {
        analysis_id: input.analysisId,
        user_id: input.userId,
        turn_number: input.turnNumber,
        text: input.text,
        source: input.source,
        updated_at: new Date().toISOString(),
      },
      "analysis_id,turn_number",
    );
    return true;
  } catch (caught) {
    if (isMissingRelation(caught) || isMissingColumn(caught)) {
      console.warn(JSON.stringify({ event: "sent_message_missing_table", detail: "Appliquer la migration 20260919000023." }));
      return false;
    }
    throw caught;
  }
}

// Texte d'un message envoyé, tel qu'accepté : sans espaces autour, non vide,
// dans la limite. null : rien à enregistrer.
export function cleanSentText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length === 0 || text.length > MAX_SENT_LENGTH ? null : text;
}

// Le texte qui nourrit la lecture de la réponse suivante (B1 à B3).
export function messageForNextTurn({
  corrected,
  recorded,
  proposed,
}: {
  corrected: string | null;
  recorded: SentMessage | undefined;
  proposed: string;
}): { text: string; basis: "corrected" | "copied" | "proposed" } {
  if (corrected) return { text: corrected, basis: "corrected" };
  if (recorded) return { text: recorded.text, basis: recorded.source === "corrected" ? "corrected" : "copied" };
  return { text: proposed, basis: "proposed" };
}
