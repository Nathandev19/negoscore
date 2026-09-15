import rates from "@/lib/rates/fr-2026.1.json";
import type { Analysis } from "@/lib/schema";

// Chiffrage déterministe. Toutes les valeurs de tarif viennent de la table
// versionnée : ce fichier ne contient que des règles d'application.

type Deal = Analysis["deal"];
type Estimate = Analysis["estimate"];

export type Tier = "starter" | "confirmed" | "experienced";
export type Profile = { tier?: Tier };

// Sujet de négociation auquel une ligne se rattache. Sert à reporter
// l'impact en euros sur les points à négocier.
export type RateTopic =
  | "paid_ads"
  | "whitelisting"
  | "spark_ads"
  | "exclusivity"
  | "raw_footage"
  | "territory"
  | "extra_platform"
  | "ip_transfer"
  | "extra_hooks";

export type EstimateLine = Estimate["lines"][number] & { topic: RateTopic };
export type ComputedEstimate = Omit<Estimate, "lines"> & { lines: EstimateLine[] };

type MultiplierKey = keyof typeof rates.multipliers;

// Durée retenue quand la durée d'un droit n'est pas écrite.
const ASSUMED_MONTHS = 3;
// Plafond de mois facturés pour un droit mensuel accordé à vie.
const PERPETUAL_MONTHS_CAP = 12;
const MIN_FILLED_FIELDS = 3;

const PLATFORM_LABEL: Record<string, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  youtube: "YouTube",
  other: "autre plateforme",
};

export function isWorldwide(territory: string | null): boolean {
  return (
    territory !== null && /monde|world|international|global|tous (les )?(pays|territoires)/i.test(territory)
  );
}

// Nombre de champs du deal réellement renseignés (hors valeurs par défaut).
export function countFilledFields(deal: Deal): number {
  const filled = [
    deal.brand !== null,
    deal.deliverables.length > 0,
    deal.publication_required,
    deal.usage.organic || deal.usage.paid_ads || deal.usage.whitelisting || deal.usage.spark_ads,
    deal.usage.duration_months !== null || deal.usage.perpetual,
    deal.usage.territory !== null,
    deal.exclusivity.present,
    deal.raw_footage,
    deal.ip_transfer !== "none" && deal.ip_transfer !== "unclear",
    deal.ai_training_rights !== "absent",
    deal.revisions.unlimited || deal.revisions.count !== null,
    deal.payment.amount_eur !== null,
    deal.payment.terms_days !== null,
    deal.payment.schedule !== null,
    deal.in_kind_value_eur !== null,
    deal.deadlines.length > 0,
    deal.kill_fee !== null,
    deal.termination !== null,
    deal.governing_law !== null,
  ];
  return filled.filter(Boolean).length;
}

export const UPLIFT_CAPPED_ASSUMPTION =
  "Les suppléments demandés cumulés dépassent ce qu'un annonceur accepte en pratique : l'estimation a été plafonnée.";

// Au-delà de ce rapport entre borne basse estimée et montant proposé, l'écart
// est signalé comme inhabituel.
const PLAUSIBILITY_RATIO = 3;

export function isFarAboveOffer(amountEur: number | null, totalLow: number | null): boolean {
  return amountEur !== null && amountEur > 0 && totalLow !== null && totalLow > PLAUSIBILITY_RATIO * amountEur;
}

export function volumeDiscountFactor(weightedUnits: number): number {
  const tier = rates.volume_discount.tiers.find(
    (t) => t.max_weighted_units === null || weightedUnits <= t.max_weighted_units,
  );
  return tier?.factor ?? 1;
}

// Plafond « heavy » quand l'offre demande une utilisation à vie ou une cession totale.
export function upliftCap(deal: Deal): number {
  const heavy = deal.usage.perpetual || deal.ip_transfer === "full_assignment";
  return heavy ? rates.uplift_caps.heavy.max_cumulative_uplift : rates.uplift_caps.standard.max_cumulative_uplift;
}

function roundPercent(value: number): number {
  return Math.round(value * 1000) / 10;
}

export function computeEstimate(deal: Deal, profile: Profile = {}): ComputedEstimate {
  const assumptions: string[] = [];
  const tier: Tier = profile.tier ?? (rates.base_rates_eur.default_tier as Tier);
  if (!profile.tier) {
    assumptions.push("Profil de créateur « confirmé » supposé (portfolio existant, pas débutant).");
  }

  // Somme pondérée des livrables : une story ou une photo ne vaut pas une vidéo.
  // Le poids de chaque type vient de la table (vidéo = 1).
  let weightedUnits = deal.deliverables.reduce(
    (sum, d) => sum + d.quantity * rates.deliverable_weights[d.type].weight,
    0,
  );
  if (weightedUnits <= 0) {
    weightedUnits = rates.deliverable_weights.video.weight;
    assumptions.push("Nombre de vidéos non précisé : une seule vidéo supposée.");
  }
  if (deal.deliverables.some((d) => rates.deliverable_weights[d.type].confidence === "low")) {
    assumptions.push("Stories, photos et lives chiffrés avec un poids provisoire par rapport à une vidéo.");
  }

  // Dégressivité : un lot se négocie moins cher à l'unité.
  const discount = volumeDiscountFactor(weightedUnits);
  if (discount < 1) {
    assumptions.push("Tarif unitaire réduit pour tenir compte du volume de contenus demandés.");
  }

  const baseRate = rates.base_rates_eur[tier];
  const baseLow = Math.round(baseRate.low * weightedUnits * discount);
  const baseHigh = Math.round(baseRate.high * weightedUnits * discount);
  const lines: EstimateLine[] = [];

  // Majorations en pourcentage de la base, collectées puis plafonnées ensemble.
  const uplifts: Array<{ label: string; topic: RateTopic; low: number; high: number }> = [];
  function addMultiplier(key: MultiplierKey, topic: RateTopic, label: string, factor = 1) {
    const m = rates.multipliers[key];
    uplifts.push({ label, topic, low: m.low * factor, high: m.high * factor });
  }

  const { usage } = deal;

  if (usage.paid_ads) {
    if (usage.perpetual) {
      addMultiplier("paid_ads_perpetual", "paid_ads", "Droits pub à vie");
    } else {
      let months = usage.duration_months;
      if (months === null) {
        months = ASSUMED_MONTHS;
        assumptions.push(`Durée des droits pub non précisée : ${ASSUMED_MONTHS} mois supposés.`);
      }
      if (months > 12) {
        assumptions.push("Droits pub de plus de 12 mois chiffrés comme 12 mois : le vrai prix est plus haut.");
      }
      const key: MultiplierKey =
        months <= 1 ? "paid_ads_1m" : months <= 3 ? "paid_ads_3m" : months <= 6 ? "paid_ads_6m" : "paid_ads_12m";
      addMultiplier(key, "paid_ads", `Droits pub ${months} mois`);
    }
  }

  const monthlyRightMonths = usage.perpetual
    ? PERPETUAL_MONTHS_CAP
    : (usage.duration_months ?? ASSUMED_MONTHS);
  if ((usage.whitelisting || usage.spark_ads) && usage.duration_months === null) {
    assumptions.push(
      usage.perpetual
        ? `Whitelisting ou Spark Ads à vie chiffrés sur ${PERPETUAL_MONTHS_CAP} mois.`
        : `Durée du whitelisting ou des Spark Ads non précisée : ${ASSUMED_MONTHS} mois supposés.`,
    );
  }
  if (usage.whitelisting) {
    addMultiplier(
      "whitelisting_per_month",
      "whitelisting",
      `Whitelisting ${monthlyRightMonths} mois`,
      monthlyRightMonths,
    );
  }
  if (usage.spark_ads) {
    addMultiplier("spark_ads_per_month", "spark_ads", `Spark Ads ${monthlyRightMonths} mois`, monthlyRightMonths);
  }

  if (deal.exclusivity.present) {
    let months = deal.exclusivity.duration_months;
    if (months === null) {
      months = ASSUMED_MONTHS;
      assumptions.push(`Durée de l'exclusivité non précisée : ${ASSUMED_MONTHS} mois supposés.`);
    }
    const key: MultiplierKey = months <= 1 ? "exclusivity_1m" : months < 6 ? "exclusivity_3m" : "exclusivity_6m_plus";
    const category = deal.exclusivity.category ? ` ${deal.exclusivity.category}` : "";
    addMultiplier(key, "exclusivity", `Exclusivité${category} ${months} mois`);
  }

  if (deal.raw_footage) {
    addMultiplier("raw_footage", "raw_footage", "Raw footage");
  }

  if (isWorldwide(usage.territory)) {
    addMultiplier("territory_worldwide", "territory", "Diffusion dans le monde entier");
  } else if (usage.territory === null && (usage.paid_ads || usage.whitelisting || usage.spark_ads)) {
    assumptions.push("Territoire non précisé : diffusion en France supposée.");
  }

  const platforms = [...new Set(deal.deliverables.map((d) => d.platform).filter((p) => p !== null))];
  if (platforms.length > 1) {
    const extra = platforms.slice(1).map((p) => PLATFORM_LABEL[p] ?? p);
    addMultiplier(
      "extra_platform",
      "extra_platform",
      `Plateforme${extra.length > 1 ? "s" : ""} en plus (${extra.join(", ")})`,
      extra.length,
    );
  }

  if (deal.ip_transfer === "full_assignment") {
    addMultiplier("ip_full_assignment", "ip_transfer", "Cession totale des droits");
  }

  // Plafond de majoration cumulée. Quand la somme dépasse le plafond, chaque
  // ligne est réduite dans la même proportion : les lignes restent cohérentes
  // avec le total et l'impact de chaque point de négociation.
  const cap = upliftCap(deal);
  const sumLow = uplifts.reduce((sum, u) => sum + u.low, 0);
  const sumHigh = uplifts.reduce((sum, u) => sum + u.high, 0);
  const scaleLow = sumLow > cap ? cap / sumLow : 1;
  const scaleHigh = sumHigh > cap ? cap / sumHigh : 1;
  if (scaleLow < 1 || scaleHigh < 1) {
    assumptions.push(UPLIFT_CAPPED_ASSUMPTION);
  }
  for (const u of uplifts) {
    // Les deux bornes sont plafonnées séparément : le pourcentage appliqué à la
    // borne basse peut dépasser celui de la borne haute. L'affichage reste ordonné.
    const percentLow = roundPercent(u.low * scaleLow);
    const percentHigh = roundPercent(u.high * scaleHigh);
    lines.push({
      label: u.label,
      topic: u.topic,
      type: "percent",
      low: Math.min(percentLow, percentHigh),
      high: Math.max(percentLow, percentHigh),
      eur_low: Math.round(baseLow * u.low * scaleLow),
      eur_high: Math.round(baseHigh * u.high * scaleHigh),
    });
  }

  // Variantes d'accroche ou de CTA, lues dans le format des livrables
  // (« 3 hooks », « 2 accroches », « 2 variantes de CTA »).
  const hookCount = deal.deliverables.reduce((sum, d) => {
    const match = d.format?.match(/(\d+)\s*(hooks?|accroches?|cta|variantes?)/i);
    return sum + (match ? Number(match[1]) : 0);
  }, 0);
  if (hookCount > 0) {
    const flat = rates.flat_eur.extra_hook_or_cta;
    lines.push({
      label: `${hookCount} variante${hookCount > 1 ? "s" : ""} d'accroche ou de CTA`,
      topic: "extra_hooks",
      type: "flat",
      low: flat.low,
      high: flat.high,
      eur_low: flat.low * hookCount,
      eur_high: flat.high * hookCount,
    });
  }

  // Total sur les majorations exactes, pas sur les lignes arrondies à l'euro.
  const flatLow = lines.filter((l) => l.type === "flat").reduce((sum, l) => sum + l.eur_low, 0);
  const flatHigh = lines.filter((l) => l.type === "flat").reduce((sum, l) => sum + l.eur_high, 0);
  const grossLow = Math.round(baseLow * (1 + sumLow * scaleLow)) + flatLow;
  const grossHigh = Math.round(baseHigh * (1 + sumHigh * scaleHigh)) + flatHigh;

  let totalLow: number | null = Math.floor(grossLow / 10) * 10;
  let totalHigh: number | null = Math.ceil(grossHigh / 10) * 10;

  if (deal.payment.amount_eur === null) {
    totalLow = null;
    totalHigh = null;
    assumptions.push("Aucun montant proposé dans l'offre : pas de fourchette totale tant que la marque n'a pas donné de budget.");
  } else if (countFilledFields(deal) < MIN_FILLED_FIELDS) {
    totalLow = null;
    totalHigh = null;
    assumptions.push("Trop peu d'informations dans l'offre pour donner une fourchette totale fiable.");
  }

  // Contrôle de vraisemblance : l'écart est signalé, jamais corrigé. Un deal
  // peut réellement être très sous-payé.
  if (isFarAboveOffer(deal.payment.amount_eur, totalLow)) {
    assumptions.push(
      "L'estimation dépasse de plus de trois fois le montant proposé. Cet écart important peut venir d'une offre volontairement sous-évaluée, ou d'une information de l'offre mal comprise : vérifie les livrables et les droits demandés.",
    );
  }

  return {
    base_low: baseLow,
    base_high: baseHigh,
    lines,
    total_low: totalLow,
    total_high: totalHigh,
    assumptions,
    rate_table_version: rates.version,
  };
}
