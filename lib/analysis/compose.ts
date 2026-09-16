import { evaluability, incompleteRequestMessage, termsRequestMessage } from "@/lib/analysis/evaluability";
import { normalizeDeal } from "@/lib/analysis/normalize";
import { computeEscalation } from "@/lib/legal/escalate";
import { computeFrLegal } from "@/lib/legal/fr";
import { PRICE_PLACEHOLDER, type Extraction } from "@/lib/llm/prompt";
import { formatEur } from "@/lib/money";
import { computeEstimate, isFarAboveOffer } from "@/lib/rates/engine";
import { computeScore } from "@/lib/rates/score";
import { analysisSchema, type Analysis } from "@/lib/schema";

export const SCHEMA_VERSION = "1.2";

export const UNPRICED_ASSUMPTION =
  "Fourchette indicative : elle est calculée à partir des contenus et des droits décrits dans l'offre. La marque n'a donné aucun montant, rien ne permet donc de la confronter à son budget.";
export const TERMS_UNKNOWN_ASSUMPTION =
  "Conditions inconnues : l'offre ne précise pas assez la durée, le territoire, le délai de paiement, l'exclusivité, les droits cédés ou les révisions. La fourchette dit ce que valent les contenus demandés, pas si l'échange est équilibré.";
export const INCOMPLETE_ASSUMPTION =
  "Pas d'estimation : l'offre ne dit pas assez précisément ce qui est demandé pour être chiffrée.";

type ComposeOptions = { extraAssumptions?: string[] };

// Assemble la sortie du modèle et les calculs déterministes en une analyse
// conforme au schéma complet. Tous les montants viennent du moteur de tarifs.
export function composeAnalysis(extraction: Extraction, options: ComposeOptions = {}): Analysis {
  // Deal mis en cohérence avant tout calcul, et c'est lui qui est enregistré.
  const deal = normalizeDeal(extraction.deal);
  const state = evaluability(deal);
  const extraAssumptions = options.extraAssumptions ?? [];
  const computed = computeEstimate(deal);

  // « incomplete » : on ne sait pas ce qui est livré ni ce que la marque en
  // fera. Toute valeur serait inventée, donc l'estimation est vide (bornes à
  // null, aucune ligne) et le score vaut null, plutôt qu'un 50 par défaut.
  // Le moteur n'est pas modifié : on ne garde simplement pas son résultat.
  const lines = state === "incomplete" ? [] : computed.lines;
  const estimate: Analysis["estimate"] =
    state === "incomplete"
      ? {
          base_low: null,
          base_high: null,
          lines: [],
          total_low: null,
          total_high: null,
          assumptions: [...extraAssumptions, INCOMPLETE_ASSUMPTION],
          rate_table_version: computed.rate_table_version,
        }
      : {
          ...computed,
          lines: computed.lines.map((line) => ({
            label: line.label,
            type: line.type,
            low: line.low,
            high: line.high,
            eur_low: line.eur_low,
            eur_high: line.eur_high,
          })),
          // « unpriced » et « terms_unknown » : l'estimation reste un repère
          // utile, avec ce qu'elle ne permet pas de dire.
          assumptions: [
            ...extraAssumptions,
            ...(state === "unpriced" ? [UNPRICED_ASSUMPTION] : []),
            ...(state === "terms_unknown" ? [TERMS_UNKNOWN_ASSUMPTION] : []),
            ...computed.assumptions,
          ],
        };

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
    language: extraction.language,
    confidence,
    input_quality: extraction.input_quality,
    deal,
    // Un verdict de qualité seulement quand l'offre est complète.
    score: state === "complete" ? computeScore(deal, estimate) : null,
    good_points: extraction.good_points,
    negotiate,
    red_flags: extraction.red_flags,
    estimate,
    fr_legal: computeFrLegal(deal),
    escalate_to_professional: computeEscalation(deal),
    counter_offer: {
      amount_low: estimate.total_low,
      amount_high: estimate.total_high,
      changes: extraction.counter_offer.changes,
    },
    ready_to_send_message: {
      tone: extraction.ready_to_send_message.tone,
      // Offre incomplète ou aux conditions inconnues : aucun tarif annoncé, le
      // message demande ce qui manque pour pouvoir juger.
      text:
        state === "incomplete"
          ? incompleteRequestMessage(deal, extraction.language)
          : state === "terms_unknown"
            ? termsRequestMessage(deal, extraction.language)
            : fillPrice(extraction.ready_to_send_message.text, extraction.language, estimate),
    },
  };

  return analysisSchema.parse(analysis);
}

// Le modèle produit parfois deux points de négociation pour le même sujet
// (« encadrer les droits pub » et « clarifier les droits pub »). On n'en garde
// qu'un par sujet : celui qui porte le chiffrage, et on ajoute l'explication de
// l'autre si elle apporte quelque chose. Le sujet « other » regroupe des points
// sans rapport entre eux : il n'est pas dédoublonné.
function mergeNegotiate(
  items: Extraction["negotiate"],
  lines: ReturnType<typeof computeEstimate>["lines"],
): Analysis["negotiate"] {
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
    const topicLines = lines.filter((line) => line.topic === item.topic);
    const entry = {
      label: item.label,
      why: item.why,
      priority: item.priority,
      eur_impact_low: topicLines.length > 0 ? topicLines.reduce((sum, l) => sum + l.eur_low, 0) : null,
      eur_impact_high: topicLines.length > 0 ? topicLines.reduce((sum, l) => sum + l.eur_high, 0) : null,
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

function fillPrice(text: string, language: Analysis["language"], estimate: Analysis["estimate"]): string {
  if (!text.includes(PRICE_PLACEHOLDER)) return text;
  const { total_low: low, total_high: high } = estimate;
  let price: string;
  if (low !== null && high !== null) {
    price =
      language === "en"
        ? `between ${formatEur(low, "en")} and ${formatEur(high, "en")}`
        : `entre ${formatEur(low)} et ${formatEur(high)}`;
  } else {
    price = language === "en" ? "a rate I will detail in my quote" : "un tarif que je vous détaille dans mon devis";
  }
  return text.replaceAll(PRICE_PLACEHOLDER, price);
}
