import { analysisSchema } from "@/lib/schema";
import { normalizeDeal } from "@/lib/analysis/normalize";
import { summarizeNegotiation, type HistoryTurnRow, type NegotiationSummary } from "@/lib/negotiation/history";
import { isUuid } from "@/lib/security/request";
import { selectRowsAsUser } from "@/lib/supabase/as-user";
import { selectRows } from "@/lib/supabase/server";

// Mission #087, D — ce que l'historique lit en plus, et seulement pour les
// analyses listées (100 au plus) :
//   1. negotiation_turns, UNE requête pour toutes les lignes : état du fil et
//      termes de chaque tour (payload->deal_after, payload->deal), jamais la
//      réponse collée ni les messages. Filtrée sur le compte ET sur les
//      analyses listées (clé de service : la table n'est pas ouverte au
//      navigateur) ;
//   2. analyses.payload, UNE requête, pour les seules analyses qui ont des
//      tours, sous l'identité de la personne (RLS) : le recalcul en a besoin.
// Puis le moteur, en mémoire. Rien pour une analyse sans tour.
// Échec de lecture (table absente, panne) : null, l'historique s'affiche comme
// avant, sans état d'échange, plutôt que de ne pas s'afficher du tout.
// Mission #107 — les tours du compte, lus SANS attendre la liste des analyses.
//
// Cette requête ne dépendait de la liste que par un filtre de confort
// (analysis_id in …) : elle est déjà bornée au compte par user_id, qui vient
// de la session. Elle peut donc partir EN MÊME TEMPS que la liste, au lieu de
// l'attendre. Le tri et la borne remplacent le filtre : un compte qui aurait
// plus de tours que cette borne n'a de toute façon pas plus de 100 analyses
// listées. Le tri en mémoire, lui, ne change rien à ce qui s'affiche.
//
// null : lecture impossible (table absente, panne). L'historique s'affiche
// alors sans état d'échange, comme avant.
const TURNS_LIMIT = 1000;

export async function loadHistoryTurns(userId: string): Promise<HistoryTurnRow[] | null> {
  if (!isUuid(userId)) return [];
  try {
    return await selectRows<HistoryTurnRow>(
      "negotiation_turns",
      `select=analysis_id,kind,turn_number,deal_after:payload->deal_after,deal:payload->deal,accepted:payload->conclusion->>source&user_id=eq.${userId}&order=created_at.desc&limit=${TURNS_LIMIT}`,
    );
  } catch (caught) {
    console.warn(JSON.stringify({ event: "history_negotiation_unavailable", detail: caught instanceof Error ? caught.message.slice(0, 200) : "inconnu" }));
    return null;
  }
}

// Les résumés, à partir des tours déjà lus et des analyses listées. Une seule
// lecture de plus, et seulement s'il y a des tours à résumer : le recalcul a
// besoin du payload complet, que la liste ne porte pas.
export async function summariesFromTurns(
  turns: readonly HistoryTurnRow[] | null,
  accessToken: string,
  analysisIds: readonly string[],
): Promise<Map<string, NegotiationSummary> | null> {
  if (turns === null) return null;
  const listed = new Set(analysisIds.filter(isUuid));
  const byAnalysis = new Map<string, HistoryTurnRow[]>();
  for (const turn of turns) {
    if (!listed.has(turn.analysis_id)) continue;
    byAnalysis.set(turn.analysis_id, [...(byAnalysis.get(turn.analysis_id) ?? []), turn]);
  }
  const negotiated = [...byAnalysis.keys()].filter((id) => byAnalysis.get(id)?.some((row) => row.kind === "reply"));
  const summaries = new Map<string, NegotiationSummary>();
  if (negotiated.length === 0) return summaries;
  try {
    const payloads = await selectRowsAsUser<{ id: string; payload: unknown }>(
      accessToken,
      "analyses",
      `select=id,payload&id=in.(${negotiated.join(",")})`,
    );
    for (const { id, payload } of payloads) {
      const parsed = analysisSchema.safeParse(payload);
      if (!parsed.success) continue;
      const summary = summarizeNegotiation({ ...parsed.data, deal: normalizeDeal(parsed.data.deal) }, byAnalysis.get(id) ?? []);
      if (summary) summaries.set(id, summary);
    }
    return summaries;
  } catch (caught) {
    console.warn(JSON.stringify({ event: "history_negotiation_unavailable", detail: caught instanceof Error ? caught.message.slice(0, 200) : "inconnu" }));
    return null;
  }
}

// Les deux étapes à la suite. Gardée pour ce qui n'a pas besoin de paralléliser.
export async function loadNegotiationSummaries(
  userId: string,
  accessToken: string,
  analysisIds: readonly string[],
): Promise<Map<string, NegotiationSummary> | null> {
  if (analysisIds.filter(isUuid).length === 0 || !isUuid(userId)) return new Map();
  return summariesFromTurns(await loadHistoryTurns(userId), accessToken, analysisIds);
}
