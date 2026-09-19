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
    ...(offer.amount_low !== null
      ? [{ id: PRICE_ASK_ID, label: "La rémunération demandée (ta contre-offre)", status: "unanswered" as const, quote: null, turn: null, global: false, aligned_group: null, aligned_turn: null }]
      : []),
    ...offer.changes.map((change, index) => ({ id: `c${index + 1}`, label: change, status: "unanswered" as const, quote: null, turn: null, global: false, aligned_group: null, aligned_turn: null })),
  ];
}

// Statuts de ce tour, vérifiés : un statut autre que « sans réponse » n'est
// retenu qu'avec une citation exacte de la marque (F4). Sans elle, la demande
// reste où elle en était, et le doute est signalé.
//
// Mission #080 quater, A7 — une citation est la preuve d'UN point. Accord
// global (« c'est d'accord pour tout ») : il est dit comme tel, et les demandes
// sans citation propre sont accordées à ce titre. Une même phrase collée comme
// preuve de plusieurs demandes est traitée de la même façon : c'est un accord
// global, pas une réponse point par point, et l'écran le dit.
export function mergeAsks(
  previous: readonly Ask[],
  reading: Pick<TurnReading, "asks" | "global_agreement">,
  brandReply: string,
  turn: number,
): { asks: Ask[]; unverified: string[]; globalAgreement: string | null } {
  const unverified: string[] = [];
  const counts = new Map<string, number>();
  for (const read of reading.asks) {
    // Seuls les accords comptent : un refus en bloc cité sur chaque demande
    // reste un refus de chacune (issue « refused »), pas un accord global.
    if (read.status === "granted" && read.quote) counts.set(read.quote.trim(), (counts.get(read.quote.trim()) ?? 0) + 1);
  }
  const stamped = [...counts.entries()].find(([, n]) => n >= 2)?.[0] ?? null;
  const declared = reading.global_agreement && quoteIsIn(reading.global_agreement, brandReply) ? reading.global_agreement : null;
  const globalAgreement = declared ?? (stamped && quoteIsIn(stamped, brandReply) ? stamped : null);

  const asks = previous.map((ask) => {
    const read = reading.asks.find((candidate) => candidate.id === ask.id);
    if (!read || read.status === "unanswered") return ask;
    const viaGlobal = globalAgreement !== null && (read.quote === null || read.quote.trim() === globalAgreement.trim());
    if (viaGlobal) {
      // Un accord global n'accorde que : il ne refuse ni ne contre-propose rien.
      if (read.status !== "granted") return ask;
      return { ...ask, status: "granted" as const, quote: globalAgreement, turn, global: true };
    }
    if (!quoteIsIn(read.quote, brandReply)) {
      unverified.push(ask.label);
      return ask;
    }
    return { ...ask, status: read.status, quote: read.quote, turn, global: false };
  });
  return { asks, unverified, globalAgreement };
}

// Demandes qui restent à obtenir : sans réponse, refusées ou contre-proposées.
export function openAsks(asks: readonly Ask[]): Ask[] {
  return asks.filter((ask) => ask.status !== "granted");
}
