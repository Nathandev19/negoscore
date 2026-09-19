import type { ResultView } from "@/lib/analysis/lock";
import { checkQuote } from "@/lib/negotiation/quotes";
import type { Ask, Outcome, TurnReading } from "@/lib/negotiation/types";

// Mission #080, B2 — ce qui a été demandé à la marque, et ce qu'elle en a fait.
// Les demandes sont celles de l'analyse d'origine : la contre-offre chiffrée
// (si le moteur en a produit une) et les changements de conditions. Leur
// statut se met à jour tour après tour ; une demande accordée ou refusée le
// reste tant que la marque ne revient pas dessus.

export const PRICE_ASK_ID = "prix";

// Une demande encore sans réponse.
export function newAsk(id: string, label: string): Ask {
  return { id, label, status: "unanswered", quote: null, turn: null, global: false, aligned_group: null, aligned_turn: null, remaining: null, unverified_turn: null };
}

export function originalAsks(analysis: ResultView): Ask[] {
  const offer = analysis.counter_offer;
  if (!offer) return [];
  return [
    ...(offer.amount_low !== null ? [newAsk(PRICE_ASK_ID, "La rémunération demandée (ta contre-offre)")] : []),
    ...offer.changes.map((change, index) => newAsk(`c${index + 1}`, change)),
  ];
}

// Ce qui reste à préciser d'une demande accordée en partie, quand le modèle ne
// l'a pas dit : jamais une case vide à l'écran.
export const REMAINING_FALLBACK = "ce que la marque n'a pas repris de ta demande";

// Demande dont la lecture n'a pas été retenue. clause : la phrase entière de la
// marque quand la citation l'avait coupée de sa négation ou de sa condition.
export type Unverified = { label: string; clause: string | null };

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
  reading: { global_agreement: TurnReading["global_agreement"]; asks: ReadonlyArray<Omit<TurnReading["asks"][number], "remaining"> & { remaining?: string | null }> },
  brandReply: string,
  turn: number,
): { asks: Ask[]; unverified: Unverified[]; globalAgreement: string | null } {
  const unverified: Unverified[] = [];
  const counts = new Map<string, number>();
  for (const read of reading.asks) {
    // Seuls les accords comptent : un refus en bloc cité sur chaque demande
    // reste un refus de chacune (issue « refused »), pas un accord global.
    if (read.status === "granted" && read.quote) counts.set(read.quote.trim(), (counts.get(read.quote.trim()) ?? 0) + 1);
  }
  const stamped = [...counts.entries()].find(([, n]) => n >= 2)?.[0] ?? null;
  const declared = reading.global_agreement && checkQuote(reading.global_agreement, brandReply).ok ? reading.global_agreement : null;
  const globalAgreement = declared ?? (stamped && checkQuote(stamped, brandReply).ok ? stamped : null);

  const asks = previous.map((ask) => {
    const read = reading.asks.find((candidate) => candidate.id === ask.id);
    if (!read || read.status === "unanswered") return ask;
    const viaGlobal = globalAgreement !== null && (read.quote === null || read.quote.trim() === globalAgreement.trim());
    if (viaGlobal) {
      // Un accord global n'accorde que : il ne refuse ni ne contre-propose rien.
      if (read.status !== "granted") return ask;
      return { ...ask, status: "granted" as const, quote: globalAgreement, turn, global: true, unverified_turn: null };
    }
    // Mission #081 : présente mot pour mot ET non coupée de ce qui la nie ou
    // la conditionne (lib/negotiation/quotes.ts, checkQuote).
    const check = checkQuote(read.quote, brandReply);
    if (!check.ok) {
      unverified.push(check.reason === "cut" ? { label: ask.label, clause: check.clause } : { label: ask.label, clause: null });
      // Mission #083, A1 — la demande garde son statut d'avant, mais l'écran
      // ne peut plus la dire « sans réponse » : la marque a peut-être répondu.
      return { ...ask, unverified_turn: turn };
    }
    return {
      ...ask,
      status: read.status,
      quote: read.quote,
      turn,
      global: false,
      remaining: read.status === "partial" ? read.remaining?.trim() || REMAINING_FALLBACK : null,
      unverified_turn: null,
    };
  });
  return { asks, unverified, globalAgreement };
}

// Mission #083, D — le titre du tour se déduit des statuts affichés sous lui,
// pas de ce que le modèle en dit. Ne comptent que les réponses vérifiées de CE
// tour. Règles :
//   - toutes les demandes accordées (dans ce tour ou avant) : « accepte » ;
//   - des demandes accordées (même en partie) et plus d'accords que de refus et
//     contre-propositions réunis, ou aucune contre-proposition : « accepte en
//     partie » ;
//   - sinon une contre-proposition : « propose d'autres termes » ; sinon
//     seulement des refus : « refuse » ;
//   - aucune réponse vérifiée : des termes changés, preuve à l'appui, sont une
//     proposition ; sinon une question de la marque, ou le titre du modèle s'il
//     ne prétend rien que l'écran ne montre (« ne tranche pas », « refuse »).
//     Un accord ou une contre-proposition que rien ne montre devient « ne
//     tranche pas ».
// Sans aucune demande suivie (pas de contre-offre), rien à compter : le titre
// du modèle est gardé.
export function outcomeFromAsks(
  asks: readonly Ask[],
  turn: number,
  { model, changed, questions }: { model: Outcome; changed: boolean; questions: number },
): Outcome {
  if (asks.length === 0) return model;
  const now = asks.filter((ask) => ask.turn === turn && ask.status !== "unanswered");
  const count = (...statuses: Ask["status"][]) => now.filter((ask) => statuses.includes(ask.status)).length;
  const yes = count("granted", "partial");
  const no = count("refused", "countered");
  if (now.length === 0) {
    if (changed) return "counter";
    if (questions > 0) return "question";
    return model === "refused" || model === "question" ? model : "vague";
  }
  // Tout est accordé, dans ce tour ou dans un précédent.
  if (asks.every((ask) => ask.status === "granted")) return "accepted";
  if (yes > 0 && (yes > no || count("countered") === 0)) return "partial";
  return count("countered") > 0 ? "counter" : "refused";
}

// Demandes qui restent à obtenir : sans réponse, refusées ou contre-proposées.
export function openAsks(asks: readonly Ask[]): Ask[] {
  return asks.filter((ask) => ask.status !== "granted");
}
