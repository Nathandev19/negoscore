import type { CounterRange } from "@/lib/analysis/anchoring";
import { pricePhrase } from "@/lib/analysis/engine-parts";
import { formatEur } from "@/lib/money";
import { conclusionMessage, recapRows } from "@/lib/negotiation/conclusion";
import { positionOfAmount, type AmountPosition } from "@/lib/negotiation/gap";
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

type Language = "fr" | "en";

export function buildClosing({
  deal,
  asks,
  points,
  language,
  counter,
  pricing,
  position,
  situation,
}: {
  deal: Deal;
  asks: readonly Ask[];
  points: readonly PointState[];
  language: Language;
  counter: CounterRange;
  pricing: Pricing;
  // Situation du montant proposé dans la fourchette, quand elle est connue.
  position: AmountPosition | null;
  // La phrase qui la dit, écrite par le code (lib/negotiation/gap.ts).
  situation: string | null;
}): Closing {
  const granted = asks.filter((ask) => ask.status === "granted" && ask.id !== "prix").map((ask) => ask.label);
  const refusedAmount = points.some((point) => point.key === "amount" && point.status === "refused");
  return {
    recap: recapRows(deal),
    // Ce qui a refermé chaque point : la phrase de la marque, mot pour mot.
    settled: points.map((point) => ({ label: POINT_LABEL[point.key], value: point.quote ?? "" })),
    accept: {
      // Ce qu'elle accepterait, c'est le montant RETENU dans les termes : son
      // écart se calcule sur lui, pas sur un plafond que la marque a seulement
      // annoncé et que les termes n'ont pas gardé.
      implies: acceptImplies(deal, positionOfAmount(deal.payment.amount_eur, pricing.total_low, pricing.total_high), language),
      text: conclusionMessage(deal, language, granted),
    },
    hold: {
      implies: holdImplies(refusedAmount, language),
      // Tenir le prix en disant l'écart : la phrase n'a de sens que si le
      // montant est en dessous de la fourchette.
      text: holdMessage(language, counter, position?.kind === "below" ? situation : null),
    },
  };
}

// Ce qu'implique l'envoi du message qui accepte : le montant retenu, et son
// écart avec la fourchette. Les deux chiffres viennent du moteur et des termes
// lus, jamais du modèle.
function acceptImplies(deal: Deal, position: AmountPosition | null, language: Language): string {
  const amount = amountLabel(deal);
  if (language === "en") {
    const gap =
      position === null
        ? ""
        : position.kind === "below"
          ? ` That is ${formatEur(position.gap, "en")} below the bottom of the estimated range.`
          : " That is within the estimated range for this project.";
    return `Sending this message accepts the terms above. The fee is: ${amount}.${gap} Nothing is decided until you send it.`;
  }
  const gap =
    position === null
      ? ""
      : position.kind === "below"
        ? ` C'est ${formatEur(position.gap)} sous le bas de la fourchette estimée pour ce projet.`
        : " C'est dans la fourchette estimée pour ce projet.";
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
