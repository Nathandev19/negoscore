import { ImageResponse } from "next/og";
import { recomputeForTier } from "@/lib/analysis/recompute";
import { PREVIEW_STATES, previewAnalysis, type PreviewState } from "@/lib/fixtures/preview-states";
import { parseTier } from "@/lib/rates/tier";
import { loadFonts } from "@/lib/share-card/render";
import { VERDICT_CARD_SIZE, verdictCardAvailable, verdictCardElement } from "@/lib/share-card/verdict-card";
import { carteDeLAnalyse } from "@/lib/share-card/verdict-data";

// DÉVELOPPEMENT UNIQUEMENT (extension .dev.ts, voir next.config.ts) : la carte
// de verdict rendue depuis une fixture, sans base, sans session et sans appel
// au modèle.
// /dev/carte?etat=verrouille|debloque|complete|au-dessus|unpriced|terms_unknown
// &niveau=starter|confirmed|experienced : recalcule au niveau choisi.
// &plafond=1 : le cas « On m'a proposé jusqu'à X €, à confirmer ».
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const requested = params.get("etat") ?? "debloque";
  const state = (PREVIEW_STATES as readonly string[]).includes(requested) ? (requested as PreviewState) : "debloque";
  const { analysis: stored } = previewAnalysis(state);
  const tier = parseTier(params.get("niveau"));
  const data = {
    ...carteDeLAnalyse(tier ? recomputeForTier(stored, tier) : stored),
    plafond: params.get("plafond") === "1",
  };
  if (!verdictCardAvailable(data)) return new Response("Pas de carte pour cet état.", { status: 404 });
  return new ImageResponse(verdictCardElement(data), {
    ...VERDICT_CARD_SIZE,
    fonts: await loadFonts(),
    headers: { "Cache-Control": "no-store" },
  });
}
