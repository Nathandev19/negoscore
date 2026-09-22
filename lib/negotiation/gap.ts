import { formatEur } from "@/lib/money";
import type { Deal, Pricing, TermChange } from "@/lib/negotiation/types";

// Mission #095, défaut 1 — situer le montant proposé par la marque dans la
// fourchette du moteur.
//
// L'agent récitait sa fourchette sans jamais dire que 600 €, puis 900 €,
// étaient en dessous de 970 €. L'écart est calculé ICI, en TypeScript, à
// partir des sorties du moteur et du montant écrit par la marque. Le modèle
// n'écrit jamais ce nombre : il pose un emplacement, le code y met la phrase.

export const SITUATION_PLACEHOLDER = "{{SITUATION}}";

type Language = "fr" | "en";

export type AmountPosition = {
  kind: "below" | "inside" | "above";
  amount: number;
  low: number;
  high: number;
  // Distance à la borne franchie. 0 quand le montant est dans la fourchette.
  gap: number;
  // « firm » : la marque écrit un montant, et il est retenu dans les termes.
  // « ceiling » : elle annonce un plafond (« jusqu'à 900 € »). Un plafond n'est
  // pas un engagement — les termes ne le retiennent pas (mission #081) — mais
  // c'est bien ce qu'elle met sur la table : il doit être situé, et dit comme
  // un plafond.
  source: "firm" | "ceiling";
};

// Plafond annoncé par la marque, lu dans SON texte : le dernier montant qu'elle
// borne. Aucune interprétation, aucun modèle : une expression, un nombre.
const CEILING =
  /(?:jusqu'à|jusqu'a|au maximum(?: de)?|maximum de|au plus|pas plus de|up to|at most)\s+(\d[\d\s  .,]*)\s?(?:€|eur\b|euros?\b)/giu;

export function statedCeiling(brandReply: string): number | null {
  const matches = [...brandReply.matchAll(CEILING)];
  const last = matches.at(-1);
  if (!last) return null;
  const value = Number(last[1].replace(/[\s  .]/g, "").replace(",", "."));
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function positionOfAmount(
  amount: number | null,
  low: number | null,
  high: number | null,
  source: AmountPosition["source"] = "firm",
): AmountPosition | null {
  if (amount === null || low === null || high === null) return null;
  if (amount < low) return { kind: "below", amount, low, high, gap: low - amount, source };
  if (amount > high) return { kind: "above", amount, low, high, gap: amount - high, source };
  return { kind: "inside", amount, low, high, gap: 0, source };
}

// Les seules valeurs que le code a le droit d'écrire dans un message : les
// sorties du moteur, les montants LUS dans les termes, et les écarts entre
// les deux. Un nombre hors de cet ensemble ne vient pas d'un calcul, il vient
// d'ailleurs : la phrase est alors écrite sans lui.
export function allowedFigures(pricing: Pricing, deal: Deal, stated: number | null = null): Set<number> {
  const engine = [pricing.total_low, pricing.total_high, pricing.counter_low, pricing.counter_high];
  const read = [deal.payment.amount_eur, deal.in_kind_value_eur, stated];
  const values = [...engine, ...read].filter((value): value is number => value !== null);
  const allowed = new Set(values);
  for (const value of read.filter((v): v is number => v !== null)) {
    for (const bound of engine.filter((v): v is number => v !== null)) allowed.add(Math.abs(value - bound));
  }
  allowed.add(0);
  return allowed;
}

// La phrase qui situe le montant, écrite entièrement par le code : le sens
// (« en dessous », « dans », « au-dessus ») comme les nombres. Laisser le
// modèle écrire le sens, ce serait lui laisser écrire l'écart.
// null : l'un des nombres n'est pas une valeur autorisée — aucune phrase
// plutôt qu'un chiffre dont on ne sait pas d'où il sort.
export function situationSentence(position: AmountPosition, language: Language, allowed: ReadonlySet<number>): string | null {
  const figures = [position.amount, position.low, position.high, position.gap];
  if (figures.some((figure) => !allowed.has(figure))) return null;
  const amount = formatEur(position.amount, language);
  const low = formatEur(position.low, language);
  const high = formatEur(position.high, language);
  const gap = formatEur(position.gap, language);
  const ceiling = position.source === "ceiling";
  if (language === "en") {
    const subject = ceiling ? `The ceiling you mention, ${amount},` : `Your offer of ${amount}`;
    if (position.kind === "below") {
      return `${subject} is below the ${low} to ${high} range this project represents: it is short by ${gap}.`;
    }
    if (position.kind === "inside") {
      return `${subject} falls within the ${low} to ${high} range this project represents: I am happy to move forward on this basis.`;
    }
    return `${subject} is ${gap} above the top of the ${low} to ${high} range this project represents: I am happy to move forward on this basis.`;
  }
  const subject = ceiling ? `Le plafond que vous indiquez, ${amount},` : `Votre proposition de ${amount}`;
  if (position.kind === "below") {
    return `${subject} reste en dessous de la fourchette de ${low} à ${high} que représente ce projet : il manque ${gap}.`;
  }
  if (position.kind === "inside") {
    return `${subject} se situe dans la fourchette de ${low} à ${high} que représente ce projet : je vous propose de conclure sur cette base.`;
  }
  return `${subject} dépasse de ${gap} le haut de la fourchette de ${low} à ${high} que représente ce projet : je vous propose de conclure sur cette base.`;
}

// La situation du montant pour un tour donné : source unique, utilisée par le
// tour lui-même et par les contrôles qui le relisent. Le montant situé est
// celui que la marque ÉCRIT dans ce tour — un terme « amount » changé, citation
// vérifiée. Répéter un montant déjà connu n'est pas l'énoncer.
export function turnSituation(
  turn: { changes: readonly TermChange[]; deal_after: Deal; pricing: Pricing; pricing_unavailable: boolean; brandReply: string },
  language: Language,
): { position: AmountPosition | null; sentence: string | null } {
  // Un montant retenu dans les termes passe devant : c'est un engagement écrit.
  // À défaut, le plafond que la marque annonce dans CE message.
  const firm = turn.changes.some((change) => change.group === "amount") ? turn.deal_after.payment.amount_eur : null;
  const ceiling = firm === null ? statedCeiling(turn.brandReply) : null;
  const stated = firm ?? ceiling;
  const position = turn.pricing_unavailable
    ? null
    : positionOfAmount(stated, turn.pricing.total_low, turn.pricing.total_high, ceiling === null ? "firm" : "ceiling");
  const sentence = position === null ? null : situationSentence(position, language, allowedFigures(turn.pricing, turn.deal_after, stated));
  return { position, sentence };
}

// Insertion dans le brouillon : à l'emplacement posé par le modèle, sinon en
// paragraphe propre, juste avant la formule de politesse. La phrase est
// toujours présente quand la marque a énoncé un montant — c'est la règle.
export function insertSituation(text: string, sentence: string | null): string {
  const marker = text.includes(SITUATION_PLACEHOLDER);
  if (sentence === null) {
    // Aucun montant à situer : l'emplacement disparaît sans laisser de trou.
    return marker ? collapse(text.split(SITUATION_PLACEHOLDER).join("")) : text;
  }
  if (marker) return collapse(text.split(SITUATION_PLACEHOLDER).join(sentence));
  const paragraphs = text.split(/\n{2,}/).map((part) => part.trim()).filter((part) => part !== "");
  // La phrase passe après le dernier paragraphe qui dit quelque chose, donc
  // avant les formules de fin : elle n'atterrit jamais sous la signature.
  let at = paragraphs.length;
  while (at > 1 && CLOSING_LINE.test(paragraphs[at - 1])) at -= 1;
  paragraphs.splice(at, 0, sentence);
  return paragraphs.join("\n\n");
}

const CLOSING_LINE =
  /^(?:belle journée|bien à (?:vous|toi)|cordialement|bonne (?:journée|continuation)|merci (?:beaucoup|d'avance)|je reste (?:disponible|à votre disposition)|au plaisir|best regards|kind regards|regards|i remain available|looking forward|thanks)/i;

function collapse(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/[ \t]{2,}/g, " ").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
