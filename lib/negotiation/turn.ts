import { formatEur } from "@/lib/money";
import { TONES, toneLabel } from "@/lib/tone";
import type { ResultView } from "@/lib/analysis/lock";
import { normalizeDeal } from "@/lib/analysis/normalize";
import { mergeAsks, openAsks, originalAsks, outcomeFromAsks, PRICE_ASK_ID, REMAINING_FALLBACK } from "@/lib/negotiation/asks";
import { buildClosing, offeredAmount } from "@/lib/negotiation/closing";
import { buildConclusion } from "@/lib/negotiation/conclusion";
import { readAmounts, statedCeiling, turnSituation } from "@/lib/negotiation/gap";
import { fallbackMessage, finalMessage, stripRedundantQuestions } from "@/lib/negotiation/message";
import type { Attribution } from "@/lib/negotiation/points";
import { brandSettled, emptyPoints, everythingSettled, pointsOfSentence, readPoints, settledForDoubts, splitReserves } from "@/lib/negotiation/points";
import { tableOf } from "@/lib/analysis/recompute";
import { originPricing, priceFor, unavailablePricing, withCeiling } from "@/lib/negotiation/pricing";
import { checkQuote, quoteIsIn } from "@/lib/negotiation/quotes";
import { applyGroups, groupLabel } from "@/lib/negotiation/terms";
import { groupsOf } from "@/lib/negotiation/topics";
import { changeFollowsAsk, changeRestrictsAsk, keepWritten, unwrittenDoubt } from "@/lib/negotiation/written";
import {
  TERM_GROUP_LABEL,
  TURN_SCHEMA_VERSION,
  type Ask,
  type Deal,
  type PointState,
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
  // Mission #100, point 2 — le texte de l'offre d'origine, pour citer la
  // phrase qui renseigne un point dès le tour 1. Il ne quitte pas le serveur
  // autrement : seul l'extrait retenu est enregistré avec le tour. null :
  // fichier déposé, ou texte effacé au bout de 30 jours.
  offerText?: string | null;
};

export type TurnResult =
  | { kind: "off_topic"; relevance: "other_offer" | "unrelated" | "unsure"; note: string }
  | { kind: "turn"; payload: TurnPayload };

// Mission #080 quater, A6 — un doute du modèle qui parle de sa propre
// mécanique (« le champ deal ne permet pas… ») ne s'affiche pas : il est
// remplacé par une phrase qui dit à la créatrice ce qu'elle peut faire.
// Mission #083, E1 — « l'état du deal » : le nom interne de la lecture.
const JARGON = /(?<![\p{L}])(champs?|sch[ée]mas?|json|null|bool[ée]en|boolean|enum|payload|field|variable|deal ne permet|[ée]tat du deal)(?![\p{L}])/iu;

// Mission #083, B — « notre budget est de 300 € et il n'est pas négociable »,
// « on ne peut pas aller au-delà de ce qui était prévu » : s'en tenir à son
// montant, c'est refuser la contre-offre, pas en proposer une autre.
const NEGATION = /(?<![\p{L}])(?:n'|(?:ne|pas|jamais|aucune?|impossible|non)(?![\p{L}]))/iu;

// Mission #080 quinquies, B — les doutes s'adressent à elle, en « tu ». Le
// vouvoiement est converti là où c'est sûr (« votre proposition » → « ta
// proposition », « vers vous » → « vers toi ») ; ce qui est cité entre « »
// (les mots de la marque) n'est jamais touché. Un « vous » qui reste : le doute
// est remplacé par la phrase générique, plutôt que de mal s'adresser à elle.
const FEMININE = "proposition|demande|contre-offre|réponse|rémunération|vidéo|collaboration|disponibilité";
const VOWEL_FEMININE = "offre|exclusivité|audience|option";
const MASCULINE = "message|tarif|devis|compte|profil|travail|contenu|prix|budget|retour|accord|dernier message";
const TO_TU: Array<[RegExp, string]> = [
  [new RegExp(`\\b[Vv]otre (${FEMININE})(?![\\p{L}])`, "gu"), "ta $1"],
  // « ton » devant un nom masculin, ou féminin commençant par une voyelle
  // (« ton offre », « ton exclusivité »).
  [new RegExp(`\\b[Vv]otre (${MASCULINE}|${VOWEL_FEMININE})(?![\\p{L}])`, "gu"), "ton $1"],
  [/\b[Vv]os\b/g, "tes"],
  [/\b(vers|à|pour|avec|chez|de) vous\b/g, "$1 toi"],
];
const VOUS = /\b(vous|votre|vos)\b/i;

function addressedToYou(doubt: string): string | null {
  // Segments cités (« … ») laissés tels quels ; seul le texte autour change.
  const parts = doubt.split(/(«[^»]*»)/);
  const converted = parts
    .map((part) => (part.startsWith("«") ? part : TO_TU.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), part)))
    .join("");
  const outsideQuotes = converted.replace(/«[^»]*»/g, "");
  return VOUS.test(outsideQuotes) ? null : converted;
}

const GENERIC_DOUBT = "Un point de la réponse n'a pas pu être lu avec certitude : relis-la avant d'envoyer ton message.";

export function cleanDoubts(doubts: readonly string[]): string[] {
  const kept: string[] = [];
  let replaced = false;
  for (const raw of doubts) {
    const doubt = raw.trim();
    if (doubt.length === 0) continue;
    const addressed = JARGON.test(doubt) ? null : addressedToYou(doubt);
    if (addressed === null) replaced = true;
    else kept.push(addressed);
  }
  if (replaced) kept.push(GENERIC_DOUBT);
  return [...new Set(kept)];
}

// Mission #098, défaut 1 — le bloc de doute ne peut pas contredire la mémoire.
// Un doute qui porte sur un point dont le statut mémorisé est « répondu » ou
// « refusé » — avec la phrase de la marque à l'appui, affichée deux blocs plus
// bas — n'est pas un doute : c'est une contradiction. Il ne s'affiche pas.
function settledElsewhere(doubt: string, points: readonly PointState[], deal: Deal): boolean {
  const mentioned = pointsOfSentence(doubt, deal).map((point) => point.key);
  if (mentioned.length === 0) return false;
  const closed = new Set(settledForDoubts(points).map((point) => point.key));
  // Plusieurs sujets dans un même doute : il ne tombe que s'ils sont TOUS
  // réglés, sinon ce qui reste à dire disparaîtrait avec lui.
  return mentioned.every((key) => closed.has(key));
}

// État à l'entrée d'un tour : le deal et les demandes après le tour précédent,
// ou ceux de l'analyse d'origine.
export function stateBefore(original: ResultView, previous: readonly TurnPayload[], offerText: string | null = null): {
  deal: Deal;
  asks: Ask[];
  changedSinceOrigin: boolean;
  // Mission #095 — la mémoire des points, reprise du tour précédent.
  points: PointState[];
} {
  const last = previous.at(-1);
  if (!last) {
    const deal = normalizeDeal(original.deal);
    const asks = originalAsks(original);
    // Mission #098 — l'offre initiale renseigne déjà des points : ils ne sont
    // pas « à obtenir ».
    return { deal, asks, changedSinceOrigin: false, points: emptyPoints(deal, asks.map((ask) => ask.label), offerText) };
  }
  // Tour enregistré avant cette mission : aucun point mémorisé, on repart de
  // l'état vide plutôt que d'inventer ce que la marque aurait répondu.
  const points = last.points.length > 0 ? last.points : emptyPoints(last.deal_after, last.asks.map((ask) => ask.label), offerText);
  return { deal: last.deal_after, asks: last.asks, changedSinceOrigin: last.changed_since_origin, points };
}

export function processTurn(context: TurnContext, reading: TurnReading): TurnResult {
  const { original, previous, turnNumber, tier, brandReply, offerText = null } = context;

  // B3 — pas une réponse à cette offre : on le dit, rien n'est inventé.
  if (reading.relevance !== "reply") {
    return { kind: "off_topic", relevance: reading.relevance, note: reading.relevance_note };
  }

  const before = stateBefore(original, previous, offerText);

  // Demandes d'abord : celles que la marque accorde dans CE tour sont une
  // source écrite des nouveaux termes (accepter « exclusivité ramenée à 1
  // mois », c'est écrire 1 mois).
  const merged = mergeAsks(before.asks, reading, brandReply, turnNumber);
  const grantedNow = merged.asks.filter((ask) => ask.turn === turnNumber && ask.status === "granted").map((ask) => ask.label);

  // Termes : un groupe n'est repris que s'il est cité mot pour mot, puis
  // chaque valeur changée doit être ÉCRITE (lib/negotiation/written.ts). Sans
  // quoi elle revient à ce qu'elle était et le doute est dit.
  const verified: TermGroup[] = [];
  const ignored: Array<{ group: TermGroup; quote: string }> = [];
  // Changements refusés parce que la citation était coupée de sa négation ou
  // de sa condition (mission #081) : la phrase entière est montrée.
  const cut: Array<{ group: TermGroup; clause: string }> = [];
  const quotes: Partial<Record<TermGroup, string>> = {};
  for (const change of reading.changes) {
    if (verified.includes(change.group)) continue;
    const check = checkQuote(change.quote, brandReply);
    if (check.ok) {
      verified.push(change.group);
      quotes[change.group] = change.quote;
    } else {
      ignored.push({ group: change.group, quote: change.quote });
      if (check.reason === "cut") cut.push({ group: change.group, clause: check.clause });
    }
  }
  const kept = keepWritten(before.deal, applyGroups(before.deal, reading.deal, verified), verified, { brandReply, accepted: grantedNow }, quotes);
  const candidate = normalizeDeal(kept.deal);
  const changes: TermChange[] = [];
  for (const group of verified) {
    const was = groupLabel(before.deal, group);
    const now = groupLabel(candidate, group);
    if (was === now) continue;
    changes.push({ group, before: was, after: now, quote: quotes[group] ?? "" });
  }
  // Seuls les groupes qui changent vraiment sont appliqués : les autres
  // restent identiques octet pour octet.
  const dealAfter = changes.length > 0 ? applyGroups(before.deal, candidate, changes.map((c) => c.group)) : before.deal;
  const changedSinceOrigin = before.changedSinceOrigin || changes.length > 0;

  // Chiffrage : rien n'a jamais changé → l'analyse d'origine ; sinon le moteur.
  // Mission #085 — toujours avec la table de l'analyse d'origine. Disparue du
  // code et termes changés : aucun chiffre, le message n'en cite aucun.
  const table = tableOf(original);
  const version = original.estimate.rate_table_version;
  const pricingBefore = before.changedSinceOrigin
    ? table
      ? priceFor(before.deal, tier, table)
      : unavailablePricing(version, tier)
    : originPricing(original, tier);
  const pricingAfter = changes.length > 0 && table ? priceFor(dealAfter, tier, table) : null;
  const pricingUnavailable = !table && changedSinceOrigin;
  const current = pricingAfter ?? pricingBefore;

  // Mission #080 quinquies, C — demande restée sans réponse explicite alors
  // qu'un terme a changé, preuve à l'appui, exactement dans son sens : l'écran
  // le dit tel quel, sans affirmer que la marque a accepté (et sans la
  // contradiction « sans réponse » à côté d'un terme qui a bougé).
  const asks = merged.asks.map((ask) => {
    // Mission #083, B — le prix lu « contre-proposé » sur une phrase qui nie,
    // sans aucun nouveau montant retenu : la marque s'en tient au sien, c'est
    // un refus. Avec un nouveau montant écrit, c'est bien une contre-proposition.
    if (
      ask.id === PRICE_ASK_ID &&
      ask.turn === turnNumber &&
      ask.status === "countered" &&
      ask.quote !== null &&
      NEGATION.test(ask.quote) &&
      !changes.some((change) => change.group === "amount")
    ) {
      return { ...ask, status: "refused" as const };
    }
    // Mission #082, C — une demande de limiter lue comme « contre-proposée »
    // alors qu'un changement prouvé resserre justement ce terme : accordée en
    // partie, pas une contre-proposition.
    if (ask.turn === turnNumber && ask.status === "countered" && changes.some((change) => changeRestrictsAsk(change.group, before.deal, dealAfter, ask.label))) {
      return { ...ask, status: "partial" as const, remaining: REMAINING_FALLBACK };
    }
    // Ce qui reste à préciser, écrit par le modèle : mêmes règles que les
    // doutes (« tu », aucun jargon), sinon une formule neutre.
    if (ask.turn === turnNumber && ask.status === "partial" && ask.remaining) {
      const [cleaned] = cleanDoubts([ask.remaining]);
      const text = cleaned && cleaned !== GENERIC_DOUBT ? cleaned.replace(/[.\s]+$/, "") : "";
      return { ...ask, remaining: text || REMAINING_FALLBACK };
    }
    if (ask.status !== "unanswered" || ask.aligned_group) return ask;
    const follows = changes.find((change) => changeFollowsAsk(change.group, dealAfter, ask.label));
    // Aligné : le terme a changé, preuve à l'appui, dans son sens. C'est ce que
    // l'écran dit alors, plutôt que « non vérifiable ».
    return follows ? { ...ask, aligned_group: follows.group, aligned_turn: turnNumber, unverified_turn: null } : ask;
  });
  const alignedNow = new Set(asks.filter((ask) => ask.aligned_turn === turnNumber).map((ask) => ask.label));
  const cutGroups = new Set(cut.map((item) => item.group));
  // Mission #083, A3 — un seul doute par point : la demande non vérifiable a
  // le sien ; le changement de terme écarté sur le même sujet n'en ajoute pas.
  const unverifiedNow = merged.unverified.filter((item) => !alignedNow.has(item.label));
  const coveredGroups = new Set(unverifiedNow.flatMap((item) => [...groupsOf(item.label)]));

  // Doutes affichés à la créatrice, en « tu » (A6). Ceux du modèle qui parlent
  // de sa propre mécanique (champ, schéma, JSON…) n'atteignent jamais l'écran.
  // ─── Mission #095 ──────────────────────────────────────────────────────────
  // 1. La mémoire : chaque point renseigné par la marque garde sa citation,
  //    tour après tour. C'est elle qui empêche de le redemander.
  // Mission #101, défaut 2 — ce que le MODÈLE a attribué, et que le code a
  // déjà vérifié mot pour mot contre le texte collé : les groupes de termes
  // qu'il a cités (verified, y compris ceux dont la valeur n'a pas bougé), et
  // les demandes de la créatrice auxquelles il a rattaché une phrase. C'est
  // cela qui tranche quand une phrase pourrait refermer plusieurs points ; les
  // mots-clés ne sont plus que le repli.
  const attributed: Attribution[] = [
    ...verified.map((group) => ({ quote: quotes[group] ?? "", group })),
    // Un accord GLOBAL ne détaille aucun point : il ne referme rien.
    ...merged.asks
      .filter((ask) => ask.turn === turnNumber && ask.quote !== null && ask.unverified_turn === null && !ask.global)
      .map((ask) => ({ quote: ask.quote ?? "", ask: ask.label })),
  ].filter((attribution) => attribution.quote !== "");

  const points = readPoints({
    previous: before.points,
    brandReply,
    changes,
    turn: turnNumber,
    deal: dealAfter,
    askLabels: merged.asks.map((ask) => ask.label),
    attributed,
  });
  // Ce qu'on savait DÉJÀ en entrant dans ce tour : c'est cela qu'une question
  // ne peut plus redemander. Un point que la marque vient de renseigner dans
  // CETTE réponse ne rend pas redondante une question du même message : elle
  // peut porter sur ce qu'elle n'a pas couvert (« et la durée des stories ? »).
  const closed = brandSettled(before.points);

  // Mission #096 — le plafond annoncé par la marque court d'un tour à l'autre,
  // et c'est le plus RÉCENT qui fait foi, jamais le plus élevé. Un montant
  // ferme écrit dans CE tour le périme : la marque vient de dire autre chose.
  const announced = statedCeiling(brandReply);
  const ceiling = announced ?? (changes.some((change) => change.group === "amount") ? null : (previous.at(-1)?.stated_ceiling ?? null));


  // Mission #100, point 1 — les doutes du modèle sont triés AVANT d'être
  // mêlés à ceux du code : « la procédure de validation n'est pas détaillée »
  // sur un point déjà renseigné est une réserve, pas une incertitude de
  // lecture. Elle s'affiche sous ce point (lib/negotiation/points.ts).
  const sorted = splitReserves(cleanDoubts(reading.uncertainties), points, dealAfter);
  const withReserves = sorted.points;

  const uncertainties = [
    ...sorted.doubts,
    ...unverifiedNow
      // Mission #098, défaut 1 — « aucun passage trouvé » sur un point que la
      // mémoire affiche deux blocs plus bas comme répondu par la marque,
      // citation à l'appui : c'est une contradiction, pas un doute. Les doutes
      // qui CITENT la marque, eux, restent : ils disent ce qui n'a pas été
      // retenu, et ne nient rien.
      .filter((item) => item.clause !== null || !settledElsewhere(item.label, points, dealAfter))
      .map((item) =>
        item.clause
          ? `Sur « ${item.label} », la marque écrit « ${item.clause} ». L'outil avait coupé cette phrase avant ce qui la nie ou la conditionne : rien n'est retenu, relis sa réponse.`
          : `Sur « ${item.label} », l'outil n'a trouvé aucun passage de la réponse qui le dise clairement.`,
      ),
    ...cut
      .filter((item) => !coveredGroups.has(item.group))
      .map(
        (item) =>
          `« ${TERM_GROUP_LABEL[item.group]} » : la marque écrit « ${item.clause} ». L'outil avait coupé cette phrase avant ce qui la nie ou la conditionne : le terme n'a pas été modifié.`,
      ),
    ...ignored
      .filter((change) => !cutGroups.has(change.group) && !coveredGroups.has(change.group))
      .filter((change) => !settledElsewhere(TERM_GROUP_LABEL[change.group], points, dealAfter))
      .map(
        (change) =>
          `« ${TERM_GROUP_LABEL[change.group]} » : l'outil a cru lire un changement, mais aucun passage de la réponse ne le dit. Ce n'est pas retenu.`,
      ),
    ...kept.unwritten.filter((item) => !coveredGroups.has(item.group)).map(unwrittenDoubt),
  ];
  // Questions de la marque : seulement celles qu'elle a vraiment posées.
  const questions = reading.brand_questions.filter((q) => quoteIsIn(q.quote, brandReply));

  const counter = pricingUnavailable ? { low: null, high: null } : { low: current.counter_low, high: current.counter_high };

  // 2. L'écart : le montant que la marque énonce dans CE tour, situé dans la
  //    fourchette du moteur. Calculé ici, en TypeScript, jamais par le modèle.
  const { position, sentence: situation } = turnSituation(
    { changes, deal_after: dealAfter, pricing: current, pricing_unavailable: pricingUnavailable, brandReply },
    original.language,
  );
  if (position !== null && situation === null) {
    // Un nombre hors des valeurs autorisées : aucune phrase plutôt qu'un
    // chiffre dont on ne sait pas d'où il vient.
    console.warn(JSON.stringify({ event: "negociation_ecart_non_chiffrable", tour: turnNumber }));
  }

  // Mission #099, point 5 (audit B16) — la marque écrit plusieurs montants
  // (« entre 500 € et 700 €, disons jusqu'à 900 € »). La règle de rétention ne
  // change pas : le plus récent plafond fait foi. Mais les autres sont cités
  // tels qu'ils sont écrits, avec la raison du choix : un seul chiffre affiché
  // laisserait croire qu'elle n'en a dit qu'un.
  const retained = position?.amount ?? null;
  const others = readAmounts(brandReply).filter((amount) => amount.value !== retained);
  if (retained !== null && others.length > 0) {
    uncertainties.push(
      `La marque écrit plusieurs montants dans ce message : ${others.map((amount) => `« ${amount.text} »`).join(", ")}. ` +
        `L'outil a retenu ${formatEur(retained)}${position?.source === "ceiling" ? ", le dernier qu'elle annonce comme plafond" : ", le montant qu'elle écrit comme proposition"} : relis sa réponse pour vérifier.`,
    );
  }


  // Mission #083, D — le titre du tour vient des statuts affichés.
  const outcome = outcomeFromAsks(asks, turnNumber, { model: reading.outcome, changed: changes.length > 0, questions: questions.length });

  // Acceptation : la conclusion ferme l'échange dans ce même tour (D2).
  const accepted = outcome === "accepted";
  const conclusion = accepted
    ? buildConclusion({
        deal: dealAfter,
        asks,
        uncertainties,
        language: original.language,
        source: "brand_accepted",
        // La contre-offre acceptée est celle du message ENVOYÉ, donc d'avant ce
        // tour : un chiffrage refait après coup n'est pas ce que la marque a lu.
        counterAccepted: counterAcceptedWithoutAmount(asks, original, dealAfter)
          ? { low: pricingBefore.counter_low, high: pricingBefore.counter_high }
          : null,
        // Mission #098 — un plafond annoncé plus élevé que le montant retenu
        // est ce que la marque propose : la conclusion le porte, dit comme
        // tel, plutôt que de récapituler moins que ce qui est offert.
        offered: offeredAmount(dealAfter, ceiling, current),
        points: withReserves,
      })
    : null;

  const priceOpen = asks.some((ask) => ask.id === PRICE_ASK_ID && ask.status !== "granted");

  // 3. La fin : tous les points refermés et un montant sur la table. L'agent
  //    n'ouvre plus de question ; il présente l'état final et les deux
  //    messages, sans choisir à sa place.
  const closing =
    conclusion === null && everythingSettled(withReserves, dealAfter, asks)
      ? buildClosing({ deal: dealAfter, asks, points: withReserves, language: original.language, counter, pricing: current, ceiling, position, situation })
      : null;

  const simple = () =>
    fallbackMessage({
      language: original.language,
      open: openAsks(asks),
      counter,
      priceOpen,
      questions: questions.length,
      refused: outcome === "refused",
      situation,
    });
  const drafted = conclusion
    ? { text: conclusion.message, tone: TONES.clear, fallback: false, fallback_reasons: [] }
    : finalMessage({
          draft: reading.next_message.text,
          tone: toneLabel(reading.next_message.tone),
          deal: dealAfter,
          brandReply,
          language: original.language,
          counter,
          askLabels: asks.map((ask) => ask.label),
          unverifiedLabels: asks.filter((ask) => ask.unverified_turn === turnNumber).map((ask) => ask.label),
          situation,
          fallback: simple,
        });

  // 4. Aucune question sur un point déjà refermé : si le modèle en produit une,
  //    elle est retirée du message AVANT affichage, et dite dans les journaux —
  //    y compris quand la négociation est prête à conclure, où le message du
  //    modèle laisse la place aux deux messages écrits par le code. Un message
  //    qui n'aurait plus de corps retombe sur le message simple.
  const cleaned = stripRedundantQuestions(drafted.text, closed, dealAfter);
  for (const dropped of cleaned.dropped) {
    console.warn(JSON.stringify({ event: "negociation_question_redondante", point: dropped.point, tour: turnNumber }));
  }
  const emptied = cleaned.text.split(/\n{2,}/).filter((part) => part.trim() !== "").length < 3;
  // Mission #099, point 12 (audit B14) — DÉCISION PRODUIT, volontaire : le
  // message sortant est rédigé dans la langue de l'OFFRE D'ORIGINE
  // (original.language), jamais dans celle de la réponse de la marque. Une
  // marque qui répond en anglais à une offre française reçoit une réponse en
  // français : c'est la langue dans laquelle la créatrice négocie, et changer
  // de langue en cours d'échange ferait passer le message pour automatique.
  // Ce n'est pas un oubli : un test le verrouille.
  const message = closing
    ? { text: closing.hold.text, tone: TONES.clear, fallback: false, fallback_reasons: [] }
    : cleaned.dropped.length === 0
      ? drafted
      : emptied && conclusion === null
        ? { text: stripRedundantQuestions(simple(), closed, dealAfter).text, tone: TONES.firm, fallback: drafted.fallback, fallback_reasons: drafted.fallback_reasons }
        : { ...drafted, text: cleaned.text };

  // Mission #169 — LE MONTANT SUR LA TABLE ENTRE DANS LE CHIFFRAGE ENREGISTRÉ.
  // Jusqu'ici, le plafond annoncé par la marque ne vivait que dans le message
  // d'acceptation ; la carte devait donc aller le rechercher. Il est désormais
  // porté par le chiffrage lui-même, avec la bande recalculée sur CE montant :
  // un seul nombre affronte la fourchette, et c'est celui qui s'affiche.
  const surLaTable = conclusion?.offered ?? closing?.accept.offered ?? null;
  // Un tour qui ne change aucun terme n'a pas de « pricing_after » : c'est
  // « pricing_before » qui fait foi, et c'est donc lui qui porte le plafond.
  const pricingAfterFinal = pricingAfter ? withCeiling(pricingAfter, surLaTable) : null;
  const pricingBeforeFinal = pricingAfter ? pricingBefore : withCeiling(pricingBefore, surLaTable);

  return {
    kind: "turn",
    payload: {
      schema_version: TURN_SCHEMA_VERSION,
      tier,
      outcome,
      asks: asks,
      changes,
      ignored_changes: ignored,
      deal_before: before.deal,
      deal_after: dealAfter,
      changed_since_origin: changedSinceOrigin,
      pricing_before: pricingBeforeFinal,
      pricing_after: pricingAfterFinal,
      pricing_unavailable: pricingUnavailable,
      brand_questions: questions,
      uncertainties,
      message,
      points: withReserves,
      situation: position === null || situation === null ? null : { ...position, sentence: situation },
      stated_ceiling: ceiling,
      dropped_questions: cleaned.dropped,
      closing,
      conclusion,
    },
  };
}

// La marque a accordé la contre-offre sans écrire d'autre montant que celui de
// son offre de départ : le montant convenu n'est écrit nulle part.
function counterAcceptedWithoutAmount(asks: readonly Ask[], original: ResultView, deal: Deal): boolean {
  const price = asks.find((ask) => ask.id === PRICE_ASK_ID);
  // B1 : le montant peut aussi avoir été effacé (le modèle ne sait pas écrire
  // une fourchette) ; ce n'est pas un montant convenu pour autant.
  const amount = deal.payment.amount_eur;
  return price?.status === "granted" && (amount === null || amount === normalizeDeal(original.deal).payment.amount_eur);
}

// Conclusion sans nouvelle réponse de la marque : la personne décide
// d'accepter les termes en l'état (C, D2). Aucun appel au modèle.
export function concludeNow(original: ResultView, previous: readonly TurnPayload[], tier: Tier, offerText: string | null = null) {
  const state = stateBefore(original, previous, offerText);
  const last = previous.at(-1);
  const pricing = last ? (last.pricing_after ?? last.pricing_before) : originPricing(original, tier);
  const offered = offeredAmount(state.deal, last?.stated_ceiling ?? null, pricing);
  return {
    deal: state.deal,
    // Mission #169 — la ligne de conclusion porte son chiffrage, avec le
    // montant réellement sur la table. Une négociation conclue est le cas
    // qu'on a le plus envie de montrer : sans ce bloc, elle n'avait pas de
    // carte du tout.
    pricing: withCeiling(pricing, offered),
    conclusion: buildConclusion({
      deal: state.deal,
      asks: state.asks,
      uncertainties: previous.at(-1)?.uncertainties ?? [],
      language: original.language,
      source: "creator_accepted" as const,
      counterAccepted: counterAcceptedWithoutAmount(state.asks, original, state.deal)
        ? { low: pricing.counter_low, high: pricing.counter_high }
        : null,
      // Mission #099 (audit B1) — la mémoire des points vaut ici aussi : rien
      // n'est dit « sans réponse » quand elle affiche la phrase de la marque.
      points: state.points,
      offered,
    }),
  };
}
