import { TONES } from "@/lib/tone";
import type { CounterRange } from "@/lib/analysis/anchoring";
import { pricePhrase } from "@/lib/analysis/engine-parts";
import { formatEur } from "@/lib/money";
import { PRICE_PLACEHOLDER } from "@/lib/llm/prompt";
import { normalizeForQuote, quoteIsIn } from "@/lib/negotiation/quotes";
import { topicsOf } from "@/lib/negotiation/topics";
import type { Ask, Deal, TurnMessage } from "@/lib/negotiation/types";

// Mission #080, F3 à F5 — le message suivant, contrôlé par le code avant d'être
// montré. Le brouillon du modèle est écarté, et remplacé par un message simple
// écrit ici, s'il contient :
//   - un montant (le seul montant autorisé est la contre-offre du moteur,
//     insérée par le code à la place de {{CONTRE_OFFRE}}) ;
//   - un nombre que le deal ne porte pas (quantité, durée, délai) ;
//   - une date, une échéance ou un ultimatum ;
//   - un mot sec ou agressif ;
//   - une citation que la marque n'a pas écrite ;
//   - un accord sur un point dont la lecture n'a pas pu être vérifiée
//     (mission #083, A2).
// Les raisons de l'écart sont enregistrées et affichées.

type Language = "fr" | "en";

export const FALLBACK_REASON = {
  money: "un montant qui ne vient pas du chiffrage",
  number: "un nombre que le deal ne contient pas",
  deadline: "une date limite ou un ultimatum",
  tone: "une formulation trop sèche",
  quote: "une phrase prêtée à la marque qu'elle n'a pas écrite",
  gender: "une formule qui suppose ton genre (par exemple « ravie »)",
  empty: "un message vide",
  agreement: "un accord que la réponse de la marque ne permet pas de vérifier",
} as const;
export type FallbackReason = keyof typeof FALLBACK_REASON;

const MONEY = /(\d[\d\s.,]*\s?(€|eur\b|euros?\b|k€|k\b|\$|usd\b|dollars?\b))|((€|\$)\s?\d)/i;

// Échéances et ultimatums (F3), en français et en anglais.
const DEADLINE = new RegExp(
  [
    "date limite",
    "dernier délai",
    "au plus tard",
    "d'ici (le |la |lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|demain|ce soir|la fin|\\d)",
    "avant (le |lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|demain|ce soir|la fin)",
    "jusqu'(au|à) (lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|demain|\\d)",
    "sous (\\d+|vingt-quatre|quarante-huit) ?(h|heures|jours)",
    "dans les (\\d+|vingt-quatre|quarante-huit) ?(h|heures)",
    "ultimatum",
    "faute de quoi",
    "à défaut de",
    "sinon,? je",
    "je me (retire|désiste)",
    "je (décline|refuse) (votre|l')",
    "sans réponse de votre part",
    "offre (valable|expire)",
    "deadline",
    "by (monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|end of)",
    "otherwise,? i",
    "final offer",
    "take it or leave it",
    "\\b\\d{1,2}[/.-]\\d{1,2}\\b",
    "\\b\\d{1,2}(er)? (janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)",
  ].join("|"),
  "i",
);

// Ton (F5) : ce qui rend un message sec quand la négociation traîne.
const HARSH = new RegExp(
  [
    "inacceptable",
    "ridicule",
    "honteu",
    "scandaleu",
    "irrespectueu",
    "insultant",
    "je vous rappelle",
    "comme (je l'ai|déjà) (déjà )?(dit|indiqué|précisé)",
    "encore une fois",
    "pour la dernière fois",
    "sérieusement",
    "vous ne semblez pas",
    "unacceptable",
    "ridiculous",
    "insulting",
    "as i (already )?said",
    "once again",
    "for the last time",
  ].join("|"),
  "i",
);

// Mission #080 quater, A4 — le produit ne sait pas qui écrit : aucun accord
// au masculin ni au féminin à la première personne (« je suis ravie », « je
// reste ouvert »). Les deux genres sont refusés, « disponible » reste permis.
const GENDERED_ADJECTIVES =
  "ravie?|contente?|heureu(?:x|se)|prête?|ouverte?|intéressée?|enchantée?|certaine?|sûre?|motivée?|convaincue?|désolée?|touchée?|honorée?|flattée?|déçue?";
const GENDERED = new RegExp(
  `\\b(?:je (?:suis|reste|serai|serais|me sens)|suis|reste)\\s+(?:(?:très|vraiment|tout à fait|si|bien)\\s+)?(?:${GENDERED_ADJECTIVES})(?![\\p{L}])`,
  "iu",
);

// A5 — un message à une marque commence par une salutation, sur sa propre
// ligne. Absente : ajoutée. Collée à la phrase suivante : détachée.
const GREETING = /^(bonjour|bonsoir|hello|hi|salut)\b([^,\n!.]{0,30})[,!.]?[ \t]*/i;
export function withGreeting(text: string, language: Language): string {
  const trimmed = text.trim();
  const match = trimmed.match(GREETING);
  if (!match) return `${language === "en" ? "Hello," : "Bonjour,"}\n\n${trimmed}`;
  const tail = trimmed.slice(match[0].length).replace(/^\n+/, "");
  // « Bonjour, merci pour… » : la phrase détachée reprend sa majuscule.
  const rest = tail.charAt(0).toUpperCase() + tail.slice(1);
  return rest === "" ? `${match[1]}${match[2].trimEnd()},` : `${match[1]}${match[2].trimEnd()},\n\n${rest}`;
}

// Nombres qui ont une source : le deal (quantités, durées, délai, révisions),
// les demandes déjà faites à la marque (« 2 révisions », « à 30 jours ») et ce
// que la marque a écrit. Tout autre nombre dans le brouillon est suspect. Un
// montant, lui, n'est jamais permis, même repris de la marque (voir MONEY).
export function allowedNumbers(deal: Deal, sources: readonly string[] = []): Set<string> {
  const values = [
    ...deal.deliverables.map((d) => d.quantity),
    deal.usage.duration_months,
    deal.exclusivity.duration_months,
    deal.payment.terms_days,
    deal.revisions.count,
  ].filter((value): value is number => value !== null);
  const allowed = new Set(values.map((value) => String(value)));
  for (const source of sources) {
    for (const match of source.matchAll(/\d+(?:[.,]\d+)?/g)) {
      // Un nombre écrit comme un montant (« 400 € ») n'est pas une source : le
      // message ne reprend aucun montant, même sans le signe.
      const after = source.slice((match.index ?? 0) + match[0].length);
      if (/^\s?(€|eur\b|euros?\b|k€|k\b|\$)/i.test(after)) continue;
      allowed.add(match[0].replace(",", "."));
    }
  }
  return allowed;
}

// Segments entre guillemets dans le brouillon : chacun doit être dans la réponse.
function quotedSegments(text: string): string[] {
  return [...text.matchAll(/«\s*([^»]{4,})\s*»|“([^”]{4,})”|"([^"]{4,})"/g)].map((m) => (m[1] ?? m[2] ?? m[3]).trim());
}

// Mission #083, A2 — une phrase qui affirme un accord (« je prends bonne note
// de l'accord concernant… », « merci d'avoir accepté… »). Une question (« pouvez-
// vous me confirmer votre accord ? ») n'affirme rien.
const AGREEMENT =
  /(?<![\p{L}])(?:accord|accept|ok pour|okay pour|prends (?:bonne )?note|pris (?:bonne )?note|noté|entendu pour|validé|validez|merci d'avoir|je retiens|agree|noted)/iu;

// Le brouillon affirme-t-il un accord sur l'un de ces points ? Un point est
// reconnu par son sujet (paiement, exclusivité…), pas par ses mots exacts.
export function claimsAgreementOn(draft: string, labels: readonly string[]): boolean {
  const topics = labels.flatMap((label) => topicsOf(label));
  if (topics.length === 0) return false;
  const sentences = draft.match(/[^.!?\n]+[.!?]?/g) ?? [];
  return sentences.some(
    (sentence) => !sentence.trim().endsWith("?") && AGREEMENT.test(sentence) && topics.some((topic) => topic.pattern.test(sentence)),
  );
}

export function messageProblems(
  draft: string,
  deal: Deal,
  brandReply: string,
  askLabels: readonly string[] = [],
  unverifiedLabels: readonly string[] = [],
): FallbackReason[] {
  const problems = new Set<FallbackReason>();
  const text = draft.replaceAll(PRICE_PLACEHOLDER, " ");
  if (normalizeForQuote(text) === "") problems.add("empty");
  if (MONEY.test(text)) problems.add("money");
  const allowed = allowedNumbers(deal, [brandReply, ...askLabels]);
  for (const match of text.matchAll(/\d+(?:[.,]\d+)?/g)) {
    if (!allowed.has(match[0].replace(",", "."))) problems.add("number");
  }
  if (DEADLINE.test(text)) problems.add("deadline");
  if (HARSH.test(text)) problems.add("tone");
  if (GENDERED.test(text)) problems.add("gender");
  for (const segment of quotedSegments(text)) if (!quoteIsIn(segment, brandReply)) problems.add("quote");
  if (claimsAgreementOn(text, unverifiedLabels)) problems.add("agreement");
  return [...problems];
}

// Message de repli, écrit par le code : poli, sans date, sans pression. Il
// reprend les demandes restées ouvertes et, s'il y en a une, la contre-offre
// du moteur.
export function fallbackMessage({
  language,
  open,
  counter,
  priceOpen,
  questions,
  refused,
}: {
  language: Language;
  open: readonly Ask[];
  counter: CounterRange;
  priceOpen: boolean;
  questions: number;
  refused: boolean;
}): string {
  const priced = priceOpen && counter.low !== null && counter.high !== null;
  const conditions = open.filter((ask) => ask.id !== "prix");
  if (language === "en") {
    return [
      "Hello,",
      "",
      "Thank you for your reply.",
      ...(questions > 0 ? ["", "To answer your question: [to complete]"] : []),
      ...(refused
        ? ["", "I understand. If the budget or the terms can change, feel free to come back to me."]
        : [
            ...(priced ? ["", `For this project, my rate is ${pricePhrase("en", counter)}.`] : []),
            ...(conditions.length > 0 ? ["", "To move forward, could you confirm the following points:", ...conditions.map((ask) => `- ${ask.label}`)] : []),
          ]),
      "",
      "I remain available to discuss it.",
      "",
      "Best regards,",
    ].join("\n");
  }
  return [
    "Bonjour,",
    "",
    "Merci pour votre retour.",
    ...(questions > 0 ? ["", "Pour répondre à votre question : [à compléter]"] : []),
    ...(refused
      ? ["", "Je comprends. Si le budget ou les conditions peuvent évoluer, n'hésitez pas à revenir vers moi."]
      : [
          ...(priced ? ["", `Pour ce projet, mon tarif se situe ${pricePhrase("fr", counter)}.`] : []),
          ...(conditions.length > 0 ? ["", "Pour avancer, pourriez-vous me confirmer les points suivants :", ...conditions.map((ask) => `- ${ask.label}`)] : []),
        ]),
    "",
    "Je reste disponible pour en discuter.",
    "",
    "Belle journée,",
  ].join("\n");
}

// Mission #080 quater, A1 — la contre-offre insérée s'accorde avec le mot qui
// précède le marqueur, côté code : « une rémunération de {{CONTRE_OFFRE}} »
// donnait « de entre 1 000 € et 2 400 € », « se situe à {{…}} » donnait « à
// entre ». Le mot est remplacé avec la phrase. Renvoie aussi les phrases
// insérées : ce sont les seuls montants du message, tous du moteur.
export function insertPrice(draft: string, language: Language, counter: CounterRange): { text: string; phrases: string[] } {
  const phrases: string[] = [];
  const priced = counter.low !== null && counter.high !== null;
  const low = priced ? formatEur(counter.low as number, language) : "";
  const high = priced ? formatEur(counter.high as number, language) : "";
  const quote = language === "en" ? "a rate I will detail in my quote" : "un tarif que je vous détaille dans mon devis";
  const text = draft.replace(/(?:([\p{L}]+)'|([\p{L}]+)(\s+))?\{\{CONTRE_OFFRE\}\}/gu, (_all, elided: string | undefined, word: string | undefined, space: string | undefined) => {
    const previous = (elided ?? word ?? "").toLowerCase();
    const keep = elided ? `${elided}'` : word ? `${word}${space}` : "";
    let phrase: string;
    let replacement: string;
    if (language === "fr" && (previous === "de" || previous === "d")) {
      phrase = priced ? `de ${low} à ${high}` : `d'${quote}`;
      replacement = phrase;
    } else if (language === "fr" && previous === "à") {
      phrase = priced ? `entre ${low} et ${high}` : `à ${quote}`;
      replacement = phrase;
    } else if (language === "fr" && previous === "pour") {
      phrase = priced ? `pour un montant compris entre ${low} et ${high}` : `pour ${quote}`;
      replacement = phrase;
    } else if (language === "en" && previous === "at") {
      phrase = priced ? `between ${low} and ${high}` : `at ${quote}`;
      replacement = phrase;
    } else {
      phrase = pricePhrase(language, counter);
      replacement = `${keep}${phrase}`;
    }
    phrases.push(phrase);
    return replacement;
  });
  return { text, phrases };
}

// Toutes les formes que insertPrice peut écrire pour une contre-offre : les
// seuls montants autorisés dans un message de tour.
export function pricePhraseForms(language: Language, counter: CounterRange): string[] {
  return ["de", "à", "pour", "at", "x"].map((word) => insertPrice(`${word} {{CONTRE_OFFRE}}`, language, counter).phrases[0]);
}

// Brouillon du modèle contrôlé, puis contre-offre insérée à la place du
// marqueur. Contre-offre absente (plus rien à négocier sur le prix) : la
// phrase neutre du moteur (« un tarif que je vous détaille dans mon devis »).
export function finalMessage({
  draft,
  tone,
  deal,
  brandReply,
  language,
  counter,
  askLabels = [],
  unverifiedLabels = [],
  fallback,
}: {
  draft: string;
  tone: string;
  deal: Deal;
  brandReply: string;
  language: Language;
  counter: CounterRange;
  askLabels?: readonly string[];
  // Demandes dont la lecture a été écartée dans ce tour (mission #083, A2).
  unverifiedLabels?: readonly string[];
  fallback: () => string;
}): TurnMessage {
  const problems = messageProblems(draft, deal, brandReply, askLabels, unverifiedLabels);
  if (problems.length > 0) {
    return { text: fallback(), tone: TONES.firm, fallback: true, fallback_reasons: problems.map((p) => FALLBACK_REASON[p]) };
  }
  return { text: withGreeting(insertPrice(draft, language, counter).text.trim(), language), tone, fallback: false, fallback_reasons: [] };
}
