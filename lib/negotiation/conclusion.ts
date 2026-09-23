import type { CounterRange } from "@/lib/analysis/anchoring";
import { deliverablesLine, formatEur, formatEurRange } from "@/lib/display";
import { computeFrLegal, WRITTEN_CONTRACT_THRESHOLD_EUR } from "@/lib/legal/fr";
import {
  amountLabel,
  exclusivityLabel,
  hasUsageRights,
  paymentTermsLabel,
  usageDurationLabel,
  usageRightsLabel,
} from "@/lib/negotiation/terms";
import { pointsOfSentence } from "@/lib/negotiation/points";
import { topicsOf } from "@/lib/negotiation/topics";
import type { Ask, Conclusion, Deal, PointState } from "@/lib/negotiation/types";

// Mission #080, C — la conclusion, écrite ENTIÈREMENT par le code à partir des
// termes lus et vérifiés : aucun appel au modèle, donc rien d'inventé, et
// aucun coût (D2). Elle ne dit jamais s'il faut accepter ou refuser (C5) : elle
// récapitule ce qui a été convenu, liste ce qui reste flou, et propose un
// message qui demande une confirmation écrite.

type Language = "fr" | "en";

// C1 — les sept rubriques, toujours présentes, « non précisé » compris : un
// trou dans le récapitulatif doit se voir.
export function recapRows(deal: Deal): Array<{ label: string; value: string }> {
  const amount = amountLabel(deal);
  return [
    { label: "Livrables", value: deliverablesLine(deal) ?? "Non précisés" },
    {
      label: "Rémunération",
      value: deal.in_kind_value_eur === null ? amount : `${amount}, plus des produits d'une valeur de ${formatEur(deal.in_kind_value_eur)}`,
    },
    {
      label: "Droits d'utilisation",
      value: hasUsageRights(deal) ? `${usageRightsLabel(deal)} — durée : ${usageDurationLabel(deal).toLowerCase()}` : usageRightsLabel(deal),
    },
    { label: "Territoire", value: deal.usage.territory ?? "Non précisé" },
    { label: "Exclusivité", value: exclusivityLabel(deal) },
    { label: "Paiement", value: paymentTermsLabel(deal) },
    { label: "Publication sur tes comptes", value: deal.publication_required ? "Oui" : "Non demandée" },
  ];
}

// C2 — ce qui reste flou ou non dit, sans fard.
export function unclearPoints(deal: Deal, asks: readonly Ask[], uncertainties: readonly string[] = []): string[] {
  const rights = hasUsageRights(deal);
  return [
    deal.payment.amount_eur === null && deal.in_kind_value_eur === null ? "Le montant de la rémunération n'est écrit nulle part." : null,
    deal.deliverables.length === 0 ? "Les contenus attendus ne sont pas décrits." : null,
    deal.deliverables.some((d) => d.quantity === null) ? "Le nombre de contenus attendus." : null,
    rights && deal.usage.duration_months === null && !deal.usage.perpetual ? "La durée des droits d'utilisation." : null,
    rights && deal.usage.territory === null ? "Le territoire où les contenus seront diffusés." : null,
    deal.exclusivity.present && deal.exclusivity.duration_months === null ? "La durée de l'exclusivité." : null,
    deal.exclusivity.present && deal.exclusivity.category === null ? "Les marques ou produits concernés par l'exclusivité." : null,
    deal.payment.terms_days === null && deal.payment.schedule === null ? "Le délai et les modalités de paiement." : null,
    deal.ip_transfer === "unclear" ? "Ce que deviennent les droits sur tes contenus." : null,
    deal.revisions.count === null && !deal.revisions.unlimited ? "Le nombre de retouches comprises." : null,
    ...(asks.some((ask) => ask.global)
      ? ["La marque a donné un accord global sans reprendre chaque point : fais-les-lui confirmer un par un, par écrit."]
      : []),
    ...asks
      .filter((ask) => ask.status === "partial")
      .map((ask) => `« ${ask.label} » : accordé en partie. Reste à préciser : ${ask.remaining ?? "ce que la marque n'a pas repris de ta demande"}.`),
    ...asks
      .filter((ask) => ask.status === "unanswered")
      .map((ask) =>
        ask.aligned_group
          ? `« ${ask.label} » : le terme a changé dans ce sens, sans phrase explicite de la marque. Fais-le-lui confirmer par écrit.`
          : ask.unverified_turn !== null
            ? `« ${ask.label} » : la réponse de la marque sur ce point n'a pas pu être vérifiée. Relis-la, et fais-le-lui confirmer par écrit.`
            : `Pas de réponse de la marque sur : ${ask.label}`,
      ),
    ...uncertainties.map(unclearDoubt),
  ].filter((point): point is string => point !== null);
}

// Mission #083, E2 — « L'outil n'est pas sûr d'avoir bien lu : » ne précède
// qu'un vrai doute de lecture. Un doute déjà rédigé par le code dit lui-même ce
// que l'outil a lu ou écarté ; un conseil (« le contrat devra préciser… ») est
// une recommandation, pas une incertitude. Les deux restent tels quels.
const ALREADY_SAID = /l'outil|^«|^sur «|^la marque parle de|n'a pas pu être lu/iu;
const ADVICE =
  /(?<![\p{L}])(?:devra|devront|devrait|devraient|doit|doivent|il faut|pense à|penser à|n'oublie|assure-toi|vérifie|demande-lui|fais-lui|mieux vaut|il est conseillé|il vaut mieux)(?![\p{L}])/iu;

export function unclearDoubt(doubt: string): string {
  return ALREADY_SAID.test(doubt) || ADVICE.test(doubt) ? doubt : `L'outil n'est pas sûr d'avoir bien lu : ${doubt}`;
}

// Mission #083, E3 — une demande accordée dont le sujet a déjà sa ligne dans
// le récapitulatif n'y est pas répétée :
//   - la ligne dit déjà tout ce que dit la demande (« Exclusivité ramenée à
//     1 mois » et « Oui, 1 mois (cosmétique) ») : la demande n'est pas reprise ;
//   - la demande dit tout ce que dit la ligne, et plus (« Paiement à 30 jours,
//     50 % à la signature » et « À 30 jours ») : la ligne prend ses mots ;
//   - sinon (la demande porte autre chose, « facturés en plus de la
//     création »), elle reste dans la liste : rien d'accordé n'est perdu.
const STOPWORDS = new Set(["a", "à", "au", "aux", "de", "des", "du", "d", "en", "et", "la", "le", "les", "l", "un", "une", "sur", "par", "pour", "avec"]);
const CHANGE_VERB = /^(ramen|rédui|redui|réduct|pass[ée]|limit|port[ée]|fix[ée]|abaiss|baiss|augment|mont[ée]|ajust)/u;

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\d]+/u)
    .filter((word) => word !== "" && !STOPWORDS.has(word));
}

type Row = { label: string; value: string };

export function foldGranted(rows: Row[], granted: readonly string[], capitalize: boolean): { rows: Row[]; rest: string[] } {
  const next = rows.map((row) => ({ ...row }));
  const rest: string[] = [];
  for (const label of granted) {
    const targets = topicsOf(label)
      .flatMap((topic) => topic.rows)
      .map((name) => next.find((row) => row.label === name))
      .filter((row): row is Row => row !== undefined);
    const row = targets.length === 1 ? targets[0] : null;
    if (!row) {
      rest.push(label);
      continue;
    }
    const heading = new Set(words(row.label));
    const own = words(label).filter((word) => !heading.has(word) && !CHANGE_VERB.test(word));
    const value = new Set(words(row.value));
    if (own.every((word) => value.has(word))) continue;
    const said = new Set(words(label));
    if ([...value].every((word) => said.has(word))) {
      // Les mots de la demande, sans le nom de la rubrique qui les précède.
      const first = label.trim().split(/\s+/)[0] ?? "";
      const body = heading.has(first.toLowerCase()) ? label.trim().slice(first.length).trim() : label.trim();
      row.value = capitalize ? body.charAt(0).toUpperCase() + body.slice(1) : body.charAt(0).toLowerCase() + body.slice(1);
      continue;
    }
    rest.push(label);
  }
  return { rows: next, rest };
}

// Points à faire préciser dans le message : ceux qui tiennent aux termes, pas
// les doutes de l'outil (formulés pour la personne, pas pour la marque).
function questionsForBrand(deal: Deal): string[] {
  const rights = hasUsageRights(deal);
  return [
    deal.payment.amount_eur === null && deal.in_kind_value_eur === null ? "le montant de la rémunération" : null,
    deal.deliverables.some((d) => d.quantity === null) ? "le nombre de contenus attendus" : null,
    rights && deal.usage.duration_months === null && !deal.usage.perpetual ? "la durée des droits d'utilisation" : null,
    rights && deal.usage.territory === null ? "le territoire de diffusion" : null,
    deal.exclusivity.present && deal.exclusivity.duration_months === null ? "la durée de l'exclusivité" : null,
    deal.payment.terms_days === null && deal.payment.schedule === null ? "le délai et les modalités de paiement" : null,
  ].filter((point): point is string => point !== null);
}

const QUESTIONS_EN: Record<string, string> = {
  "le montant de la rémunération": "the amount of the fee",
  "le montant exact retenu dans cette fourchette": "the exact amount within this range",
  "le nombre de contenus attendus": "the number of pieces of content expected",
  "la durée des droits d'utilisation": "how long the usage rights last",
  "le territoire de diffusion": "the territory where the content will run",
  "la durée de l'exclusivité": "how long the exclusivity lasts",
  "le délai et les modalités de paiement": "the payment terms and timing",
};

// C3 — le message qui reprend les termes et demande une confirmation écrite.
// Vouvoiement : c'est un message de clôture, qui peut être transmis tel quel à
// un service juridique ou comptable côté marque.
// Termes connus, écrits du point de vue de la créatrice qui s'adresse à la
// marque (« mon compte », « vos comptes ») : les libellés de l'écran, eux,
// tutoient la personne et ne peuvent pas être recopiés tels quels.
function knownTermsForBrand(deal: Deal, language: Language): Array<{ label: string; value: string }> {
  const en = language === "en";
  const rows: Array<{ label: string; value: string } | null> = [];
  const deliverables = deliverablesLine(deal);
  if (deliverables) rows.push({ label: en ? "Content" : "Contenus", value: deliverables });
  if (deal.payment.amount_eur !== null || deal.in_kind_value_eur !== null) {
    const parts = [
      deal.payment.amount_eur === null ? null : formatEur(deal.payment.amount_eur, en ? "en" : "fr"),
      deal.in_kind_value_eur === null ? null : en ? `products worth ${formatEur(deal.in_kind_value_eur, "en")}` : `des produits d'une valeur de ${formatEur(deal.in_kind_value_eur)}`,
    ].filter((part): part is string => part !== null);
    rows.push({ label: en ? "Fee" : "Rémunération", value: parts.join(en ? " plus " : ", plus ") });
  }
  if (hasUsageRights(deal)) {
    const rights = [
      deal.usage.organic ? (en ? "posting on your accounts" : "publication sur vos comptes") : null,
      deal.usage.paid_ads ? (en ? "paid advertising" : "publicité payante") : null,
      deal.usage.whitelisting ? (en ? "ads run from my account (whitelisting)" : "diffusion depuis mon compte (whitelisting)") : null,
      deal.usage.spark_ads ? "Spark Ads" : null,
    ].filter((right): right is string => right !== null);
    const duration = deal.usage.perpetual
      ? en ? "no time limit" : "sans limite de durée"
      : deal.usage.duration_months === null
        ? null
        : en ? `${deal.usage.duration_months} months` : `${deal.usage.duration_months} mois`;
    rows.push({ label: en ? "Usage rights" : "Droits d'utilisation", value: duration ? `${rights.join(", ")} (${duration})` : rights.join(", ") });
  }
  if (deal.usage.territory) rows.push({ label: en ? "Territory" : "Territoire", value: deal.usage.territory });
  if (deal.exclusivity.present) {
    const duration = deal.exclusivity.duration_months === null ? null : en ? `${deal.exclusivity.duration_months} months` : `${deal.exclusivity.duration_months} mois`;
    const details = [duration, deal.exclusivity.category].filter((part): part is string => part !== null).join(", ");
    rows.push({ label: en ? "Exclusivity" : "Exclusivité", value: details ? (en ? `yes (${details})` : `oui (${details})`) : en ? "yes" : "oui" });
  }
  if (deal.payment.terms_days !== null || deal.payment.schedule) {
    const parts = [
      deal.payment.terms_days === null ? null : en ? `within ${deal.payment.terms_days} days` : `à ${deal.payment.terms_days} jours`,
      deal.payment.schedule,
    ].filter((part): part is string => part !== null && part !== "");
    rows.push({ label: en ? "Payment" : "Paiement", value: parts.join(", ") });
  }
  if (deal.publication_required) rows.push({ label: en ? "Posting on my accounts" : "Publication sur mes comptes", value: en ? "yes" : "oui" });
  return rows.filter((row): row is { label: string; value: string } => row !== null);
}

// Mission #096, défaut 2 — une demande écrite pour l'écran (« Limiter les
// droits publicitaires à 6 mois », « ton compte ») n'est pas une phrase de
// message : elle tutoie et elle commande. Reformulée à la troisième personne,
// sans impératif, pour un message vouvoyé adressé à une marque.
const AGREED_VERB =
  /^(?:limiter|préciser|fixer|confirmer|facturer|proposer|ramener|ajouter|obtenir|demander|négocier|réduire|encadrer|supprimer|inclure|prévoir|garantir|exiger|vérifier|définir|clarifier|plafonner|retirer|étendre|raccourcir|rallonger|payer|régler|livrer|publier|faire|mettre|passer|conserver|maintenir|borner|indiquer|lister|nommer|chiffrer|valider|facturer)(?![\p{L}])/iu;

const TO_FIRST_PERSON: ReadonlyArray<readonly [RegExp, string]> = [
  [/(?<![\p{L}])ton(?![\p{L}])/giu, "mon"],
  [/(?<![\p{L}])ta(?![\p{L}])/giu, "ma"],
  [/(?<![\p{L}])tes(?![\p{L}])/giu, "mes"],
  [/(?<![\p{L}])tienne?s?(?![\p{L}])/giu, "mienne"],
  [/(?<![\p{L}])toi(?![\p{L}])/giu, "moi"],
];

export function agreedItem(label: string, language: Language): string {
  const cleaned = TO_FIRST_PERSON.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), label.trim()).replace(
    /[.\s]+$/,
    "",
  );
  const lowered = cleaned.charAt(0).toLowerCase() + cleaned.slice(1);
  // Sans verbe d'action en tête, la phrase n'est pas une action : elle est
  // retenue telle quelle, derrière un verbe qui la rattache à la liste.
  if (AGREED_VERB.test(lowered)) return lowered;
  return language === "en" ? `keep ${lowered}` : `retenir ${lowered}`;
}

// Ce qui reste vraiment à dire : une demande dont la marque a déjà réglé le
// sujet figure au-dessus, dans le récapitulatif. La répéter en « convenu en
// plus » n'apprend rien.
export function remainingAgreed(rest: readonly string[], points: readonly PointState[], deal: Deal): string[] {
  const closed = new Set(points.filter((point) => point.status !== "unknown").map((point) => point.key));
  if (closed.size === 0) return [...rest];
  return rest.filter((label) => {
    const mentioned = pointsOfSentence(label, deal).map((point) => point.key);
    // Une demande qui parle de plusieurs sujets n'est retirée que si ils sont
    // TOUS réglés : sinon ce qui reste à dire disparaîtrait avec elle.
    return mentioned.length === 0 || !mentioned.every((key) => closed.has(key));
  });
}

export function conclusionMessage(
  deal: Deal,
  language: Language,
  granted: readonly string[] = [],
  counterAccepted: CounterRange | null = null,
  // Mission #096 : le montant que la marque propose sans qu'il soit encore un
  // terme convenu, et la mémoire des points (#095) pour ne pas répéter ce qui
  // figure déjà dans le récapitulatif. dealRead : les termes tels qu'ils sont
  // lus, pour rattacher une demande à son sujet.
  extra: { offered?: number | null; points?: readonly PointState[]; dealRead?: Deal } = {},
): string {
  const known = knownTermsForBrand(deal, language);
  // Contre-offre acceptée sans montant écrit : la fourchette proposée est
  // rappelée (chiffres du moteur), et le montant exact est demandé.
  if (counterAccepted && counterAccepted.low !== null && counterAccepted.high !== null) {
    known.splice(1, 0, {
      label: language === "en" ? "Fee" : "Rémunération",
      value:
        language === "en"
          ? `as per my proposal, between ${formatEur(counterAccepted.low, "en")} and ${formatEur(counterAccepted.high, "en")}`
          : `selon ma proposition, entre ${formatEur(counterAccepted.low)} et ${formatEur(counterAccepted.high)}`,
    });
  }
  // E3 — ce qui a déjà sa ligne n'est pas répété dans « Convenu en plus ».
  // Les libellés anglais ne sont pas ceux des sujets : rien n'y est replié.
  const folded = language === "fr" ? foldGranted(known, granted, false) : { rows: known, rest: [...granted] };
  known.splice(0, known.length, ...folded.rows);
  // Mission #096, défaut 2 — ce qui n'apparaît nulle part ailleurs, et rien
  // d'autre ; reformulé, en puces. Rien ne reste : pas de ligne du tout.
  const also = remainingAgreed(folded.rest, extra.points ?? [], extra.dealRead ?? deal).map((label) => agreedItem(label, language));
  const questions = questionsForBrand(deal).map((q) =>
    counterAccepted && q === "le montant de la rémunération" ? "le montant exact retenu dans cette fourchette" : q,
  );
  const offered = extra.offered ?? null;
  if (language === "en") {
    return [
      "Hello,",
      "",
      ...(offered === null
        ? ["Thank you for your reply. To make sure we are aligned, here is what I have noted:"]
        : [
            `Thank you for your reply. I am happy to move forward on the basis of ${formatEur(offered, "en")}, the amount you offer.`,
            "",
            "To make sure we are aligned, here is what I have noted:",
          ]),
      ...known.map((row) => `- ${row.label}: ${row.value}`),
      ...(also.length > 0 ? ["", "We also agree to:", ...also.map((item) => `- ${item}`)] : []),
      ...(questions.length > 0 ? ["", "Could you also specify:", ...questions.map((q) => `- ${QUESTIONS_EN[q] ?? q}`)] : []),
      "",
      "Could you confirm these points in writing in reply to this message? Thank you!",
      "",
      "Best regards,",
    ].join("\n");
  }
  return [
    "Bonjour,",
    "",
    // Le plafond annoncé est accepté comme une proposition de la marque, et
    // confirmé plus bas : jamais présenté comme déjà acquis.
    ...(offered === null
      ? ["Merci pour votre retour. Pour être sûrs d'être d'accord, voici ce que je retiens :"]
      : [
          `Merci pour votre retour. C'est d'accord pour avancer sur la base de ${formatEur(offered)}, le montant que vous proposez.`,
          "",
          "Pour être sûrs d'être d'accord, voici ce que je retiens :",
        ]),
    ...known.map((row) => `- ${row.label} : ${row.value}`),
    ...(also.length > 0 ? ["", "Il est également convenu de :", ...also.map((item) => `- ${item}`)] : []),
    ...(questions.length > 0 ? ["", "Pourriez-vous aussi me préciser :", ...questions.map((q) => `- ${q}`)] : []),
    "",
    "Pourriez-vous me confirmer ces points par écrit, en réponse à ce message ? Merci beaucoup.",
    "",
    "Belle journée,",
  ].join("\n");
}

// Contre-offre acceptée sans que la marque écrive de montant : le montant du
// deal est encore celui de SON offre de départ. Le récapituler serait faux. Il
// est retiré (inconnu), la contre-offre du moteur est rappelée, et le message
// demande le montant exact.
// Contre-offre acceptée sans montant écrit : le seuil du contrat écrit se juge
// sur la fourchette acceptée quand elle est tout entière d'un même côté du
// seuil (toute somme de la fourchette le dépasse, ou aucune). Sinon, le
// montant reste inconnu et la note le dit.
function legalDeal(deal: Deal, counter: CounterRange | null): Deal {
  if (!counter || counter.low === null || counter.high === null) return deal;
  const side =
    counter.low >= WRITTEN_CONTRACT_THRESHOLD_EUR ? counter.low : counter.high < WRITTEN_CONTRACT_THRESHOLD_EUR ? counter.high : null;
  return side === null ? deal : { ...deal, payment: { ...deal.payment, amount_eur: side } };
}

export function buildConclusion({
  deal: read,
  asks,
  uncertainties = [],
  language,
  source,
  counterAccepted = null,
  offered = null,
  points = [],
}: {
  deal: Deal;
  asks: readonly Ask[];
  uncertainties?: readonly string[];
  language: Language;
  source: Conclusion["source"];
  counterAccepted?: CounterRange | null;
  // Mission #098 — le plafond annoncé par la marque, quand il dépasse le
  // montant retenu dans les termes. Les TERMES ne bougent pas : seul le
  // message porte ce montant, et il en demande confirmation.
  offered?: number | null;
  points?: readonly PointState[];
}): Conclusion {
  const counterRange = counterAccepted ? formatEurRange(counterAccepted.low, counterAccepted.high) : null;
  const deal: Deal = counterRange ? { ...read, payment: { ...read.payment, amount_eur: null } } : read;
  const shown = offered === null ? deal : { ...deal, payment: { ...deal.payment, amount_eur: offered } };
  const rows = recapRows(shown).map((row) =>
    counterRange && row.label === "Rémunération"
      ? { ...row, value: `Ta contre-offre, ${counterRange} : la marque l'a acceptée sans écrire le montant exact` }
      : offered !== null && row.label === "Rémunération"
        ? { ...row, value: `${row.value} — le montant que la marque propose, encore à confirmer par écrit` }
        : row,
  );
  // Demandes accordées par la marque (hors prix, déjà dans « Rémunération ») :
  // révisions, rushs, modalités… Tout ce qu'elle a accepté figure dans le
  // récapitulatif et dans le message, même ce que les termes suivis ne portent
  // pas ; ce qui a déjà sa ligne n'y est pas répété (E3).
  const granted = asks.filter((ask) => ask.status === "granted" && ask.id !== "prix").map((ask) => ask.label);
  const folded = foldGranted(rows, granted, true);
  const recap = folded.rows;
  if (folded.rest.length > 0) recap.push({ label: "Accordé par la marque", value: folded.rest.join(" ; ") });
  const unclear = unclearPoints(deal, asks, uncertainties).map((point) =>
    counterRange && point.startsWith("Le montant de la rémunération")
      ? "Le montant exact convenu : la marque a accepté ta contre-offre sans l'écrire."
      : point,
  );
  return {
    source,
    recap,
    unclear,
    message: conclusionMessage(deal, language, granted, counterRange ? counterAccepted : null, {
      offered,
      points,
      dealRead: deal,
    }),
    // C4 — même règle et même texte que l'analyse : lib/legal/fr.ts, seul
    // endroit du projet où un énoncé juridique est écrit.
    legal_note: computeFrLegal(legalDeal(deal, counterRange ? counterAccepted : null)).note,
  };
}
