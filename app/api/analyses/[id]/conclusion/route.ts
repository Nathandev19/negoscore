import { loadResultForViewer } from "@/lib/analysis/load";
import { getRequestUser } from "@/lib/auth/request-user";
import { loadThread, threadConcluded, TURNS_TABLE } from "@/lib/negotiation/store";
import { concludeNow } from "@/lib/negotiation/turn";
import { TURN_SCHEMA_VERSION, type ConclusionPayload } from "@/lib/negotiation/types";
import { parseTier } from "@/lib/rates/tier";
import { insertRow, SupabaseRequestError } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Mission #080, C — « J'accepte ces termes » : la personne décide d'accepter
// l'échange en l'état, sans nouvelle réponse de la marque. La conclusion est
// écrite par le code (lib/negotiation/conclusion.ts) : aucun appel au modèle,
// aucun crédit. Ouverte à la personne connectée qui a lancé l'analyse, quelle
// que soit sa formule (mission #080 ter).

const UNAVAILABLE = "La conclusion n'a pas pu être enregistrée. Réessaie plus tard.";

function json(status: number, body: Record<string, unknown>) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, { params }: RouteContext<"/api/analyses/[id]/conclusion">) {
  const { id } = await params;
  const user = await getRequestUser(request);
  if (!user) return json(401, { error: "Connecte-toi pour conclure l'échange.", reason: "signed_out" });
  const body = (await request.json().catch(() => null)) as { tier?: unknown } | null;
  const tier = parseTier(body?.tier);
  if (!tier) return json(400, { error: "Recharge la page et réessaie." });

  try {
    const result = await loadResultForViewer(id, { user, anonToken: null });
    if (!result || !result.unlocked) return json(404, { error: "Analyse introuvable." });
    const thread = await loadThread(id);
    if (thread === "missing") return json(503, { error: UNAVAILABLE });
    if (threadConcluded(thread)) return json(200, { concluded: true });

    const previous = thread.turns.map((turn) => turn.payload);
    const { deal, conclusion } = concludeNow(result.analysis, previous, tier);
    const payload: ConclusionPayload = { schema_version: TURN_SCHEMA_VERSION, tier, deal, conclusion };
    try {
      await insertRow(TURNS_TABLE, {
        analysis_id: id,
        user_id: user.id,
        kind: "conclusion",
        payload,
        rate_table_version: result.analysis.estimate.rate_table_version,
      });
    } catch (caught) {
      // Deux clics : l'index unique garde une seule conclusion.
      if (caught instanceof SupabaseRequestError && caught.code === "23505") return json(200, { concluded: true });
      throw caught;
    }
    console.log(JSON.stringify({ event: "echange_conclu", source: "creator_accepted", turns: thread.turns.length, unclear: conclusion.unclear.length }));
    return json(200, { concluded: true });
  } catch (caught) {
    console.error(JSON.stringify({ event: "conclusion_failed", detail: caught instanceof Error ? caught.message.slice(0, 300) : "inconnu" }));
    return json(503, { error: UNAVAILABLE });
  }
}
