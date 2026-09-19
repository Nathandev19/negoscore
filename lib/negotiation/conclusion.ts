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
import type { Ask, Conclusion, Deal } from "@/lib/negotiation/types";

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
      .filter((ask) => ask.status === "unanswered")
      .map((ask) =>
        ask.aligned_group
          ? `« ${ask.label} » : le terme a changé dans ce sens, sans phrase explicite de la marque. Fais-le-lui confirmer par écrit.`
          : `Pas de réponse de la marque sur : ${ask.label}`,
      ),
    ...uncertainties.map((doubt) => `L'outil n'est pas sûr d'avoir bien lu : ${doubt}`),
  ].filter((point): point is string => point !== null);
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

export function conclusionMessage(
  deal: Deal,
  language: Language,
  granted: readonly string[] = [],
  counterAccepted: CounterRange | null = null,
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
  if (granted.length > 0) known.push({ label: language === "en" ? "Also agreed" : "Convenu en plus", value: granted.join(" ; ") });
  const questions = questionsForBrand(deal).map((q) =>
    counterAccepted && q === "le montant de la rémunération" ? "le montant exact retenu dans cette fourchette" : q,
  );
  if (language === "en") {
    return [
      "Hello,",
      "",
      "Thank you for your reply. To make sure we are aligned, here is what I have noted:",
      ...known.map((row) => `- ${row.label}: ${row.value}`),
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
    "Merci pour votre retour. Pour être sûrs d'être d'accord, voici ce que je retiens :",
    ...known.map((row) => `- ${row.label} : ${row.value}`),
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
}: {
  deal: Deal;
  asks: readonly Ask[];
  uncertainties?: readonly string[];
  language: Language;
  source: Conclusion["source"];
  counterAccepted?: CounterRange | null;
}): Conclusion {
  const counterRange = counterAccepted ? formatEurRange(counterAccepted.low, counterAccepted.high) : null;
  const deal: Deal = counterRange ? { ...read, payment: { ...read.payment, amount_eur: null } } : read;
  const recap = recapRows(deal).map((row) =>
    counterRange && row.label === "Rémunération"
      ? { ...row, value: `Ta contre-offre, ${counterRange} : la marque l'a acceptée sans écrire le montant exact` }
      : row,
  );
  // Demandes accordées par la marque (hors prix, déjà dans « Rémunération ») :
  // révisions, rushs, modalités… Tout ce qu'elle a accepté figure dans le
  // récapitulatif et dans le message, même ce que les termes suivis ne portent pas.
  const granted = asks.filter((ask) => ask.status === "granted" && ask.id !== "prix").map((ask) => ask.label);
  if (granted.length > 0) recap.push({ label: "Accordé par la marque", value: granted.join(" ; ") });
  const unclear = unclearPoints(deal, asks, uncertainties).map((point) =>
    counterRange && point.startsWith("Le montant de la rémunération")
      ? "Le montant exact convenu : la marque a accepté ta contre-offre sans l'écrire."
      : point,
  );
  return {
    source,
    recap,
    unclear,
    message: conclusionMessage(deal, language, granted, counterRange ? counterAccepted : null),
    // C4 — même règle et même texte que l'analyse : lib/legal/fr.ts, seul
    // endroit du projet où un énoncé juridique est écrit.
    legal_note: computeFrLegal(legalDeal(deal, counterRange ? counterAccepted : null)).note,
  };
}
