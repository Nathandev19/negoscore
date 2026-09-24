import { pricePhrase } from "@/lib/analysis/engine-parts";
import { PRICE_PLACEHOLDER } from "@/lib/llm/prompt";
import { allowedNumbers } from "@/lib/negotiation/message";
import { topicsOf } from "@/lib/negotiation/topics";
import type { Analysis } from "@/lib/schema";

type Language = Analysis["language"];

// Mission #115, A — CE QUE LE MESSAGE DOIT PORTER.
//
// Vu en production le 24/09, sur une offre d'affiliation (2 vidéos TikTok,
// commission de 15 %, aucun fixe, droits pub 6 mois). L'écran établissait une
// fourchette de 300 – 620 €, une contre-offre, trois points à négocier et un
// signal grave — et le message prêt à envoyer tenait en une phrase :
//
//   « Merci pour ta proposition. Peux-tu me préciser quel budget est prévu par
//     la marque pour ce partenariat ? »
//
// Le message est le livrable ; tout le reste de l'écran sert à le préparer. Un
// message qui laisse tomber les points de l'analyse rend l'analyse inutile.
//
// Ce module ne parle ni au modèle ni à la base : il dit seulement ce qui
// manque, et sait compléter. Il se teste seul.

type Point = Analysis["negotiate"][number];
type Counter = Analysis["counter_offer"];

// Mots trop courts ou trop communs pour dire de quoi parle un point.
const STOPWORDS = new Set([
  "aucune", "aucun", "avec", "cette", "comme", "dans", "demander", "depuis", "leur", "leurs",
  "marque", "negocier", "négocier", "pour", "plus", "propre", "quand", "sans", "sont", "sur",
  "tous", "toutes", "votre", "vos", "être", "etre", "faire", "elle", "celui", "cela",
]);

const NO_ACCENT = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

// Mots porteurs d'un libellé : assez longs pour désigner un sujet, et pas dans
// la liste des mots de liaison. Sert UNIQUEMENT de repli, quand le point ne se
// rattache à aucun sujet connu du produit.
function contentWords(label: string): string[] {
  return [...new Set(NO_ACCENT(label).split(/[^a-z0-9]+/).filter((word) => word.length >= 5 && !STOPWORDS.has(word)))];
}

// Un point est TRAITÉ par le message quand les deux parlent du même sujet.
//
// Les sujets sont ceux que le produit connaît déjà (lib/negotiation/topics.ts,
// mission #083) : rémunération, paiement, exclusivité, droits d'utilisation,
// territoire, livrables, produits offerts, rushs, révisions. Le même détecteur
// est appliqué au libellé du point et au texte du message : aucune recherche
// de mots au hasard.
//
// Repli, pour un point qui ne se rattache à aucun sujet connu (« Publication
// sur ton propre compte ») : un mot porteur du libellé doit se retrouver dans
// le message. C'est le même partage que l'attribution des points de la mission
// #101 — le sujet d'abord, les mots ensuite, et jamais l'inverse.
export function pointCovered(label: string, message: string): boolean {
  const topics = topicsOf(label).map((topic) => topic.key);
  if (topics.length > 0) {
    const inMessage = new Set(topicsOf(message).map((topic) => topic.key));
    return topics.some((key) => inMessage.has(key));
  }
  const words = contentWords(label);
  if (words.length === 0) return true;
  const haystack = NO_ACCENT(message);
  return words.some((word) => haystack.includes(word));
}

export function uncoveredPoints(points: readonly Point[], message: string): Point[] {
  return points.filter((point) => !pointCovered(point.label, message));
}

// Le message porte-t-il le chiffre de la contre-offre ? On ne cherche pas la
// phrase exacte : on cherche les DEUX bornes, sous la forme où le produit les
// écrit et sous leur forme brute.
export function carriesCounterOffer(counter: Counter, message: string): boolean {
  if (counter.amount_low === null) return true;
  const bounds = [counter.amount_low, counter.amount_high].filter((value): value is number => value !== null);
  const haystack = digitsOnly(message);
  return bounds.every((value) => haystack.includes(String(value)));
}

// Les chiffres du texte, sans ce qui les sépare : « 1 150 € », « €1,150 » et
// « 1150 » se comparent alors de la même façon, en français comme en anglais.
function digitsOnly(text: string): string {
  return text.replace(/(\d)[\u202f\u00a0\s.,](?=\d{3}(?!\d))/g, "$1");
}

export type Coverage = {
  uncovered: Point[];
  // Une contre-offre chiffrée existe et le message ne la porte pas.
  missingAmount: boolean;
  ok: boolean;
};

export function messageCoverage(analysis: Pick<Analysis, "negotiate" | "counter_offer">, message: string): Coverage {
  const uncovered = uncoveredPoints(analysis.negotiate, message);
  const missingAmount = !carriesCounterOffer(analysis.counter_offer, message);
  return { uncovered, missingAmount, ok: uncovered.length === 0 && !missingAmount };
}

// Mission #115, A5 — aucune invention. Les seuls chiffres qu'un message peut
// citer sont ceux que l'analyse a produits : les quantités et durées du deal
// (allowedNumbers, mission #080) et les bornes de la contre-offre.
export function inventedNumbers(
  analysis: Pick<Analysis, "deal" | "negotiate" | "counter_offer">,
  message: string,
): string[] {
  const allowed = allowedNumbers(analysis.deal, analysis.negotiate.map((point) => point.label));
  for (const value of [analysis.counter_offer.amount_low, analysis.counter_offer.amount_high]) {
    if (value !== null) allowed.add(String(value));
  }
  // Un montant peut s'écrire avec une espace de milliers : « 1 200 € ».
  const compact = message.replace(/(\d)[\u202f\u00a0\s](?=\d{3}(?!\d))/g, "$1");
  const found = [...compact.matchAll(/\d+(?:[.,]\d+)?/g)].map((match) => match[0].replace(",", "."));
  return [...new Set(found.filter((value) => !allowed.has(value)))];
}

// Mission #115, A3 — ce qu'on ajoute quand le modèle n'a pas couvert les
// points, même après une seconde tentative. Un message plus long vaut mieux
// qu'un message qui oublie ce qui est en jeu.
//
// A4 — le ton reste celui d'un créateur : une phrase qui enchaîne les demandes,
// pas une liste à puces ni un courrier d'avocat. Les libellés des points sont
// repris tels qu'ils sont affichés sous « Ce qu'il faut négocier » : ce sont
// déjà des demandes écrites en français.
export const COMPLETION_INTRO: Record<Language, string> = {
  fr: "Avant d'aller plus loin, j'aurais besoin qu'on cale aussi",
  en: "Before we move forward, I would also need to settle",
};

export function askPhrase(labels: readonly string[], language: Language = "fr"): string {
  const cleaned = labels.map((label) => label.trim().replace(/[.!?]+$/, "")).filter(Boolean);
  // Les libellés s'enchaînent APRÈS l'introduction : ils continuent la phrase,
  // ils ne la commencent pas. « …qu'on cale aussi préciser le territoire et la
  // publication sur ton compte » se lit ; avec des majuscules, non.
  const lowered = cleaned.map((label) => label.charAt(0).toLowerCase() + label.slice(1));
  if (lowered.length === 0) return "";
  if (lowered.length === 1) return lowered[0];
  const join = language === "en" ? "and" : "et";
  return `${lowered.slice(0, -1).join(", ")} ${join} ${lowered.at(-1)}`;
}

// Le montant est écrit par pricePhrase, la MÊME fonction que le message du
// modèle : le recalcul par niveau remplace cette phrase par la nouvelle
// (lib/analysis/recompute.ts) au lieu de laisser un chiffre périmé derrière.
export function amountPhrase(counter: Counter, language: Language = "fr"): string {
  if (counter.amount_low === null) return "";
  const phrase = pricePhrase(language, { low: counter.amount_low, high: counter.amount_high });
  return language === "en"
    ? `On my side, my fee for this project is ${phrase}.`
    : `De mon côté, mon tarif pour ce projet se situe ${phrase}.`;
}

// Complète le message, sans jamais le réécrire : ce que le modèle a produit
// reste en tête, et ce qui manquait s'ajoute derrière.
export function completeMessage(
  analysis: Pick<Analysis, "negotiate" | "counter_offer"> & { language?: Language },
  message: string,
): string {
  const language: Language = analysis.language ?? "fr";
  const { uncovered, missingAmount } = messageCoverage(analysis, message);
  if (uncovered.length === 0 && !missingAmount) return message;
  const parts = [message.trim()];
  if (missingAmount) parts.push(amountPhrase(analysis.counter_offer, language));
  if (uncovered.length > 0) {
    parts.push(`${COMPLETION_INTRO[language]} ${askPhrase(uncovered.map((point) => point.label), language)}.`);
  }
  return parts.filter(Boolean).join(" ");
}

// Mission #115, A3 — faut-il demander une seconde version au modèle ?
//
// Oui quand le message que le MODÈLE a écrit ne couvrait pas tout : c'est le
// texte d'origine qu'on juge, pas celui que composeAnalysis a déjà complété.
// Les deux états sans chiffrage gardent le message du moteur, qui demande déjà
// ce qui manque : rien à réécrire.
export function needsRewrite(
  extraction: { ready_to_send_message: { text: string } },
  analysis: Pick<Analysis, "evaluability" | "negotiate" | "counter_offer">,
): boolean {
  if (analysis.evaluability === "incomplete" || analysis.evaluability === "terms_unknown") return false;
  // Le texte brut du modèle porte le marqueur, pas encore le montant : un
  // marqueur présent VAUT la fourchette, c'est composeAnalysis qui l'écrira.
  const bounds = [analysis.counter_offer.amount_low, analysis.counter_offer.amount_high].filter((value) => value !== null);
  const text = extraction.ready_to_send_message.text.replaceAll(PRICE_PLACEHOLDER, bounds.join(" "));
  return !messageCoverage(analysis, text).ok;
}
