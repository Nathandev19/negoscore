import type { ResultView } from "@/lib/analysis/lock";
import { recomputeForDeal, recomputeForTier } from "@/lib/analysis/recompute";
import type { Thread } from "@/lib/negotiation/store";
import type { Tier } from "@/lib/rates/tier";

// Mission #086 — les chiffres qu'une personne juge en répondant « Cette
// estimation te paraît juste ? » : ceux que la page affiche pour ce tour, au
// niveau affiché, recalculés ici par le même code que la page
// (components/result/analysis-result.tsx) :
//   - tour 0 : l'offre d'origine ;
//   - tour 2 à 5 : les termes après ce tour (ceux de la conclusion pour le
//     dernier tour s'il y en a une), avec la table de l'analyse.
// Table de l'analyse disparue du code : la page montre les chiffres d'origine,
// l'avis porte donc sur eux, et il est enregistré comme tour 0.
// null : ce tour n'existe pas dans le fil.
export function judgedFigures(
  original: ResultView,
  tier: Tier,
  thread: Pick<Thread, "turns" | "conclusion"> | null,
  turn: number,
): { analysis: ResultView; turn: number } | null {
  const atTier = recomputeForTier(original, tier);
  if (turn === 0) return { analysis: atTier, turn: 0 };
  const stored = thread?.turns.find((candidate) => candidate.turnNumber === turn);
  if (!thread || !stored) return null;
  const last = thread.turns.at(-1) === stored;
  const deal = last && thread.conclusion ? thread.conclusion.payload.deal : stored.payload.deal_after;
  const recomputed = recomputeForDeal(atTier, deal);
  return recomputed ? { analysis: recomputed, turn } : { analysis: atTier, turn: 0 };
}
