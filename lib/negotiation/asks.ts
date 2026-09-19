import type { ResultView } from "@/lib/analysis/lock";
import { quoteIsIn } from "@/lib/negotiation/quotes";
import type { Ask, TurnReading } from "@/lib/negotiation/types";

// Mission #080, B2 — ce qui a été demandé à la marque, et ce qu'elle en a fait.
// Les demandes sont celles de l'analyse d'origine : la contre-offre chiffrée
// (si le moteur en a produit une) et les changements de conditions. Leur
// statut se met à jour tour après tour ; une demande accordée ou refusée le
// reste tant que la marque ne revient pas dessus.

export const PRICE_ASK_ID = "prix";

export function originalAsks(analysis: ResultView): Ask[] {
  const offer = analysis.counter_offer;
  if (!offer) return [];
  return [
    ...(offer.amount_low !== null ? [{ id: PRICE_ASK_ID, label: "La rémunération demandée (ta contre-offre)", status: "unanswered" as const, quote: null, turn: null }] : []),
    ...offer.changes.map((change, index) => ({ id: `c${index + 1}`, label: change, status: "unanswered" as const, quote: null, turn: null })),
  ];
}

// Statuts de ce tour, vérifiés : un statut autre que « sans réponse » n'est
// retenu qu'avec une citation exacte de la marque (F4). Sans elle, la demande
// reste où elle en était, et le doute est signalé.
export function mergeAsks(
  previous: readonly Ask[],
  reading: Pick<TurnReading, "asks">,
  brandReply: string,
  turn: number,
): { asks: Ask[]; unverified: string[] } {
  const unverified: string[] = [];
  const asks = previous.map((ask) => {
    const read = reading.asks.find((candidate) => candidate.id === ask.id);
    if (!read || read.status === "unanswered") return ask;
    if (!quoteIsIn(read.quote, brandReply)) {
      unverified.push(ask.label);
      return ask;
    }
    return { ...ask, status: read.status, quote: read.quote, turn };
  });
  return { asks, unverified };
}

// Demandes qui restent à obtenir : sans réponse, refusées ou contre-proposées.
export function openAsks(asks: readonly Ask[]): Ask[] {
  return asks.filter((ask) => ask.status !== "granted");
}
