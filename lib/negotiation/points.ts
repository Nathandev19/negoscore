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
  // Mission #101, défaut 1 — la valeur de ce point dans une phrase, ramenée à
  // l'unité du deal. Absent : point QUALITATIF (formats, territoire,
  // validation, durée des contenus) — deux formulations différentes y restent
  // deux positions différentes, et l'écran le dit.
  normalized?: (sentence: string) => string | null;
  // Mission #100, point 2 — le sujet du point tel qu'une OFFRE l'écrit, quand
  // il ne s'écrit pas comme dans une réponse de marque. Sert uniquement à
  // retrouver la phrase à citer dans le texte d'origine ; la valeur reste
  // exigée, et `pattern` seul décide de ce qu'une réponse renseigne.
  offerSubject?: RegExp;
};

const word = (body: string) => new RegExp(`(?<![\\p{L}])(?:${body})`, "iu");

// Mission #101, défaut 1 — la valeur NORMALISÉE que porte une phrase, pour les
// points qui en ont une. Même unité que le deal enregistré : des jours pour le
// paiement, des mois pour les droits et l'exclusivité, des euros pour la
// rémunération, un nombre pour les révisions. Deux phrases qui donnent la même
// valeur disent la même chose, même écrites autrement. null : la phrase ne
// porte pas de valeur lisible — on ne conclut rien.

const NUMBER = String.raw`\d[\d\s\u00a0\u202f.]*`;

function toNumber(raw: string): number | null {
  const plain = raw.replace(/[\s\u00a0\u202f.]/gu, "").replace(",", ".");
  const value = Number(plain);
  return Number.isFinite(value) ? value : null;
}

// Durée ramenée en mois : « 1 an » et « 12 mois » sont la même durée.
function months(sentence: string): string | null {
  if (/illimit|perpétu|sans limite de durée|à vie/iu.test(sentence)) return "illimite";
  const match = new RegExp(`(${NUMBER})\\s*(mois|ans?(?![\\p{L}])|semaines?)`, "iu").exec(sentence);
  if (!match) return null;
  const value = toNumber(match[1]);
  if (value === null) return null;
  const unit = match[2].toLowerCase();
  if (unit.startsWith("an")) return `${value * 12}m`;
  if (unit.startsWith("semaine")) return `${value}sem`;
  return `${value}m`;
}

function days(sentence: string): string | null {
  const match = new RegExp(`(${NUMBER})\\s*jours?(?![\\p{L}])`, "iu").exec(sentence);
  const value = match ? toNumber(match[1]) : null;
  return value === null ? null : `${value}j`;
}

function euros(sentence: string): string | null {
  const match = new RegExp(`(${NUMBER})\\s?(?:€|eur\\b|euros?\\b)`, "iu").exec(sentence);
  const value = match ? toNumber(match[1]) : null;
  return value === null ? null : `${value}€`;
}

function count(sentence: string): string | null {
  if (/illimit|autant que/iu.test(sentence)) return "illimite";
  const match = new RegExp(`(${NUMBER})`, "u").exec(sentence);
  const value = match ? toNumber(match[1]) : null;
  return value === null ? null : String(value);
}


const MONEY = /\d[\d\s  .,]*\s?(?:€|eur\b|euros?\b)/iu;
const MONTHS = /\d+\s*(?:mois|ans?(?![\p{L}])|semaines?)|illimit|perpétu|sans limite de durée/iu;

export const POINTS: readonly Point[] = [
  {
    key: "amount",
    label: "Rémunération",
    group: "amount",
    pattern: /(?<![\p{L}])(?:budget|rémunér|tarif|cachet|enveloppe|montant|prix|euros?(?![\p{L}]))|€/iu,
    value: MONEY,
    normalized: euros,
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
    normalized: count,
    applies: () => true,
    inOffer: (deal) => deal.revisions.count !== null || deal.revisions.unlimited,
  },
  {
    key: "payment",
    label: "Délai et modalités de paiement",
    group: "payment_terms",
    pattern: word("paiement|règlement|acompte|factur|virement|pay(?:é|er|able|ons)(?![\\p{L}])"),
    value: /\d+\s*jours|virement|acompte|signature|réception|comptant|à ?réception/iu,
    normalized: days,
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
    // Une offre dit rarement « droits pub » : « les droits pour les réutiliser
    // sur nos réseaux et en pub pendant 6 mois ». La durée reste exigée, c'est
    // elle qui fait de la phrase une réponse sur ce point.
    offerSubject: word("droits?|licence|réutilis|diffus|publicit|whitelisting|spark"),
    normalized: months,
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
    normalized: months,
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
export function sentenceAround(raw: string, source: string): string | null {
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

// Mission #100, point 2 — la phrase de l'OFFRE qui renseigne ce point, prise
// dans le texte d'origine. Même exigence que pour les réponses de la marque :
// un extrait qui existe caractère pour caractère, ramené aux frontières de sa
// phrase. null : pas de texte d'origine (fichier déposé, texte effacé au bout
// de 30 jours), ou aucune phrase ne dit ce point — on n'invente pas.
export function offerCitation(point: Point, offerText: string | null | undefined): string | null {
  if (!offerText) return null;
  const subject = point.offerSubject ?? point.pattern;
  const sentence = sentencesOf(offerText).find((entry) => subject.test(entry) && point.value.test(entry));
  return sentence ? citation(sentence, offerText) : null;
}

// Mission #098, défaut 3a — l'état de départ vient de l'OFFRE : un terme déjà
// écrit n'est pas à obtenir. turn 1 : l'analyse d'origine.
export function emptyPoints(deal: Deal, askLabels: readonly string[] = [], offerText: string | null = null): PointState[] {
  const asked = askedPoints(deal, askLabels);
  return trackedPoints(deal).map((point) => ({
    key: point.key,
    status: point.inOffer(deal) ? ("answered" as const) : ("unknown" as const),
    // Mission #100 : la phrase de l'offre, comme les autres points ont celle
    // de la marque. Un point « répondu » sans citation ne se vérifiait pas.
    quote: point.inOffer(deal) ? offerCitation(point, offerText) : null,
    turn: point.inOffer(deal) ? 1 : null,
    firm: false,
    asked: asked.has(point.key),
    previous: null,
    reserves: [],
  }));
}

// Deux phrases disent-elles la MÊME valeur pour ce point ? Sur un point à
// valeur normalisée, la comparaison porte sur cette valeur : « paiement à 30
// jours » et « en une fois, à 30 jours après réception » disent 30 jours, la
// marque n'a pas changé de position, elle a reformulé. Sur un point qualitatif,
// jamais : une formulation différente peut cacher un vrai changement, et c'est
// à la créatrice de le voir. false aussi dès qu'une des deux phrases ne porte
// aucune valeur lisible.
function sameValue(key: PointKey, before: string | null, after: string): boolean {
  const point = POINTS.find((entry) => entry.key === key);
  if (!point?.normalized || before === null) return false;
  const first = point.normalized(before);
  const second = point.normalized(after);
  return first !== null && second !== null && first === second;
}

// Points que CETTE phrase de la marque renseigne.
export function pointsOfSentence(sentence: string, deal: Deal): Point[] {
  return trackedPoints(deal).filter((point) => point.pattern.test(sentence));
}


// Mission #101, défaut 2 — « Paiement en une fois, à 30 jours après réception
// et validation des contenus » refermait le point VALIDATION, parce que le mot
// y figure. La phrase ne dit rien de la procédure de validation : elle dit
// quand la marque paie. Le point passait en « répondu », l'agent ne le
// redemandait plus (#095), et la négociation pouvait se conclure sur une clause
// jamais discutée.
//
// Désormais, une phrase ne referme un point que si elle en DIT quelque chose —
// son sujet ET une valeur, ou un refus assumé — et, quand plusieurs points
// pourraient la réclamer, c'est l'attribution STRUCTURÉE du modèle qui tranche :
// le groupe de termes qu'il a cité, ou la demande à laquelle il a répondu, tous
// deux déjà vérifiés mot pour mot contre le texte collé. Sans elle, les
// mots-clés ne tranchent que s'ils ne désignent qu'un seul point — c'est le
// repli, et il est journalisé. Dans le doute, le point reste OUVERT : un point
// ouvert de trop coûte une question, un point refermé à tort coûte une clause.

// Ce que le modèle a attribué, et que le code a déjà vérifié : un groupe de
// termes cité (TermChange), ou une demande de la créatrice à laquelle cette
// phrase répond (Ask). Le libellé de la demande vient d'elle, pas de la marque.
export type Attribution = { quote: string; group?: TermGroup | null; ask?: string | null };

// La phrase dit-elle quelque chose de ce point ? Son sujet doit y être nommé,
// et elle doit porter une valeur — ou fermer la porte (« on ne peut pas bouger
// dessus »), ce qui est aussi une réponse. Le passage qui fait valeur est
// rendu : c'est lui qui départage deux points dont le mot apparaît.
const NO_VALUE = "sans-valeur";

function treats(point: Point, sentence: string, firm: boolean): string | null {
  if (!point.pattern.test(sentence)) return null;
  const value = point.value.exec(sentence);
  if (value) return `${value.index}:${value[0].length}`;
  return firm ? NO_VALUE : null;
}

// Le point que désigne une attribution. null : le modèle a visé un groupe qui
// ne porte aucun point suivi, ou un libellé de demande qui en désigne
// plusieurs — on ne devine pas à sa place.
function pointOfAttribution(attribution: Attribution, tracked: readonly Point[], deal: Deal): Point | null {
  if (attribution.group) return tracked.find((point) => point.group === attribution.group) ?? null;
  if (!attribution.ask) return null;
  const named = pointsOfSentence(attribution.ask, deal);
  return named.length === 1 ? named[0] : null;
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
  attributed = [],
}: {
  previous: readonly PointState[];
  brandReply: string;
  changes: readonly TermChange[];
  turn: number;
  deal: Deal;
  askLabels?: readonly string[];
  // Mission #101 — ce que le modèle a attribué et que le code a vérifié.
  attributed?: readonly Attribution[];
}): PointState[] {
  const tracked = trackedPoints(deal);
  const asked = askedPoints(deal, askLabels);
  const state = new Map<PointKey, PointState>();
  for (const point of tracked) {
    const kept = previous.find((entry) => entry.key === point.key);
    state.set(point.key, kept ?? { key: point.key, status: "unknown", quote: null, turn: null, firm: false, asked: false, previous: null, reserves: [] });
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
    // Mission #100, point 2, étendu par #101 — deux citations différentes ne
    // suffisent pas à annoncer un changement de position : la marque qui
    // confirme « les 6 mois de droits pub », ou qui redit ses 30 jours
    // autrement, ne change rien. Sur les points à valeur normalisée, c'est la
    // VALEUR qui décide, à tous les tours ; sur les autres, rien ne change.
    const saysTheSame = current.status === status && sameValue(key, current.quote, next);
    const changedMind =
      !sameTurn &&
      current.status !== "unknown" &&
      current.quote !== null &&
      (current.status !== status || current.quote !== next) &&
      !saysTheSame;
    state.set(key, {
      key,
      status,
      quote: next,
      turn,
      firm: firm || (sameTurn && current.firm),
      asked: current.asked,
      previous: changedMind ? { status: current.status, quote: current.quote, turn: current.turn } : (sameTurn ? current.previous : null),
      // Les réserves d'un tour précédent portaient sur ce qu'elle vient de
      // préciser : elles repartent de zéro, et ce tour dira les siennes.
      reserves: sameTurn ? current.reserves : [],
    });
  };

  // Ce que le modèle a attribué à un point, phrase par phrase. La citation a
  // déjà été confrontée au texte collé par l'appelant : on retrouve ici la
  // phrase entière qui la porte, et on ne retient l'attribution que si cette
  // phrase dit vraiment quelque chose du point visé.
  const decided = new Map<string, Set<PointKey>>();
  for (const attribution of attributed) {
    const sentence = sentenceAround(attribution.quote, brandReply);
    if (sentence === null) continue;
    const point = pointOfAttribution(attribution, tracked, deal);
    if (!point || treats(point, sentence, FIRM.test(sentence)) === null) continue;
    const already = decided.get(sentence) ?? new Set<PointKey>();
    already.add(point.key);
    decided.set(sentence, already);
  }

  for (const sentence of sentencesOf(brandReply)) {
    const firm = FIRM.test(sentence);
    const candidates = tracked
      .map((point) => ({ point, value: treats(point, sentence, firm) }))
      .filter((entry): entry is { point: Point; value: string } => entry.value !== null);
    if (candidates.length === 0) continue;
    const chosen = decided.get(sentence);
    // Elle donne une valeur : le point est répondu, même si elle ajoute qu'elle
    // n'ira pas plus loin. Sans valeur, un refus reste un refus.
    const close = (point: Point) => settle(point.key, point.value.test(sentence) || !firm ? "answered" : "refused", sentence, firm);
    for (const { point, value } of candidates) {
      // Le modèle a visé ce point : il est refermé, sur sa phrase.
      if (chosen?.has(point.key)) {
        close(point);
        continue;
      }
      // Repli par mots-clés. Deux points qui se disputent le MÊME passage :
      // aucun des deux n'est refermé — « 30 jours », dans « paiement à 30 jours
      // après réception et validation », parle du paiement, pas de la
      // validation. Cela vaut aussi quand le modèle a donné ce passage à l'un
      // d'eux : l'autre reste à négocier. Chacun le sien : chacun est refermé.
      if (candidates.some((other) => other.point.key !== point.key && other.value === value)) continue;
      close(point);
      console.warn(JSON.stringify({ event: "point_referme_par_repli", point: point.key, tour: turn }));
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
// Mission #100, point 1 — répartir les doutes du modèle : ceux qui portent
// sur un point DÉJÀ renseigné sont des réserves (« répondu, mais sans
// détailler ») et rejoignent ce point ; les autres restent des incertitudes de
// lecture. Le bloc des doutes ne garde que ce que l'outil n'a pas su lire.
export function splitReserves(
  doubts: readonly string[],
  points: readonly PointState[],
  deal: Deal,
): { doubts: string[]; points: PointState[] } {
  const settled = new Set(settledForDoubts(points).map((point) => point.key));
  const reserves = new Map<PointKey, string[]>();
  const kept: string[] = [];
  for (const doubt of doubts) {
    const mentioned = pointsOfSentence(doubt, deal).map((point) => point.key);
    // Une réserve ne vaut que si TOUT ce dont elle parle est déjà renseigné :
    // sinon elle porte encore sur une lecture manquante, et elle reste un doute.
    if (mentioned.length === 0 || !mentioned.every((point) => settled.has(point))) {
      kept.push(doubt);
      continue;
    }
    for (const point of mentioned) reserves.set(point, [...(reserves.get(point) ?? []), doubt]);
  }
  return {
    doubts: kept,
    points: points.map((point) =>
      reserves.has(point.key) ? { ...point, reserves: [...point.reserves, ...(reserves.get(point.key) ?? [])] } : point,
    ),
  };
}

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
