import {
  conclusionPayloadSchema,
  turnPayloadSchema,
  type ConclusionPayload,
  type TurnPayload,
} from "@/lib/negotiation/types";
import { isMissingColumn, isMissingRelation, selectRows } from "@/lib/supabase/server";

// Mission #080 — le fil d'une analyse, lu dans negotiation_turns (migration
// 20260919000022). Écrit et lu uniquement par le serveur, après contrôle du
// propriétaire de l'analyse par la route ou la page.

export const TURNS_TABLE = "negotiation_turns";

export type StoredTurn = {
  id: string;
  turnNumber: number;
  // null : effacée par la purge des 30 jours.
  brandReply: string | null;
  createdAt: string;
  payload: TurnPayload;
};

export type Thread = {
  turns: StoredTurn[];
  // Conclusion décidée par la personne (ligne « conclusion »), ou portée par le
  // tour où la marque a accepté.
  conclusion: { createdAt: string; payload: ConclusionPayload } | null;
};

type Row = {
  id: string;
  kind: "reply" | "conclusion";
  turn_number: number | null;
  brand_reply: string | null;
  payload: unknown;
  idempotency_key: string | null;
  created_at: string;
};

// "missing" : table absente (migration pas encore appliquée). Le fil ne
// s'affiche pas, et la route refuse proprement.
export async function loadThread(analysisId: string): Promise<Thread | "missing"> {
  let rows: Row[];
  try {
    rows = await selectRows<Row>(
      TURNS_TABLE,
      `select=id,kind,turn_number,brand_reply,payload,idempotency_key,created_at&analysis_id=eq.${analysisId}&order=created_at.asc`,
    );
  } catch (caught) {
    if (isMissingRelation(caught) || isMissingColumn(caught)) return "missing";
    throw caught;
  }
  const turns: StoredTurn[] = [];
  let conclusion: Thread["conclusion"] = null;
  for (const row of rows) {
    if (row.kind === "reply" && row.turn_number !== null) {
      const parsed = turnPayloadSchema.safeParse(row.payload);
      // Tour illisible (schéma inconnu) : écarté plutôt qu'affiché de travers.
      if (parsed.success) {
        turns.push({ id: row.id, turnNumber: row.turn_number, brandReply: row.brand_reply, createdAt: row.created_at, payload: parsed.data });
      }
    } else if (row.kind === "conclusion") {
      const parsed = conclusionPayloadSchema.safeParse(row.payload);
      if (parsed.success) conclusion = { createdAt: row.created_at, payload: parsed.data };
    }
  }
  turns.sort((a, b) => a.turnNumber - b.turnNumber);
  return { turns, conclusion };
}

export function threadConcluded(thread: Thread): boolean {
  return thread.conclusion !== null || thread.turns.some((turn) => turn.payload.conclusion !== null);
}

// Clé d'idempotence (D4) : tour déjà enregistré sous cette clé pour cette
// analyse (rejeu : rien n'est refait ni décompté), ou clé déjà prise ailleurs
// (elle n'est pas réécrite).
export async function turnForKey(analysisId: string, key: string): Promise<{ kind: "turn"; turnNumber: number } | { kind: "taken" } | null> {
  const [row] = await selectRows<{ turn_number: number | null; analysis_id: string }>(
    TURNS_TABLE,
    `select=turn_number,analysis_id&idempotency_key=eq.${encodeURIComponent(key)}&limit=1`,
  );
  if (!row) return null;
  if (row.analysis_id !== analysisId || row.turn_number === null) return { kind: "taken" };
  return { kind: "turn", turnNumber: row.turn_number };
}
