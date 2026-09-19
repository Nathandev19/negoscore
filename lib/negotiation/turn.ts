import type { ResultView } from "@/lib/analysis/lock";
import { normalizeDeal } from "@/lib/analysis/normalize";
import { mergeAsks, openAsks, originalAsks, PRICE_ASK_ID } from "@/lib/negotiation/asks";
import { buildConclusion } from "@/lib/negotiation/conclusion";
import { fallbackMessage, finalMessage } from "@/lib/negotiation/message";
import { originPricing, priceFor } from "@/lib/negotiation/pricing";
import { quoteIsIn } from "@/lib/negotiation/quotes";
import { applyGroups, groupLabel } from "@/lib/negotiation/terms";
import {
  TERM_GROUP_LABEL,
  TURN_SCHEMA_VERSION,
  type Ask,
  type Deal,
  type TermChange,
  type TermGroup,
  type TurnPayload,
  type TurnReading,
} from "@/lib/negotiation/types";
import type { Tier } from "@/lib/rates/tier";

// Mission #080 — d'une lecture du modèle à un tour enregistrable.
//
// Fonction PURE : aucune base, aucun réseau. C'est elle que les scénarios de
// réponses de marque (lib/negotiation/scenarios) font tourner en test, avec la
// sortie du modèle enregistrée. Ce que le modèle affirme n'y est retenu qu'avec
// une citation exacte ; ce que l'écran chiffre n'y vient que du moteur.

export type TurnContext = {
  // Analyse d'origine, complète (propriétaire connecté) : tour 1.
  original: ResultView;
  // Tours déjà enregistrés, dans l'ordre.
  previous: readonly TurnPayload[];
  turnNumber: number;
  tier: Tier;
  brandReply: string;
};

export type TurnResult =
  | { kind: "off_topic"; relevance: "other_offer" | "unrelated" | "unsure"; note: string }
  | { kind: "turn"; payload: TurnPayload };

// État à l'entrée d'un tour : le deal et les demandes après le tour précédent,
// ou ceux de l'analyse d'origine.
export function stateBefore(original: ResultView, previous: readonly TurnPayload[]): {
  deal: Deal;
  asks: Ask[];
  changedSinceOrigin: boolean;
} {
  const last = previous.at(-1);
  if (!last) return { deal: normalizeDeal(original.deal), asks: originalAsks(original), changedSinceOrigin: false };
  return { deal: last.deal_after, asks: last.asks, changedSinceOrigin: last.changed_since_origin };
}

export function processTurn(context: TurnContext, reading: TurnReading): TurnResult {
  const { original, previous, turnNumber, tier, brandReply } = context;

  // B3 — pas une réponse à cette offre : on le dit, rien n'est inventé.
  if (reading.relevance !== "reply") {
    return { kind: "off_topic", relevance: reading.relevance, note: reading.relevance_note };
  }

  const before = stateBefore(original, previous);

  // Termes : un groupe n'est repris que s'il est cité mot pour mot ET s'il
  // change réellement quelque chose à l'affichage.
  const verified: TermGroup[] = [];
  const ignored: Array<{ group: TermGroup; quote: string }> = [];
  for (const change of reading.changes) {
    if (verified.includes(change.group)) continue;
    if (quoteIsIn(change.quote, brandReply)) verified.push(change.group);
    else ignored.push(change);
  }
  const candidate = applyGroups(before.deal, reading.deal, verified);
  const changes: TermChange[] = [];
  for (const group of verified) {
    const was = groupLabel(before.deal, group);
    const now = groupLabel(candidate, group);
    if (was === now) continue;
    const quote = reading.changes.find((change) => change.group === group)?.quote ?? "";
    changes.push({ group, before: was, after: now, quote });
  }
  // Seuls les groupes qui changent vraiment sont appliqués : les autres
  // restent identiques octet pour octet.
  const dealAfter = changes.length > 0 ? applyGroups(before.deal, reading.deal, changes.map((c) => c.group)) : before.deal;
  const changedSinceOrigin = before.changedSinceOrigin || changes.length > 0;

  // Chiffrage : rien n'a jamais changé → l'analyse d'origine ; sinon le moteur.
  const pricingBefore = before.changedSinceOrigin ? priceFor(before.deal, tier) : originPricing(original, tier);
  const pricingAfter = changes.length > 0 ? priceFor(dealAfter, tier) : null;
  const current = pricingAfter ?? pricingBefore;

  const merged = mergeAsks(before.asks, reading, brandReply, turnNumber);
  const uncertainties = [
    ...reading.uncertainties,
    ...merged.unverified.map((label) => `ce que la marque répond sur « ${label} » (aucun extrait exact de sa réponse ne le dit)`),
    ...ignored.map((change) => `un changement de « ${TERM_GROUP_LABEL[change.group].toLowerCase()} » que la réponse ne dit pas mot pour mot : il n'a pas été retenu`),
  ];
  // Questions de la marque : seulement celles qu'elle a vraiment posées.
  const questions = reading.brand_questions.filter((q) => quoteIsIn(q.quote, brandReply));

  const counter = { low: current.counter_low, high: current.counter_high };

  // Acceptation : la conclusion ferme l'échange dans ce même tour (D2).
  const accepted = reading.outcome === "accepted";
  const conclusion = accepted
    ? buildConclusion({
        deal: dealAfter,
        asks: merged.asks,
        uncertainties,
        language: original.language,
        source: "brand_accepted",
        // La contre-offre acceptée est celle du message ENVOYÉ, donc d'avant ce
        // tour : un chiffrage refait après coup n'est pas ce que la marque a lu.
        counterAccepted: counterAcceptedWithoutAmount(merged.asks, original, dealAfter)
          ? { low: pricingBefore.counter_low, high: pricingBefore.counter_high }
          : null,
      })
    : null;

  const priceOpen = merged.asks.some((ask) => ask.id === PRICE_ASK_ID && ask.status !== "granted");
  const message = conclusion
    ? { text: conclusion.message, tone: "Poli et clair", fallback: false, fallback_reasons: [] }
    : finalMessage({
        draft: reading.next_message.text,
        tone: reading.next_message.tone,
        deal: dealAfter,
        brandReply,
        language: original.language,
        counter,
        askLabels: merged.asks.map((ask) => ask.label),
        fallback: () =>
          fallbackMessage({
            language: original.language,
            open: openAsks(merged.asks),
            counter,
            priceOpen,
            questions: questions.length,
            refused: reading.outcome === "refused",
          }),
      });

  return {
    kind: "turn",
    payload: {
      schema_version: TURN_SCHEMA_VERSION,
      tier,
      outcome: reading.outcome,
      asks: merged.asks,
      changes,
      ignored_changes: ignored,
      deal_before: before.deal,
      deal_after: dealAfter,
      changed_since_origin: changedSinceOrigin,
      pricing_before: pricingBefore,
      pricing_after: pricingAfter,
      brand_questions: questions,
      uncertainties,
      message,
      conclusion,
    },
  };
}

// La marque a accordé la contre-offre sans écrire d'autre montant que celui de
// son offre de départ : le montant convenu n'est écrit nulle part.
function counterAcceptedWithoutAmount(asks: readonly Ask[], original: ResultView, deal: Deal): boolean {
  const price = asks.find((ask) => ask.id === PRICE_ASK_ID);
  return price?.status === "granted" && deal.payment.amount_eur === normalizeDeal(original.deal).payment.amount_eur;
}

// Conclusion sans nouvelle réponse de la marque : la personne décide
// d'accepter les termes en l'état (C, D2). Aucun appel au modèle.
export function concludeNow(original: ResultView, previous: readonly TurnPayload[], tier: Tier) {
  const state = stateBefore(original, previous);
  const last = previous.at(-1);
  const pricing = last ? (last.pricing_after ?? last.pricing_before) : originPricing(original, tier);
  return {
    deal: state.deal,
    conclusion: buildConclusion({
      deal: state.deal,
      asks: state.asks,
      uncertainties: previous.at(-1)?.uncertainties ?? [],
      language: original.language,
      source: "creator_accepted" as const,
      counterAccepted: counterAcceptedWithoutAmount(state.asks, original, state.deal)
        ? { low: pricing.counter_low, high: pricing.counter_high }
        : null,
    }),
  };
}
