import { engineParts, pricePhrase, topicImpact } from "@/lib/analysis/engine-parts";
import { evaluability } from "@/lib/analysis/evaluability";
import type { ResultView } from "@/lib/analysis/lock";
import rates from "@/lib/rates/fr-2026.3.json";
import { LEGACY_ENGINE_ASSUMPTIONS, type EstimateLine } from "@/lib/rates/engine";
import type { Tier } from "@/lib/rates/tier";
import { computeEscalation } from "@/lib/legal/escalate";
import { computeFrLegal } from "@/lib/legal/fr";
import type { Analysis } from "@/lib/schema";

type Deal = Analysis["deal"];

// Changement de niveau sur la page de résultat (mission #039) : tout ce qui
// dépend du niveau est recalculé DANS LE NAVIGATEUR, par le même code que
// l'analyse (lib/analysis/engine-parts.ts). Aucun appel au modèle, aucune
// requête serveur, aucun crédit.
//
// Recalculé : fourchette et détail, hypothèses du moteur, score, impact en euros
// des points à négocier, montants de la contre-offre, prix cité dans le message.
// Inchangé, car indépendant du niveau : le deal, l'évaluabilité, les textes du
// modèle, la couche légale, l'escalade. La confiance reste celle de l'analyse :
// la valeur donnée par le modèle n'est pas conservée, on ne peut donc pas savoir
// si l'alarme de vraisemblance l'avait abaissée (elle n'est affichée que sans
// montant, où elle vaut toujours « low »).

// Le niveau ne peut être changé que si l'analyse a une fourchette et a été
// calculée avec la table actuelle. Avec une table plus ancienne, recalculer
// changerait aussi les chiffres au niveau d'origine : l'historique ne serait
// plus celui qui a été montré.
// fr-2026.2 : mêmes tarifs que fr-2026.3, seul le niveau par défaut a changé
// (confirmed → starter, mission #040). Recalculer un autre niveau d'une analyse
// fr-2026.2 donne donc les chiffres exacts ; revenir à son niveau d'origine rend
// l'analyse enregistrée telle quelle.
const SAME_RATES_VERSIONS: readonly string[] = ["fr-2026.2", rates.version];

export function tierChangeAvailable(analysis: Pick<ResultView, "evaluability" | "estimate">): boolean {
  return analysis.evaluability !== "incomplete" && SAME_RATES_VERSIONS.includes(analysis.estimate.rate_table_version);
}

export function recomputeForTier<T extends ResultView>(analysis: T, tier: Tier): T {
  if (analysis.profile_tier === tier || !tierChangeAvailable(analysis)) return analysis;
  const { deal, evaluability: state, language } = analysis;

  // Ce que le moteur avait écrit au niveau d'origine. Les hypothèses qui n'en
  // viennent pas (texte tronqué…) sont conservées, en tête comme à l'analyse.
  const before = engineParts(deal, state, analysis.profile_tier);
  const engineWritten = new Set([...before.estimate.assumptions, ...LEGACY_ENGINE_ASSUMPTIONS]);
  const extra = analysis.estimate.assumptions.filter((assumption) => !engineWritten.has(assumption));
  const after = engineParts(deal, state, tier, extra);

  const next: T = {
    ...analysis,
    profile_tier: tier,
    estimate: after.estimate,
    score: after.score,
    negotiate: recomputeNegotiate(analysis.negotiate, before.lines, after.lines),
  };
  // Champs absents de la vue verrouillée : rien à recalculer.
  if (analysis.counter_offer) {
    next.counter_offer = { ...analysis.counter_offer, amount_low: after.counter.low, amount_high: after.counter.high };
  }
  // Le message des conditions inconnues ne cite aucun prix.
  if (analysis.ready_to_send_message && state !== "terms_unknown") {
    next.ready_to_send_message = {
      ...analysis.ready_to_send_message,
      text: analysis.ready_to_send_message.text.replaceAll(pricePhrase(language, before.counter), pricePhrase(language, after.counter)),
    };
  }
  return next;
}

// Mission #084 — après un tour de négociation, les termes ont changé. Tout ce
// que le CODE déduit des termes est recalculé sur le deal actuel, par le même
// moteur, sans appel au modèle : évaluabilité, fourchette et détail, score,
// couche légale, escalade. Au même niveau que l'analyse affichée.
// Inchangé ici, et traité par la page : ce qui vient du modèle (points forts,
// red flags, points à négocier) et ce qui a été ENVOYÉ (contre-offre et premier
// message), qui décrivent l'offre d'origine.
export function recomputeForDeal<T extends ResultView>(analysis: T, deal: Deal): T {
  const state = evaluability(deal);
  const before = engineParts(analysis.deal, analysis.evaluability, analysis.profile_tier);
  const engineWritten = new Set([...before.estimate.assumptions, ...LEGACY_ENGINE_ASSUMPTIONS]);
  const extra = analysis.estimate.assumptions.filter((assumption) => !engineWritten.has(assumption));
  const after = engineParts(deal, state, analysis.profile_tier, extra);
  return {
    ...analysis,
    deal,
    evaluability: state,
    estimate: after.estimate,
    score: after.score,
    fr_legal: computeFrLegal(deal),
    escalate_to_professional: computeEscalation(deal),
  };
}

// Impact de chaque point recalculé sur son sujet. Une analyse antérieure au
// schéma 1.4 n'enregistre pas le sujet : il est retrouvé en cherchant le sujet
// dont les lignes, au niveau d'origine, donnent exactement l'impact enregistré.
// Introuvable : le point garde ses montants.
function recomputeNegotiate(items: ResultView["negotiate"], before: EstimateLine[], after: EstimateLine[]): ResultView["negotiate"] {
  const topics = [...new Set(before.map((line) => line.topic))];
  const taken = new Set<string>();
  return items.map((item) => {
    let topic = item.topic;
    if (topic === undefined && item.eur_impact_low !== null) {
      topic = topics.find((candidate) => {
        const impact = topicImpact(candidate, before);
        return !taken.has(candidate) && impact.low === item.eur_impact_low && impact.high === item.eur_impact_high;
      });
    }
    if (topic === undefined) return item;
    taken.add(topic);
    const impact = topicImpact(topic, after);
    return { ...item, eur_impact_low: impact.low, eur_impact_high: impact.high };
  });
}
