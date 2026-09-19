import { normalizeDeal } from "@/lib/analysis/normalize";
import { deliverablesLine, formatEur, formatNumber } from "@/lib/display";
import type { Deal, TermGroup } from "@/lib/negotiation/types";

// Mission #080, B2 — les termes du deal d'un tour à l'autre, groupe par groupe.
// Un groupe n'est repris de la lecture du modèle que si la marque le change
// avec une citation exacte (lib/negotiation/turn.ts) ; tous les autres restent
// tels qu'ils étaient. Aucun terme ne bouge en silence.

// Recopie un groupe de termes de « next » dans « base ».
export function applyGroup(base: Deal, next: Deal, group: TermGroup): Deal {
  switch (group) {
    case "deliverables":
      return { ...base, deliverables: next.deliverables };
    case "amount":
      return { ...base, payment: { ...base.payment, amount_eur: next.payment.amount_eur, currency: next.payment.currency } };
    case "in_kind":
      return { ...base, in_kind_value_eur: next.in_kind_value_eur };
    case "usage_rights":
      return {
        ...base,
        usage: {
          ...base.usage,
          organic: next.usage.organic,
          paid_ads: next.usage.paid_ads,
          whitelisting: next.usage.whitelisting,
          spark_ads: next.usage.spark_ads,
        },
      };
    case "usage_duration":
      return { ...base, usage: { ...base.usage, duration_months: next.usage.duration_months, perpetual: next.usage.perpetual } };
    case "territory":
      return { ...base, usage: { ...base.usage, territory: next.usage.territory } };
    case "exclusivity":
      return { ...base, exclusivity: next.exclusivity };
    case "payment_terms":
      return { ...base, payment: { ...base.payment, terms_days: next.payment.terms_days, schedule: next.payment.schedule } };
    case "publication":
      return { ...base, publication_required: next.publication_required };
  }
}

export function applyGroups(base: Deal, next: Deal, groups: readonly TermGroup[]): Deal {
  return normalizeDeal(groups.reduce((deal, group) => applyGroup(deal, next, group), base));
}

const months = (n: number) => `${formatNumber(n)} mois`;

export function usageRightsLabel(deal: Deal): string {
  const rights = [
    deal.usage.organic ? "publication par la marque sur ses comptes" : null,
    deal.usage.paid_ads ? "publicité payante" : null,
    deal.usage.whitelisting ? "diffusion depuis ton compte (whitelisting)" : null,
    deal.usage.spark_ads ? "Spark Ads" : null,
  ].filter((right): right is string => right !== null);
  if (rights.length === 0) return "Aucun droit d'utilisation cité";
  const text = rights.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function usageDurationLabel(deal: Deal): string {
  if (deal.usage.perpetual) return "Sans limite de durée";
  return deal.usage.duration_months === null ? "Non précisée" : months(deal.usage.duration_months);
}

export function exclusivityLabel(deal: Deal): string {
  if (!deal.exclusivity.present) return "Aucune";
  const duration = deal.exclusivity.duration_months === null ? "durée non précisée" : months(deal.exclusivity.duration_months);
  return `Oui, ${duration}${deal.exclusivity.category ? ` (${deal.exclusivity.category})` : ""}`;
}

export function amountLabel(deal: Deal): string {
  if (deal.payment.amount_eur !== null) return formatEur(deal.payment.amount_eur);
  if (deal.payment.currency && deal.payment.currency !== "EUR") return `Montant en ${deal.payment.currency}, non converti`;
  return "Aucun montant écrit";
}

export function paymentTermsLabel(deal: Deal): string {
  const parts = [
    deal.payment.terms_days === null ? null : `à ${formatNumber(deal.payment.terms_days)} jours`,
    deal.payment.schedule,
  ].filter((part): part is string => part !== null && part !== "");
  if (parts.length === 0) return "Non précisé";
  const text = parts.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// Valeur lisible d'un groupe, pour « avant / maintenant » et le récapitulatif.
export function groupLabel(deal: Deal, group: TermGroup): string {
  switch (group) {
    case "deliverables":
      return deliverablesLine(deal) ?? "Non précisés";
    case "amount":
      return amountLabel(deal);
    case "in_kind":
      return deal.in_kind_value_eur === null ? "Aucune valeur écrite" : formatEur(deal.in_kind_value_eur);
    case "usage_rights":
      return usageRightsLabel(deal);
    case "usage_duration":
      return usageDurationLabel(deal);
    case "territory":
      return deal.usage.territory ?? "Non précisé";
    case "exclusivity":
      return exclusivityLabel(deal);
    case "payment_terms":
      return paymentTermsLabel(deal);
    case "publication":
      return deal.publication_required ? "Oui" : "Non demandée";
  }
}

export function hasUsageRights(deal: Deal): boolean {
  return deal.usage.organic || deal.usage.paid_ads || deal.usage.whitelisting || deal.usage.spark_ads;
}

// Montant confronté à la fourchette, comme le verdict (lib/analysis/verdict.ts) :
// l'argent proposé, sinon la valeur des produits offerts quand elle est écrite.
export type Offered = { value: number; kind: "money" | "products" } | null;

export function offeredOf(deal: Deal | null): Offered {
  if (!deal) return null;
  if (deal.payment.amount_eur !== null) return { value: deal.payment.amount_eur, kind: "money" };
  if (deal.in_kind_value_eur !== null) return { value: deal.in_kind_value_eur, kind: "products" };
  return null;
}
