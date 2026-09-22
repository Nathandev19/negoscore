import { hasUsageRights } from "@/lib/negotiation/terms";
import type { Deal, PointKey, PointState, PointStatus, TermChange, TermGroup } from "@/lib/negotiation/types";

// Mission #095, défaut 2 — la mémoire de la négociation.
//
// Les « demandes » (lib/negotiation/asks.ts) suivent ce que la CRÉATRICE a
// demandé dans sa contre-offre. Elles ne disent rien des points d'information
// qu'un échange doit refermer un par un : territoire, formats, durée des
// contenus, révisions, paiement, durée des droits, exclusivité, validation,
// rémunération. C'est pour ça qu'un point déjà renseigné pouvait être redemandé
// au tour suivant : rien ne le gardait.
//
// Ici, chaque point accumule, tour après tour, son statut et la CITATION
// EXACTE du message de la marque qui le renseigne. La citation est un extrait
// du texte collé, découpé par le code : elle est donc exacte par construction,
// jamais rédigée par le modèle.

export type Point = {
  key: PointKey;
  label: string;
  // Sujet du point dans une phrase de la marque.
  pattern: RegExp;
  // Groupe de termes qui porte ce point, quand il y en a un : un changement de
  // terme vérifié (citation confrontée au texte) renseigne aussi le point.
  group: TermGroup | null;
  // Ce point se pose-t-il pour CE deal ? Une exclusivité que personne ne
  // demande n'a pas à rester éternellement « inconnue ».
  applies: (deal: Deal) => boolean;
};

const word = (body: string) => new RegExp(`(?<![\\p{L}])(?:${body})`, "iu");

export const POINTS: readonly Point[] = [
  {
    key: "amount",
    label: "Rémunération",
    group: "amount",
    pattern: /(?<![\p{L}])(?:budget|rémunér|tarif|cachet|enveloppe|montant|prix|euros?(?![\p{L}]))|€/iu,
    applies: () => true,
  },
  {
    key: "formats",
    label: "Formats",
    group: "deliverables",
    pattern: word("formats?|tiktok|reels?(?![\\p{L}])|stor(?:y|ies)|vidéos?(?![\\p{L}])|posts?(?![\\p{L}])|carrousel|9:16|vertical"),
    applies: () => true,
  },
  {
    key: "content_duration",
    label: "Durée des contenus",
    group: null,
    // Une durée de contenu s'écrit en secondes ou en minutes. Les mois (droits,
    // exclusivité) et les jours (paiement) ne sont pas des durées de contenu.
    pattern: /\d+\s*(?:à\s*\d+\s*)?(?:secondes?|sec(?![\p{L}])|minutes?|min(?![\p{L}]))/iu,
    applies: () => true,
  },
  {
    key: "revisions",
    label: "Révisions",
    group: null,
    pattern: word("révisions?|retouches?|allers?[- ]retours?|corrections?"),
    applies: () => true,
  },
  {
    key: "payment",
    label: "Délai et modalités de paiement",
    group: "payment_terms",
    pattern: word("paiement|règlement|acompte|factur|virement|pay(?:é|er|able|ons)(?![\\p{L}])"),
    applies: () => true,
  },
  {
    key: "usage_duration",
    label: "Durée des droits",
    group: "usage_duration",
    // « Droit » seul ne suffit pas (mission #084) : un droit d'entraînement IA
    // n'est pas un droit d'utilisation publicitaire.
    pattern: word("droits? (?:pub|publicitaires?|d'utilisation|de diffusion|d'image)|durée des droits|publicit|whitelisting|spark"),
    applies: hasUsageRights,
  },
  {
    key: "territory",
    label: "Territoire",
    group: "territory",
    // Le sujet doit être nommé : un « depuis la France » de politesse ne
    // renseigne pas le territoire de diffusion.
    pattern: word("territoires?|pays(?![\\p{L}])|zone|monde entier|international"),
    applies: hasUsageRights,
  },
  {
    key: "exclusivity",
    label: "Exclusivité",
    group: "exclusivity",
    pattern: word("exclusivit"),
    applies: (deal) => deal.exclusivity.present,
  },
  {
    key: "validation",
    label: "Validation",
    group: null,
    pattern: word("validation|valid(?:e|er|ez|ons|ée?s?)(?![\\p{L}])|approb|approuv|bon à tirer"),
    applies: () => true,
  },
];

export const POINT_LABEL: Record<PointKey, string> = Object.fromEntries(POINTS.map((point) => [point.key, point.label])) as Record<
  PointKey,
  string
>;

// La marque répond, mais dit qu'elle ne bougera pas : le point est refermé —
// on sait à quoi s'en tenir — et il est dit « refusé », pas « répondu ».
const REFUSAL =
  /(?:on|nous|je)\s+ne\s+(?:peut|peux|pouvons)\s+pas|n'est pas négociable|non négociable|pas négociable|impossible de|ne peut pas bouger|on ne bouge pas|c'est (?:le |mon |notre )?(?:maximum|max(?![\p{L}])|dernier mot)|c'est le maximum/iu;

// Découpe le texte collé en phrases, en gardant les extraits MOT POUR MOT :
// une citation de point est toujours un morceau du texte de la marque.
export function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s+|\n+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

// Points suivis pour ce deal. Un point hors sujet (exclusivité jamais demandée,
// territoire sans droits d'utilisation) n'est pas suivi du tout.
export function trackedPoints(deal: Deal): Point[] {
  return POINTS.filter((point) => point.applies(deal));
}

export function emptyPoints(deal: Deal): PointState[] {
  return trackedPoints(deal).map((point) => ({ key: point.key, status: "unknown" as const, quote: null, turn: null }));
}

// Points que CETTE phrase de la marque renseigne.
export function pointsOfSentence(sentence: string, deal: Deal): Point[] {
  return trackedPoints(deal).filter((point) => point.pattern.test(sentence));
}

// Mission #095 — l'état des points après ce tour. Deux sources, toutes deux
// vérifiées : les phrases du texte réellement collé, et les changements de
// termes dont la citation a déjà été confrontée à ce texte.
export function readPoints({
  previous,
  brandReply,
  changes,
  turn,
  deal,
}: {
  previous: readonly PointState[];
  brandReply: string;
  changes: readonly TermChange[];
  turn: number;
  deal: Deal;
}): PointState[] {
  const tracked = trackedPoints(deal);
  const state = new Map<PointKey, PointState>();
  for (const point of tracked) {
    const kept = previous.find((entry) => entry.key === point.key);
    state.set(point.key, kept ?? { key: point.key, status: "unknown", quote: null, turn: null });
  }

  const settle = (key: PointKey, status: PointStatus, quote: string) => {
    const current = state.get(key);
    if (!current) return;
    // Une réponse de CE tour remplace ce qu'on savait : la marque a le droit de
    // revenir sur un point. Un point refermé ne redevient jamais « inconnu ».
    state.set(key, { key, status, quote, turn });
  };

  for (const sentence of sentencesOf(brandReply)) {
    const refused = REFUSAL.test(sentence);
    for (const point of pointsOfSentence(sentence, deal)) {
      settle(point.key, refused ? "refused" : "answered", sentence);
    }
  }

  // Un terme changé, citation vérifiée : le point que porte ce groupe est
  // renseigné, même si la phrase ne nomme pas son sujet.
  for (const change of changes) {
    const point = tracked.find((candidate) => candidate.group === change.group);
    if (!point) continue;
    const already = state.get(point.key);
    if (already?.turn === turn && already.status === "refused") continue;
    settle(point.key, "answered", change.quote);
  }

  return tracked.map((point) => state.get(point.key) as PointState);
}

export function openPoints(points: readonly PointState[]): PointState[] {
  return points.filter((point) => point.status === "unknown");
}

export function closedPoints(points: readonly PointState[]): PointState[] {
  return points.filter((point) => point.status !== "unknown");
}

// Mission #095, défaut 3 — condition de fin, évaluée par le code : plus aucun
// point ouvert, et un montant sur la table. La négociation n'ouvre alors plus
// de question ; elle présente l'état final et laisse le choix à la personne.
export function everythingSettled(points: readonly PointState[], deal: Deal): boolean {
  if (points.length === 0) return false;
  if (openPoints(points).length > 0) return false;
  return deal.payment.amount_eur !== null || deal.in_kind_value_eur !== null;
}
