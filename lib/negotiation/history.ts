import type { ResultView } from "@/lib/analysis/lock";
import { recomputeForDeal } from "@/lib/analysis/recompute";
import { currentState } from "@/lib/negotiation/current";
import type { Deal } from "@/lib/negotiation/types";

// Mission #087 — l'historique montre les deals qui ont bougé. Pour une analyse
// avec des tours : où en est l'échange (tour N, ou conclu), et le montant et le
// score ACTUELS, ceux que la page de résultat affiche en tête à son ouverture
// (même calcul : recomputeForDeal, au niveau enregistré, avec la table de
// l'analyse). Table disparue du code : aucun recalcul, le score reste celui
// d'origine, et c'est dit.
//
// Coût : aucun appel au modèle. Le recalcul est celui du moteur, en mémoire,
// de l'ordre du centième de milliseconde par ligne (mesuré) ; il ne porte que
// sur les analyses qui ont des tours.

// Une ligne de negotiation_turns telle que l'historique la lit : ni la réponse
// collée, ni le message, seulement ce qui fixe l'état et les termes.
export type HistoryTurnRow = {
  analysis_id: string;
  kind: "reply" | "conclusion";
  turn_number: number | null;
  // reply : termes après ce tour.
  deal_after: Deal | null;
  // conclusion : termes retenus.
  deal: Deal | null;
  // reply : « brand_accepted » si la marque a accepté dans ce tour.
  accepted: string | null;
};

export type NegotiationSummary = {
  // Dernier tour de l'échange (2 à 5).
  turn: number;
  concluded: boolean;
  amountNow: number | null;
  // null : la table de l'analyse n'existe plus, rien n'est recalculé.
  now: { score: number | null; evaluability: ResultView["evaluability"] } | null;
};

export function summarizeNegotiation(analysis: ResultView, rows: readonly HistoryTurnRow[]): NegotiationSummary | null {
  const replies = rows
    .filter((row) => row.kind === "reply" && row.turn_number !== null && row.deal_after !== null)
    .sort((a, b) => (a.turn_number as number) - (b.turn_number as number));
  if (replies.length === 0) return null;
  const conclusionRow = rows.find((row) => row.kind === "conclusion" && row.deal !== null) ?? null;
  const state = currentState({
    turns: replies.map((row) => ({ turnNumber: row.turn_number as number, payload: { deal_after: row.deal_after as Deal } })),
    conclusion: conclusionRow ? { payload: { deal: conclusionRow.deal as Deal } } : null,
  });
  if (!state) return null;
  const recomputed = recomputeForDeal(analysis, state.deal);
  return {
    turn: state.turn,
    concluded: conclusionRow !== null || replies.some((row) => row.accepted !== null),
    amountNow: state.deal.payment.amount_eur,
    now: recomputed ? { score: recomputed.score?.value ?? null, evaluability: recomputed.evaluability } : null,
  };
}
