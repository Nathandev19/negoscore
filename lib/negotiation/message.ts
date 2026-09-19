import type { CounterRange } from "@/lib/analysis/anchoring";
import { pricePhrase } from "@/lib/analysis/engine-parts";
import { PRICE_PLACEHOLDER } from "@/lib/llm/prompt";
import { normalizeForQuote, quoteIsIn } from "@/lib/negotiation/quotes";
import type { Ask, Deal, TurnMessage } from "@/lib/negotiation/types";

// Mission #080, F3 à F5 — le message suivant, contrôlé par le code avant d'être
// montré. Le brouillon du modèle est écarté, et remplacé par un message simple
// écrit ici, s'il contient :
//   - un montant (le seul montant autorisé est la contre-offre du moteur,
//     insérée par le code à la place de {{CONTRE_OFFRE}}) ;
//   - un nombre que le deal ne porte pas (quantité, durée, délai) ;
//   - une date, une échéance ou un ultimatum ;
//   - un mot sec ou agressif ;
//   - une citation que la marque n'a pas écrite.
// Les raisons de l'écart sont enregistrées et affichées.

type Language = "fr" | "en";

export const FALLBACK_REASON = {
  money: "un montant qui ne vient pas du chiffrage",
  number: "un nombre que le deal ne contient pas",
  deadline: "une date limite ou un ultimatum",
  tone: "une formulation trop sèche",
  quote: "une phrase prêtée à la marque qu'elle n'a pas écrite",
  empty: "un message vide",
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

export function messageProblems(draft: string, deal: Deal, brandReply: string, askLabels: readonly string[] = []): FallbackReason[] {
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
  for (const segment of quotedSegments(text)) if (!quoteIsIn(segment, brandReply)) problems.add("quote");
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
  fallback,
}: {
  draft: string;
  tone: string;
  deal: Deal;
  brandReply: string;
  language: Language;
  counter: CounterRange;
  askLabels?: readonly string[];
  fallback: () => string;
}): TurnMessage {
  const problems = messageProblems(draft, deal, brandReply, askLabels);
  if (problems.length > 0) {
    return { text: fallback(), tone: "Poli et ferme", fallback: true, fallback_reasons: problems.map((p) => FALLBACK_REASON[p]) };
  }
  return { text: draft.replaceAll(PRICE_PLACEHOLDER, pricePhrase(language, counter)).trim(), tone, fallback: false, fallback_reasons: [] };
}
