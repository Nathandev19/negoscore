import { PREVIEW_STATES, previewAnalysis, type PreviewState } from "@/lib/fixtures/preview-states";
import { shareCardAvailable } from "@/lib/share-card/element";
import { renderShareCard } from "@/lib/share-card/render";

// DÉVELOPPEMENT UNIQUEMENT (extension .dev.ts, voir next.config.ts) : la carte
// partageable rendue depuis une fixture, sans base ni appel au modèle.
// /dev/carte?etat=verrouille|debloque|complete|au-dessus|unpriced|terms_unknown
export async function GET(request: Request) {
  const requested = new URL(request.url).searchParams.get("etat") ?? "debloque";
  const state = (PREVIEW_STATES as readonly string[]).includes(requested) ? (requested as PreviewState) : "debloque";
  const { analysis } = previewAnalysis(state);
  if (!shareCardAvailable(analysis)) return new Response("Pas de carte pour cet état.", { status: 404 });
  return renderShareCard(analysis, { "Cache-Control": "no-store" });
}
