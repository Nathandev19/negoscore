import { toneLabel } from "@/lib/tone";
import { engineParts, pricePhrase, topicImpact } from "@/lib/analysis/engine-parts";
import { evaluability, incompleteRequestMessage, termsRequestMessage } from "@/lib/analysis/evaluability";
import { normalizeDeal } from "@/lib/analysis/normalize";
import { computeEscalation } from "@/lib/legal/escalate";
import { computeFrLegal } from "@/lib/legal/fr";
import { completeMessage } from "@/lib/negotiation/coverage";
import { PRICE_PLACEHOLDER, type Extraction } from "@/lib/llm/prompt";
import { isFarAboveOffer, type EstimateLine } from "@/lib/rates/engine";
import { DEFAULT_TIER, type Tier } from "@/lib/rates/tier";
import { analysisSchema, type Analysis } from "@/lib/schema";

export { INCOMPLETE_ASSUMPTION, TERMS_UNKNOWN_ASSUMPTION, UNPRICED_ASSUMPTION } from "@/lib/analysis/engine-parts";

// 1.4 : niveau de calcul (profile_tier) et sujet des points à négocier (mission #039).
export const SCHEMA_VERSION = "1.4";

type ComposeOptions = { extraAssumptions?: string[]; tier?: Tier };

// Assemble la sortie du modèle et les calculs déterministes en une analyse
// conforme au schéma complet. Tous les montants viennent du moteur de tarifs.
export function composeAnalysis(extraction: Extraction, options: ComposeOptions = {}): Analysis {
  // Deal mis en cohérence avant tout calcul, et c'est lui qui est enregistré.
  const deal = normalizeDeal(extraction.deal);
  const state = evaluability(deal);
  const tier = options.tier ?? DEFAULT_TIER;
  const { estimate, lines, score, counter } = engineParts(deal, state, tier, options.extraAssumptions ?? []);

  const negotiate = mergeNegotiate(extraction.negotiate, lines);

  // Sans montant proposé, on ne peut pas être confiant, quoi qu'en dise le modèle.
  // Estimation très au-dessus de l'offre : la confiance ne peut pas rester haute.
  const confidence =
    deal.payment.amount_eur === null
      ? "low"
      : extraction.confidence === "high" && isFarAboveOffer(deal.payment.amount_eur, estimate.total_low)
        ? "medium"
        : extraction.confidence;

  const analysis: Analysis = {
    schema_version: SCHEMA_VERSION,
    evaluability: state,
    profile_tier: tier,
    language: extraction.language,
    confidence,
    input_quality: extraction.input_quality,
    deal,
    score,
    good_points: extraction.good_points,
    negotiate,
    red_flags: extraction.red_flags,
    estimate,
    fr_legal: computeFrLegal(deal),
    escalate_to_professional: computeEscalation(deal),
    counter_offer: {
      amount_low: counter.low,
      amount_high: counter.high,
      changes: extraction.counter_offer.changes,
    },
    ready_to_send_message: {
      tone: toneLabel(extraction.ready_to_send_message.tone),
      // Offre incomplète ou aux conditions inconnues : aucun tarif annoncé, le
      // message demande ce qui manque pour pouvoir juger.
      text:
        state === "incomplete"
          ? incompleteRequestMessage(deal, extraction.language)
          : state === "terms_unknown"
            ? termsRequestMessage(deal, extraction.language)
            : extraction.ready_to_send_message.text.replaceAll(PRICE_PLACEHOLDER, pricePhrase(extraction.language, counter)),
    },
  };

  // Mission #115, A2 et A3 — LE MESSAGE PORTE CE QUE L'ANALYSE A ÉTABLI.
  //
  // Le message vient du modèle ; rien ne vérifiait ce qu'il contenait. Sur une
  // offre d'affiliation sans fixe, il tenait en une phrase — « quel budget
  // est prévu ? » — pendant que l'écran affichait une fourchette, une
  // contre-offre et trois points à négocier.
  //
  // Le complément est DÉTERMINISTE et ne réécrit rien : ce que le modèle a
  // produit reste en tête, ce qui manquait s'ajoute derrière. La route peut
  // demander une seconde version au modèle AVANT d'en arriver là
  // (app/api/analyse/route.ts) ; ici, c'est le filet qui ne laisse jamais
  // partir un message qui oublie ce qui est en jeu.
  //
  // Les deux états sans chiffrage gardent leur message écrit par le moteur :
  // il demande déjà exactement ce qui manque pour pouvoir juger.
  if (state !== "incomplete" && state !== "terms_unknown") {
    analysis.ready_to_send_message.text = completeMessage(analysis, analysis.ready_to_send_message.text);
  }

  return analysisSchema.parse(analysis);
}

// Le modèle produit parfois deux points de négociation pour le même sujet
// (« encadrer les droits pub » et « clarifier les droits pub »). On n'en garde
// qu'un par sujet : celui qui porte le chiffrage, et on ajoute l'explication de
// l'autre si elle apporte quelque chose. Le sujet « other » regroupe des points
// sans rapport entre eux : il n'est pas dédoublonné.
function mergeNegotiate(items: Extraction["negotiate"], lines: EstimateLine[]): Analysis["negotiate"] {
  const byPriority = [...items].sort((a, b) => a.priority - b.priority);
  const kept = new Map<string, Analysis["negotiate"][number]>();
  const result: Analysis["negotiate"][number][] = [];

  for (const item of byPriority) {
    const existing = item.topic === "other" ? undefined : kept.get(item.topic);
    if (existing) {
      if (!sameIdea(existing.why, item.why)) existing.why = `${existing.why} ${item.why}`.trim();
      continue;
    }
    // Le premier point d'un sujet est le plus prioritaire : c'est lui qui porte l'impact.
    const impact = topicImpact(item.topic, lines);
    const entry = {
      label: item.label,
      why: item.why,
      priority: item.priority,
      eur_impact_low: impact.low,
      eur_impact_high: impact.high,
      topic: item.topic,
    };
    if (item.topic !== "other") kept.set(item.topic, entry);
    result.push(entry);
  }

  // Priorités renumérotées après fusion, pour rester 1, 2, 3…
  return result.map((entry, index) => ({ ...entry, priority: index + 1 }));
}

function normalizeWhy(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Deux explications disent la même chose si l'une contient l'autre.
function sameIdea(a: string, b: string): boolean {
  const left = normalizeWhy(a);
  const right = normalizeWhy(b);
  return left.includes(right) || right.includes(left);
}
