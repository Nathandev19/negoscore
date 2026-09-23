import type { CounterRange } from "@/lib/analysis/anchoring";
import { pricePhrase } from "@/lib/analysis/engine-parts";
import { formatEur } from "@/lib/money";
import { conclusionMessage, recapRows } from "@/lib/negotiation/conclusion";
import { allowedFigures, positionOfAmount, type AmountPosition } from "@/lib/negotiation/gap";
import { POINT_LABEL } from "@/lib/negotiation/points";
import { amountLabel } from "@/lib/negotiation/terms";
import type { Ask, Closing, Deal, PointState, Pricing } from "@/lib/negotiation/types";

// Mission #095, défaut 3 — la négociation doit pouvoir s'arrêter.
//
// Quand tous les points suivis sont refermés et qu'un montant est sur la
// table, l'agent n'ouvre plus de question : il montre l'état final du deal et
// donne les DEUX messages prêts à envoyer — celui qui accepte, celui qui tient
// le prix — en disant ce que chacun implique. Il ne choisit pas à sa place :
// c'est elle qui envoie l'un ou l'autre.
//
// Mission #096, défaut 1 — le message qui accepte ne doit jamais valoir MOINS
// que ce que la marque a proposé. « Je peux aller jusqu'à 900 € » n'est pas un
// terme convenu (règle #081, et l'état du deal ne bouge pas) ; c'est pourtant
// ce que la marque met sur la table. Accepter en récapitulant les 600 € du
// tour précédent ferait perdre 300 € à la créatrice. Le montant porté par
// l'acceptation est donc le plus élevé des deux, dit pour ce qu'il est : une
// proposition de la marque, à faire confirmer par écrit.

type Language = "fr" | "en";

// Le montant que porte l'acceptation, quand il ne vient pas des termes.
// null : le montant retenu dans les termes fait foi (plafond plus bas, égal,
// ou absent). Un chiffre qui ne fait pas partie des valeurs autorisées n'est
// jamais repris : dans le doute, on garde les termes.
export function offeredAmount(deal: Deal, ceiling: number | null, pricing: Pricing): number | null {
  if (ceiling === null || !Number.isFinite(ceiling) || ceiling <= 0) return null;
  const retained = deal.payment.amount_eur;
  if (retained !== null && ceiling <= retained) return null;
  // Le plafond est un nombre LU mot pour mot dans le message de la marque
  // (statedCeiling) : c'est à ce titre qu'il rejoint les valeurs autorisées,
  // au même rang qu'un montant retenu dans les termes. Un nombre qui n'y
  // figure pas n'est jamais écrit.
  return allowedFigures(pricing, deal, ceiling).has(ceiling) ? ceiling : null;
}

export function buildClosing({
  deal,
  asks,
  points,
  language,
  counter,
  pricing,
  ceiling,
  position,
  situation,
}: {
  deal: Deal;
  asks: readonly Ask[];
  points: readonly PointState[];
  language: Language;
  counter: CounterRange;
  pricing: Pricing;
  // Plafond annoncé par la marque qui fait foi à ce tour (le plus récent).
  ceiling: number | null;
  // Situation du montant proposé dans la fourchette, quand elle est connue.
  position: AmountPosition | null;
  // La phrase qui la dit, écrite par le code (lib/negotiation/gap.ts).
  situation: string | null;
}): Closing {
  const granted = asks.filter((ask) => ask.status === "granted" && ask.id !== "prix").map((ask) => ask.label);
  // Mission #098 — la marque a répondu sur la rémunération ET dit qu'elle n'ira
  // pas plus loin : « répondu » avec le drapeau « ferme », ou « refusé » quand
  // elle n'a rien donné du tout. Les deux ferment la discussion sur le prix.
  const refusedAmount = points.some((point) => point.key === "amount" && (point.status === "refused" || point.firm));
  const offered = offeredAmount(deal, ceiling, pricing);
  // Les termes ne bougent pas : seul ce que l'acceptation PORTE change.
  const accepted = offered === null ? deal : { ...deal, payment: { ...deal.payment, amount_eur: offered } };
  const acceptPosition = positionOfAmount(accepted.payment.amount_eur, pricing.total_low, pricing.total_high);
  const figures = allowedFigures(pricing, deal, offered);
  return {
    recap: recapRows(accepted).map((row) =>
      offered !== null && row.label === "Rémunération" ? { ...row, value: proposedValue(row.value, language) } : row,
    ),
    // Ce qui a refermé chaque point : la phrase de la marque, mot pour mot.
    settled: points.map((point) => ({ label: POINT_LABEL[point.key], value: point.quote ?? "" })),
    accept: {
      implies: acceptImplies(accepted, offered, acceptPosition, figures, language),
      text: conclusionMessage(accepted, language, granted, null, { offered, points, dealRead: deal }),
      offered,
    },
    hold: {
      implies: holdImplies(refusedAmount, language),
      // Tenir le prix en disant l'écart : la phrase n'a de sens que si le
      // montant est en dessous de la fourchette.
      text: holdMessage(language, counter, position?.kind === "below" ? situation : null),
    },
  };
}

// La ligne « Rémunération » du récapitulatif, quand elle porte le montant que
// la marque propose : l'écran ne le donne jamais pour acquis.
function proposedValue(value: string, language: Language): string {
  return language === "en"
    ? `${value} — the amount the brand offers, still to be confirmed in writing`
    : `${value} — le montant que la marque propose, encore à confirmer par écrit`;
}

// Ce qu'implique l'envoi du message qui accepte : le montant retenu, et son
// écart avec la fourchette. Les deux chiffres viennent du moteur et des termes
// lus, jamais du modèle ; un chiffre hors des valeurs autorisées n'est pas
// écrit du tout.
function acceptImplies(
  deal: Deal,
  offered: number | null,
  position: AmountPosition | null,
  allowed: ReadonlySet<number>,
  language: Language,
): string {
  const amount = amountLabel(deal);
  const written = position !== null && allowed.has(position.gap) ? position : null;
  if (language === "en") {
    const gap =
      written === null
        ? ""
        : written.kind === "below"
          ? ` That is ${formatEur(written.gap, "en")} below the bottom of the estimated range.`
          : " That is within the estimated range for this project.";
    if (offered !== null) {
      return `Sending this message accepts the terms above. It carries ${amount}: the amount the brand offers, and the message asks it to confirm in writing.${gap} Nothing is decided until you send it.`;
    }
    return `Sending this message accepts the terms above. The fee is: ${amount}.${gap} Nothing is decided until you send it.`;
  }
  const gap =
    written === null
      ? ""
      : written.kind === "below"
        ? ` C'est ${formatEur(written.gap)} sous le bas de la fourchette estimée pour ce projet.`
        : " C'est dans la fourchette estimée pour ce projet.";
  if (offered !== null) {
    return `En envoyant ce message, tu acceptes les termes ci-dessus. Il porte ${amount} : c'est le montant que la marque propose, et le message lui en demande confirmation par écrit.${gap} Rien n'est décidé tant que tu ne l'as pas envoyé.`;
  }
  return `En envoyant ce message, tu acceptes les termes ci-dessus. La rémunération retenue est : ${amount}.${gap} Rien n'est décidé tant que tu ne l'as pas envoyé.`;
}

function holdImplies(refusedAmount: boolean, language: Language): string {
  if (language === "en") {
    return refusedAmount
      ? "Sending this message holds your rate. The brand has written that this is its maximum: it may stand by that, come back with another offer, or stop there. Nothing already agreed is lost."
      : "Sending this message holds your rate. The brand may accept, come back with another offer, or stop there. Nothing already agreed is lost.";
  }
  return refusedAmount
    ? "En envoyant ce message, tu maintiens ton tarif. La marque a écrit que c'était son maximum : elle peut s'y tenir, revenir avec une autre proposition, ou arrêter là. Rien de ce qui est déjà convenu n'est perdu."
    : "En envoyant ce message, tu maintiens ton tarif. La marque peut accepter, revenir avec une autre proposition, ou arrêter là. Rien de ce qui est déjà convenu n'est perdu.";
}

// Message qui tient le prix : aucune question, aucune date, aucune menace. Il
// dit l'écart (phrase écrite par le code), puis le tarif (chiffres du moteur),
// et laisse la marque décider.
function holdMessage(language: Language, counter: CounterRange, situation: string | null): string {
  const priced = counter.low !== null && counter.high !== null;
  const en = language === "en";
  return [
    en ? "Hello," : "Bonjour,",
    "",
    en ? "Thank you for your reply and for these details." : "Merci pour votre retour et pour ces précisions.",
    ...(situation ? ["", situation] : []),
    ...(priced
      ? ["", en ? `For this project, my rate is ${pricePhrase("en", counter)}.` : `Pour ce projet, mon tarif se situe ${pricePhrase("fr", counter)}.`]
      : []),
    "",
    en ? "If that is not possible on your side, just let me know." : "Si ce n'est pas possible de votre côté, dites-le-moi simplement.",
    "",
    en ? "Best regards," : "Belle journée,",
  ].join("\n");
}
