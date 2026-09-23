import { normalizeDeal } from "@/lib/analysis/normalize";
import { groupLabel } from "@/lib/negotiation/terms";
import { topicsOf } from "@/lib/negotiation/topics";
import { TERM_GROUPS, type Deal, type TermGroup } from "@/lib/negotiation/types";

// Mission #084 — l'état actuel du deal, après les tours de négociation, et ce
// qui a changé depuis l'offre d'origine. Aucune partie de la page ne doit
// affirmer un terme que cet état contredit.

// Termes actuels : ceux de la conclusion s'il y en a une, sinon ceux du dernier
// tour. null : aucun tour, la page décrit l'offre telle qu'elle a été analysée.
// Mission #100, point 4 — ceiling : le plafond annoncé par la marque au
// dernier tour (mission #096). Les TERMES ne le retiennent pas ; ce qu'on
// propose d'accepter, si. La carte partageable doit dire le même montant que
// l'écran de conclusion, donc elle lit la même chose.
export type Negotiated = { deal: Deal; turn: number; ceiling: number | null };

type ThreadLike = {
  turns: ReadonlyArray<{ turnNumber: number; payload: { deal_after: Deal; stated_ceiling?: number | null } }>;
  conclusion: { payload: { deal: Deal } } | null;
};

export function currentState(thread: ThreadLike | null): Negotiated | null {
  const last = thread?.turns.at(-1);
  if (!thread || !last) return null;
  return {
    deal: thread.conclusion?.payload.deal ?? last.payload.deal_after,
    turn: last.turnNumber,
    ceiling: last.payload.stated_ceiling ?? null,
  };
}

// Groupes de termes dont la valeur lisible a changé depuis l'offre d'origine.
export function changedGroups(origin: Deal, current: Deal): Set<TermGroup> {
  const before = normalizeDeal(origin);
  const after = normalizeDeal(current);
  return new Set(TERM_GROUPS.filter((group) => groupLabel(before, group) !== groupLabel(after, group)));
}

// Textes du modèle, écrits sur l'offre d'origine (points forts, red flags,
// points à négocier) : ils ne se recalculent pas sans nouvel appel. Un point
// qui parle d'un terme changé depuis est RETIRÉ, plutôt que laissé affirmer une
// valeur que les termes actuels démentent. Le sujet est lu dans son titre et
// son explication (lib/negotiation/topics.ts).
const DURATION = /(?<![\p{L}])dur[ée]e|\d+\s*(?:mois|jours?|ans?|semaines?)(?![\p{L}])/iu;
const DURATION_GROUPS: readonly TermGroup[] = ["usage_duration", "exclusivity", "payment_terms"];

export function splitByChange<T extends { label: string; why: string }>(
  items: readonly T[],
  changed: ReadonlySet<TermGroup>,
): { kept: T[]; withdrawn: T[] } {
  const kept: T[] = [];
  const withdrawn: T[] = [];
  for (const item of items) {
    // Le sujet se lit dans le titre (« Paiement à 60 jours », « Des droits pub
    // limités dans le temps ») : l'explication parle souvent d'autre chose
    // (« refaire les vidéos »). Titre sans sujet : l'explication compte si elle
    // cite un chiffre (« 6 mois, c'est borné »), qu'un terme changé démentirait.
    const titled = topicsOf(item.label).flatMap((topic) => topic.groups);
    const text = titled.length > 0 || !/\d/.test(item.why) ? item.label : `${item.label} ${item.why}`;
    const groups = titled.length > 0 ? titled : topicsOf(text).flatMap((topic) => topic.groups);
    // Une durée sans sujet nommé (« durée limitée à 12 mois ») peut être celle
    // des droits, de l'exclusivité ou du délai de paiement : si l'une a changé,
    // le point est retiré, faute de savoir laquelle il affirme. Un sujet nommé
    // (« exclusivité… 3 mois ») dit à quoi la durée se rapporte.
    if (DURATION.test(text) && !groups.some((group) => DURATION_GROUPS.includes(group))) groups.push(...DURATION_GROUPS);
    (groups.some((group) => changed.has(group)) ? withdrawn : kept).push(item);
  }
  return { kept, withdrawn };
}
