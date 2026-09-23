import { normalizeForQuote } from "@/lib/negotiation/quotes";
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
//
// Mission #098 — trois corrections :
//   - la mémoire part de l'OFFRE INITIALE : un terme déjà écrit dans l'offre
//     (« en pub pendant 6 mois ») n'est pas un point à obtenir ;
//   - « refusé » ne vaut que pour un point sur lequel la marque ne bouge pas
//     SANS rien donner. Annoncer un plafond, c'est répondre : le point est
//     « répondu », et le fait qu'elle n'en bougera plus est noté à part (firm) ;
//   - un point que personne n'a jamais demandé ne figure pas dans ce qui
//     reste à obtenir (asked).

export type Point = {
  key: PointKey;
  label: string;
  // Sujet du point dans une phrase de la marque.
  pattern: RegExp;
  // Ce qui, dans la phrase, constitue une VALEUR pour ce point. Une phrase qui
  // refuse de bouger mais qui donne la valeur répond au point.
  value: RegExp;
  // Groupe de termes qui porte ce point, quand il y en a un : un changement de
  // terme vérifié (citation confrontée au texte) renseigne aussi le point.
  group: TermGroup | null;
  // Ce point se pose-t-il pour CE deal ? Une exclusivité que personne ne
  // demande n'a pas à rester éternellement « inconnue ».
  applies: (deal: Deal) => boolean;
  // Le point est-il déjà réglé par l'offre elle-même ? Mission #098 : l'offre
  // initiale est une source, au même titre que les réponses de la marque.
  inOffer: (deal: Deal) => boolean;
};

const word = (body: string) => new RegExp(`(?<![\\p{L}])(?:${body})`, "iu");

const MONEY = /\d[\d\s  .,]*\s?(?:€|eur\b|euros?\b)/iu;
const MONTHS = /\d+\s*(?:mois|ans?(?![\p{L}])|semaines?)|illimit|perpétu|sans limite de durée/iu;

export const POINTS: readonly Point[] = [
  {
    key: "amount",
    label: "Rémunération",
    group: "amount",
    pattern: /(?<![\p{L}])(?:budget|rémunér|tarif|cachet|enveloppe|montant|prix|euros?(?![\p{L}]))|€/iu,
    value: MONEY,
    applies: () => true,
    inOffer: (deal) => deal.payment.amount_eur !== null || deal.in_kind_value_eur !== null,
  },
  {
    key: "formats",
    label: "Formats",
    group: "deliverables",
    pattern: word("formats?|tiktok|reels?(?![\\p{L}])|stor(?:y|ies)|vidéos?(?![\\p{L}])|posts?(?![\\p{L}])|carrousel|9:16|vertical"),
    value: word("tiktok|instagram|youtube|reels?(?![\\p{L}])|stor(?:y|ies)|vidéos?(?![\\p{L}])|posts?(?![\\p{L}])|9:16|vertical|carrousel"),
    applies: () => true,
    inOffer: (deal) => deal.deliverables.length > 0,
  },
  {
    key: "content_duration",
    label: "Durée des contenus",
    group: null,
    // Une durée de contenu s'écrit en secondes ou en minutes. Les mois (droits,
    // exclusivité) et les jours (paiement) ne sont pas des durées de contenu.
    pattern: /\d+\s*(?:à\s*\d+\s*)?(?:secondes?|sec(?![\p{L}])|minutes?|min(?![\p{L}]))/iu,
    value: /\d+\s*(?:à\s*\d+\s*)?(?:secondes?|sec(?![\p{L}])|minutes?|min(?![\p{L}]))/iu,
    applies: () => true,
    inOffer: (deal) => deal.deliverables.some((item) => item.format !== null),
  },
  {
    key: "revisions",
    label: "Révisions",
    group: null,
    pattern: word("révisions?|retouches?|allers?[- ]retours?|corrections?"),
    value: /\d+|illimit|autant que/iu,
    applies: () => true,
    inOffer: (deal) => deal.revisions.count !== null || deal.revisions.unlimited,
  },
  {
    key: "payment",
    label: "Délai et modalités de paiement",
    group: "payment_terms",
    pattern: word("paiement|règlement|acompte|factur|virement|pay(?:é|er|able|ons)(?![\\p{L}])"),
    value: /\d+\s*jours|virement|acompte|signature|réception|comptant|à ?réception/iu,
    applies: () => true,
    inOffer: (deal) => deal.payment.terms_days !== null || deal.payment.schedule !== null,
  },
  {
    key: "usage_duration",
    label: "Durée des droits",
    group: "usage_duration",
    // « Droit » seul ne suffit pas (mission #084) : un droit d'entraînement IA
    // n'est pas un droit d'utilisation publicitaire.
    pattern: word("droits? (?:pub|publicitaires?|d'utilisation|de diffusion|d'image)|durée des droits|publicit|whitelisting|spark"),
    value: MONTHS,
    applies: hasUsageRights,
    inOffer: (deal) => deal.usage.duration_months !== null || deal.usage.perpetual,
  },
  {
    key: "territory",
    label: "Territoire",
    group: "territory",
    // Le sujet doit être nommé : un « depuis la France » de politesse ne
    // renseigne pas le territoire de diffusion.
    pattern: word("territoires?|pays(?![\\p{L}])|zone|monde entier|international"),
    value: word("france|europe|monde|international|belgique|suisse|canada|allemagne|espagne|italie|royaume-uni|états-unis|usa(?![\\p{L}])|dom|union européenne|ue(?![\\p{L}])"),
    applies: hasUsageRights,
    inOffer: (deal) => deal.usage.territory !== null,
  },
  {
    key: "exclusivity",
    label: "Exclusivité",
    group: "exclusivity",
    pattern: word("exclusivit"),
    value: /\d+\s*(?:mois|ans?|semaines?)|aucune|sans exclusivité/iu,
    applies: (deal) => deal.exclusivity.present,
    inOffer: (deal) => deal.exclusivity.present && deal.exclusivity.duration_months !== null,
  },
  {
    key: "validation",
    label: "Validation",
    group: null,
    pattern: word("validation|valid(?:e|er|ez|ons|ée?s?)(?![\\p{L}])|approb|approuv|bon à tirer"),
    value: word("valid|approb|approuv|oui|moi|nous|\\d+ ?h(?![\\p{L}])|\\d+ ?jours?"),
    applies: () => true,
    inOffer: () => false,
  },
];

export const POINT_LABEL: Record<PointKey, string> = Object.fromEntries(POINTS.map((point) => [point.key, point.label])) as Record<
  PointKey,
  string
>;

// Mission #098 — la marque dit qu'elle ne bougera plus. Ce n'est un REFUS que
// si elle ne donne rien : « jusqu'à 900 €, je ne pourrai pas revenir dessus »
// répond sur la rémunération, et note seulement qu'elle n'ira pas plus loin.
const FIRM =
  /(?:on|nous|je)\s+ne\s+(?:peut|peux|pouvons|pourrai|pourrons)\s*(?:pas)?|n'est pas négociable|non négociable|pas négociable|impossible de|ne peut pas bouger|on ne bouge pas|revenir dessus|c'est (?:le |mon |notre )?(?:maximum|max(?![\p{L}])|dernier mot)|c'est le maximum/iu;

// Découpe le texte collé en phrases, en gardant les extraits MOT POUR MOT :
// une citation de point est toujours un morceau du texte de la marque.
export function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s+|\n+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

// Mission #098, défaut 2 — une citation commence à un début de phrase et finit
// à une fin de phrase. Trop longue, elle est coupée à une frontière de MOT,
// suivie d'une ellipse. Seules les bornes changent : ce qui est montré reste un
// extrait exact du texte collé.
export const CITATION_MAX = 160;

export function citation(raw: string, source: string, max: number = CITATION_MAX): string {
  const sentence = sentenceAround(raw, source) ?? raw.trim();
  if (sentence.length <= max) return sentence;
  const cut = sentence.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  const kept = (lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:]+$/u, "");
  return `${kept}…`;
}

// La phrase entière du texte source qui contient cet extrait. null : l'extrait
// n'y figure pas tel quel (le modèle l'a reformulé), on n'invente pas.
function sentenceAround(raw: string, source: string): string | null {
  const needle = normalizeForQuote(raw).replace(/^[\s"'«».,;:…-]+|[\s"'«».,;:…-]+$/gu, "");
  if (needle.length === 0) return null;
  for (const sentence of sentencesOf(source)) {
    if (normalizeForQuote(sentence).includes(needle)) return sentence;
  }
  return null;
}

// Points suivis pour ce deal. Un point hors sujet (exclusivité jamais demandée,
// territoire sans droits d'utilisation) n'est pas suivi du tout.
export function trackedPoints(deal: Deal): Point[] {
  return POINTS.filter((point) => point.applies(deal));
}

// Mission #098, défaut 3c — ce qui a réellement été demandé à la marque, lu
// dans les demandes de la créatrice. Un point que personne n'a posé ne figure
// pas dans « reste à obtenir ».
export function askedPoints(deal: Deal, askLabels: readonly string[]): Set<PointKey> {
  const asked = new Set<PointKey>();
  for (const label of askLabels) for (const point of pointsOfSentence(label, deal)) asked.add(point.key);
  return asked;
}

// Mission #098, défaut 3a — l'état de départ vient de l'OFFRE : un terme déjà
// écrit n'est pas à obtenir. turn 1 : l'analyse d'origine.
export function emptyPoints(deal: Deal, askLabels: readonly string[] = []): PointState[] {
  const asked = askedPoints(deal, askLabels);
  return trackedPoints(deal).map((point) => ({
    key: point.key,
    status: point.inOffer(deal) ? ("answered" as const) : ("unknown" as const),
    quote: null,
    turn: point.inOffer(deal) ? 1 : null,
    firm: false,
    asked: asked.has(point.key),
    previous: null,
  }));
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
  askLabels = [],
}: {
  previous: readonly PointState[];
  brandReply: string;
  changes: readonly TermChange[];
  turn: number;
  deal: Deal;
  askLabels?: readonly string[];
}): PointState[] {
  const tracked = trackedPoints(deal);
  const asked = askedPoints(deal, askLabels);
  const state = new Map<PointKey, PointState>();
  for (const point of tracked) {
    const kept = previous.find((entry) => entry.key === point.key);
    state.set(point.key, kept ?? { key: point.key, status: "unknown", quote: null, turn: null, firm: false, asked: false, previous: null });
  }

  const settle = (key: PointKey, status: PointStatus, quote: string, firm: boolean) => {
    const current = state.get(key);
    if (!current) return;
    const sameTurn = current.turn === turn;
    // Mission #098 — « je peux aller jusqu'à 900 €. C'est le maximum, je ne
    // pourrai pas revenir dessus. » : la seconde phrase ne doit pas effacer la
    // réponse de la première. Elle ne fait que la fermer à la discussion.
    if (sameTurn && current.status === "answered" && status === "refused") {
      state.set(key, { ...current, firm: true });
      return;
    }
    // Une réponse de CE tour remplace ce qu'on savait : la marque a le droit de
    // revenir sur un point. Un point refermé ne redevient jamais « inconnu ».
    const next = citation(quote, brandReply);
    // Mission #099 — elle revient sur un point réglé à un tour PRÉCÉDENT, et
    // dit autre chose : on garde ce qu'elle disait avant. Les deux citations
    // et les deux tours s'affichent ; rien n'est écrasé en silence.
    const changedMind =
      !sameTurn && current.status !== "unknown" && current.quote !== null && (current.status !== status || current.quote !== next);
    state.set(key, {
      key,
      status,
      quote: next,
      turn,
      firm: firm || (sameTurn && current.firm),
      asked: current.asked,
      previous: changedMind ? { status: current.status, quote: current.quote, turn: current.turn } : (sameTurn ? current.previous : null),
    });
  };

  for (const sentence of sentencesOf(brandReply)) {
    const firm = FIRM.test(sentence);
    for (const point of pointsOfSentence(sentence, deal)) {
      // Elle donne une valeur : le point est répondu, même si elle ajoute
      // qu'elle n'ira pas plus loin. Sans valeur, un refus reste un refus.
      const answered = point.value.test(sentence);
      settle(point.key, answered || !firm ? "answered" : "refused", sentence, firm);
    }
  }

  // Un terme changé, citation vérifiée : le point que porte ce groupe est
  // renseigné, même si la phrase ne nomme pas son sujet.
  for (const change of changes) {
    const point = tracked.find((candidate) => candidate.group === change.group);
    if (!point) continue;
    const already = state.get(point.key);
    if (already?.turn === turn && already.status === "refused") continue;
    settle(point.key, "answered", change.quote, already?.turn === turn ? already.firm : false);
  }

  return tracked.map((point) => {
    const entry = state.get(point.key) as PointState;
    return { ...entry, asked: entry.asked || asked.has(point.key) };
  });
}

// Mission #098, défaut 3c — ce qui reste à obtenir : les points QU'ON A
// DEMANDÉS et sur lesquels la marque n'a pas encore répondu. Un point jamais
// posé n'est pas un manque ; un point que l'OFFRE écrit mais qu'on a demandé de
// changer reste à obtenir tant qu'elle n'a rien dit.
export function openPoints(points: readonly PointState[]): PointState[] {
  return points.filter((point) => point.asked && point.status === "unknown");
}

export function closedPoints(points: readonly PointState[]): PointState[] {
  return points.filter((point) => point.status !== "unknown");
}

// Mission #098 — ce qu'un doute ne peut plus nier : ce que le bloc de mémoire
// AFFICHE comme réglé. Un terme écrit dans l'offre en fait partie — sauf la
// rémunération : le montant de l'offre ne dit rien de ce que la marque pense
// de la contre-offre, un doute sur le prix reste donc recevable.
export function settledForDoubts(points: readonly PointState[]): PointState[] {
  return points.filter((point) => point.status !== "unknown" && (point.quote !== null || point.key !== "amount"));
}

// Mission #098 — les points que la MARQUE a refermés, citation à l'appui.
// Ce sont ceux-là, et eux seuls, que l'écran affiche comme « répondu au tour
// N : … » : un doute ou une question qui les vise contredit ce qui est montré.
// Un point que l'OFFRE renseigne n'a pas de citation de la marque : il n'est
// pas à obtenir, mais l'outil peut encore douter de ce qu'elle en dit.
export function brandSettled(points: readonly PointState[]): PointState[] {
  return points.filter((point) => point.status !== "unknown" && point.quote !== null);
}

// Mission #095, défaut 3 — condition de fin, évaluée par le code : plus aucun
// point ouvert, et un montant sur la table. La négociation n'ouvre alors plus
// de question ; elle présente l'état final et laisse le choix à la personne.
export function everythingSettled(
  points: readonly PointState[],
  deal: Deal,
  // Les demandes de la créatrice, telles qu'elles sont après ce tour.
  asks: ReadonlyArray<{ status: string; label: string }> = [],
): boolean {
  if (points.length === 0) return false;
  if (openPoints(points).length > 0) return false;
  const answered = new Set(settledForDoubts(points).map((point) => point.key));
  // Une demande sans réponse dont le sujet n'est réglé nulle part : on n'est
  // pas au bout. Un sujet déjà réglé — par la marque, ou par l'offre elle-même
  // — ne bloque pas. Une demande qui ne porte sur aucun des points suivis
  // (« raw footage en option payante ») bloque tant qu'elle est sans réponse :
  // rien d'autre ne la surveille.
  const pending = asks.some((ask) => {
    if (ask.status !== "unanswered") return false;
    const subjects = pointsOfSentence(ask.label, deal);
    return subjects.length === 0 || !subjects.every((point) => answered.has(point.key));
  });
  if (pending) return false;
  return deal.payment.amount_eur !== null || deal.in_kind_value_eur !== null;
}
