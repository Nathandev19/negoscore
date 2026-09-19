import { counterOfferRange, type CounterRange } from "@/lib/analysis/anchoring";
import { formatEur } from "@/lib/money";
import { computeEstimate, type EstimateLine } from "@/lib/rates/engine";
import type { RateTable } from "@/lib/rates/tables";
import { computeScore } from "@/lib/rates/score";
import type { Tier } from "@/lib/rates/tier";
import type { Analysis } from "@/lib/schema";

// Partie d'une analyse entièrement calculée par le code à partir du deal et du
// niveau : fourchette, hypothèses, score, contre-offre. Utilisée par
// composeAnalysis au moment de l'analyse, et par le recalcul de niveau dans le
// navigateur (lib/analysis/recompute.ts) : un seul chemin de calcul, pour que
// changer de niveau donne exactement ce qu'une analyse lancée à ce niveau aurait
// donné. Aucun appel au modèle, aucun accès serveur.

type Deal = Analysis["deal"];

export const UNPRICED_ASSUMPTION =
  "Fourchette indicative : elle est calculée à partir des contenus et des droits décrits dans l'offre. La marque n'a donné aucun montant, rien ne permet donc de la confronter à son budget.";
export const TERMS_UNKNOWN_ASSUMPTION =
  "Conditions inconnues : l'offre ne précise pas assez la durée, le territoire, le délai de paiement, l'exclusivité, les droits cédés ou les révisions. La fourchette dit ce que valent les contenus demandés, pas si l'échange est équilibré.";
export const INCOMPLETE_ASSUMPTION =
  "Pas d'estimation : l'offre ne dit pas assez précisément ce qui est demandé pour être chiffrée.";

export type EngineParts = {
  estimate: Analysis["estimate"];
  // Lignes avec leur sujet, pour l'impact des points à négocier.
  lines: EstimateLine[];
  score: Analysis["score"];
  counter: CounterRange;
};

export function engineParts(
  deal: Deal,
  state: Analysis["evaluability"],
  tier: Tier,
  extraAssumptions: readonly string[] = [],
  // Table de l'analyse (mission #085). Absente : la table actuelle, pour une
  // analyse nouvelle uniquement.
  table?: RateTable,
): EngineParts {
  const computed = computeEstimate(deal, { tier, table });

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

  return {
    estimate,
    lines,
    // Un verdict de qualité seulement quand l'offre est complète.
    score: state === "complete" ? computeScore(deal, estimate) : null,
    // La contre-offre ancre au-dessus de l'offre reçue, jamais sur le plancher.
    counter: counterOfferRange(deal.payment.amount_eur, estimate.total_low, estimate.total_high),
  };
}

// Impact en euros d'un sujet de négociation : la somme des lignes de ce sujet.
export function topicImpact(topic: string, lines: readonly EstimateLine[]): { low: number | null; high: number | null } {
  const topicLines = lines.filter((line) => line.topic === topic);
  if (topicLines.length === 0) return { low: null, high: null };
  return {
    low: topicLines.reduce((sum, l) => sum + l.eur_low, 0),
    high: topicLines.reduce((sum, l) => sum + l.eur_high, 0),
  };
}

// Le message cite la contre-offre, jamais l'estimation : annoncer la borne
// basse de l'estimation reviendrait à demander moins que l'offre reçue.
export function pricePhrase(language: Analysis["language"], counter: CounterRange): string {
  const { low, high } = counter;
  if (low !== null && high !== null) {
    return language === "en"
      ? `between ${formatEur(low, "en")} and ${formatEur(high, "en")}`
      : `entre ${formatEur(low)} et ${formatEur(high)}`;
  }
  return language === "en" ? "a rate I will detail in my quote" : "un tarif que je vous détaille dans mon devis";
}
