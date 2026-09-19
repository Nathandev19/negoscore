import { loadResultForViewer } from "@/lib/analysis/load";
import { getRequestUser } from "@/lib/auth/request-user";
import { cleanSentText, saveSentMessage } from "@/lib/negotiation/sent";
import { loadThread } from "@/lib/negotiation/store";

export const runtime = "nodejs";

// Mission #080 bis, B1 — la créatrice copie un message : le texte à l'écran à
// ce moment est enregistré comme message envoyé pour ce tour. Aucun crédit,
// aucun appel au modèle (B4). Réservé au propriétaire connecté de l'analyse.

function json(status: number, body: Record<string, unknown>) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, { params }: RouteContext<"/api/analyses/[id]/message-envoye">) {
  const { id } = await params;
  const user = await getRequestUser(request);
  if (!user) return json(401, { saved: false });
  const body = (await request.json().catch(() => null)) as { turn?: unknown; text?: unknown } | null;
  const turn = typeof body?.turn === "number" && Number.isInteger(body.turn) ? body.turn : null;
  const text = cleanSentText(body?.text);
  if (turn === null || turn < 1 || turn > 5 || text === null) return json(400, { saved: false });

  try {
    const result = await loadResultForViewer(id, { user, anonToken: null });
    if (!result || !result.unlocked) return json(404, { saved: false });
    // Tour 1 : le message de l'analyse. Au-delà, le tour doit exister.
    if (turn > 1) {
      const thread = await loadThread(id);
      if (thread === "missing" || !thread.turns.some((t) => t.turnNumber === turn)) return json(404, { saved: false });
    }
    const saved = await saveSentMessage({ analysisId: id, userId: user.id, turnNumber: turn, text, source: "copied" });
    return json(saved ? 200 : 503, { saved });
  } catch (caught) {
    console.error(JSON.stringify({ event: "sent_message_error", detail: caught instanceof Error ? caught.message.slice(0, 200) : "inconnu" }));
    return json(503, { saved: false });
  }
}
