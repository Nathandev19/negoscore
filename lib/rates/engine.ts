import { isForeignCurrency } from "@/lib/analysis/normalize";
import { formatNumber } from "@/lib/display";
import { CURRENT_RATE_TABLE, type RateTable } from "@/lib/rates/tables";
import { RAW_FOOTAGE_LABEL } from "@/lib/content/labels";
import { DEFAULT_TIER, type Tier } from "@/lib/rates/tier";
import type { Analysis } from "@/lib/schema";

// Chiffrage déterministe. Toutes les valeurs de tarif viennent de la table
// versionnée : ce fichier ne contient que des règles d'application. La table
// est un paramètre (mission #085) : une analyse se recalcule avec la sienne.

type Deal = Analysis["deal"];
type Estimate = Analysis["estimate"];

export type { Tier };
// table : celle de l'analyse recalculée. Absente : la table actuelle (analyse
// nouvelle).
export type Profile = { tier?: Tier; table?: RateTable };

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

type MultiplierKey = keyof RateTable["multipliers"];

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

// Réécrit en mission #039 : c'est un argument de négociation, pas une réserve.
export const UPLIFT_CAPPED_ASSUMPTION =
  "La marque demande tant de droits qu'additionnés, ils dépasseraient ce qui se paie en pratique : l'estimation s'arrête à ce plafond. Elle est donc prudente, et c'est un argument pour négocier.";

// Contrôle de vraisemblance (mission #039) : le constat d'abord, la vérification
// ensuite. Le doute porte sur la lecture de l'offre par l'outil, pas sur la
// personne, et le texte reste vrai quand l'offre a été correctement lue.
export const PLAUSIBILITY_ASSUMPTION =
  "Le montant proposé fait moins du tiers du bas de notre fourchette. Un écart pareil est rare : soit l'offre est vraiment très en dessous des prix, soit notre lecture s'est trompée sur un contenu ou un droit. Vérifie dans « Le deal proposé » que les contenus et les droits sont bien ceux de l'offre.";

// Textes écrits par le moteur avant la mission #039, encore présents dans les
// analyses enregistrées. Le recalcul par niveau les reconnaît comme venant du
// moteur (lib/analysis/recompute.ts).
export const LEGACY_ENGINE_ASSUMPTIONS: readonly string[] = [
  "Profil de créateur « confirmé » supposé (portfolio existant, pas débutant).",
  "Les suppléments demandés cumulés dépassent ce qu'un annonceur accepte en pratique : l'estimation a été plafonnée.",
  "L'estimation dépasse de plus de trois fois le montant proposé. Cet écart important peut venir d'une offre volontairement sous-évaluée, ou d'une information de l'offre mal comprise : vérifie les livrables et les droits demandés.",
];

// Offre chiffrée dans une autre devise que l'euro : la fourchette reste
// calculée, mais le montant n'y est pas confronté (mission #058).
export const FOREIGN_CURRENCY_ASSUMPTION =
  "Le montant de cette offre n'est pas en euros : il n'est pas comparé à la fourchette, qui est en euros. Convertis-le au cours du jour avant de te décider, et demande dans quelle devise tu seras payée.";

// Au-delà de ce rapport entre borne basse estimée et montant proposé, l'écart
// est signalé comme inhabituel.
const PLAUSIBILITY_RATIO = 3;

export function isFarAboveOffer(amountEur: number | null, totalLow: number | null): boolean {
  return amountEur !== null && amountEur > 0 && totalLow !== null && totalLow > PLAUSIBILITY_RATIO * amountEur;
}

// Unités facturées en fonction des unités pondérées : fonction affine par
// morceaux, continue et croissante, entre les ancres de la table, puis pente
// fixe au-delà de la dernière. Un livrable de plus ne fait donc jamais baisser
// le prix (les anciens paliers faisaient payer 9 unités moins cher que 8).
export function billableUnits(weightedUnits: number, rates: RateTable = CURRENT_RATE_TABLE): number {
  if (weightedUnits <= 0) return 0;
  const { anchors, marginal_factor_beyond_last_anchor: beyond } = rates.volume_discount;
  for (let i = 1; i < anchors.length; i++) {
    const from = anchors[i - 1];
    const to = anchors[i];
    if (weightedUnits <= to.weighted_units) {
      const slope = (to.billable_units - from.billable_units) / (to.weighted_units - from.weighted_units);
      return from.billable_units + slope * (weightedUnits - from.weighted_units);
    }
  }
  const last = anchors[anchors.length - 1];
  return last.billable_units + beyond * (weightedUnits - last.weighted_units);
}

// Facteur moyen appliqué au volume : sert à annoncer la dégressivité.
export function volumeDiscountFactor(weightedUnits: number, rates: RateTable = CURRENT_RATE_TABLE): number {
  return weightedUnits > 0 ? billableUnits(weightedUnits, rates) / weightedUnits : 1;
}

// Plafond « heavy » quand l'offre demande une utilisation à vie ou une cession totale.
export function upliftCap(deal: Deal, rates: RateTable = CURRENT_RATE_TABLE): number {
  const heavy = deal.usage.perpetual || deal.ip_transfer === "full_assignment";
  return heavy ? rates.uplift_caps.heavy.max_cumulative_uplift : rates.uplift_caps.standard.max_cumulative_uplift;
}

function roundPercent(value: number): number {
  return Math.round(value * 1000) / 10;
}

// Hypothèse posée pour un livrable dont la marque ne dit pas combien elle en veut.
export const UNKNOWN_QUANTITY_ASSUMPTION: Record<Deal["deliverables"][number]["type"], string> = {
  video: "Nombre de vidéos non précisé : une seule vidéo supposée.",
  photo: "Nombre de photos non précisé : une seule photo supposée.",
  story: "Nombre de stories non précisé : une seule story supposée.",
  live: "Nombre de lives non précisé : un seul live supposé.",
};

// Mission #104, A1 — répartition à plus fort reste. La somme des valeurs
// rendues vaut exactement l'arrondi de la somme des valeurs exactes : aucun
// euro n'apparaît ni ne disparaît entre les lignes et le total. Arrondir la
// SOMME (et non chaque terme) garde aussi la monotonie du moteur : une
// contrainte de plus ne peut pas faire baisser le total.
export function apportion(values: readonly number[]): number[] {
  // Somme de flottants : deux chemins de calcul qui valent tous deux 712,5
  // peuvent donner 712,499999999 et 712,500000001, donc deux euros différents
  // — et un total qui baisse quand une contrainte s'ajoute. On stabilise à la
  // sixième décimale avant d'arrondir.
  const exact = values.reduce((sum, value) => sum + value, 0);
  const target = Math.round(Number(exact.toFixed(6)));
  const floors = values.map((value) => Math.floor(value));
  let left = target - floors.reduce((sum, value) => sum + value, 0);
  const byFraction = values
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  const out = [...floors];
  for (const { index } of byFraction) {
    if (left <= 0) break;
    out[index] += 1;
    left -= 1;
  }
  return out;
}

export function computeEstimate(deal: Deal, profile: Profile = {}): ComputedEstimate {
  const assumptions: string[] = [];
  // Le niveau est un choix affiché sur la page de résultat, pas une hypothèse.
  const tier: Tier = profile.tier ?? DEFAULT_TIER;
  const rates = profile.table ?? CURRENT_RATE_TABLE;

  // Somme pondérée des livrables : une story ou une photo ne vaut pas une vidéo.
  // Le poids de chaque type vient de la table (vidéo = 1).
  // Quantité non précisée (null) : un contenu de ce type est supposé, et dit.
  let weightedUnits = deal.deliverables.reduce(
    (sum, d) => sum + (d.quantity ?? 1) * rates.deliverable_weights[d.type].weight,
    0,
  );
  for (const type of new Set(deal.deliverables.filter((d) => d.quantity === null).map((d) => d.type))) {
    assumptions.push(UNKNOWN_QUANTITY_ASSUMPTION[type]);
  }
  if (weightedUnits <= 0) {
    weightedUnits = rates.deliverable_weights.video.weight;
    assumptions.push("Nombre de vidéos non précisé : une seule vidéo supposée.");
  }
  if (deal.deliverables.some((d) => rates.deliverable_weights[d.type].confidence === "low")) {
    assumptions.push("Stories, photos et lives chiffrés avec un poids provisoire par rapport à une vidéo.");
  }

  // Dégressivité : un lot se négocie moins cher à l'unité.
  const billed = billableUnits(weightedUnits, rates);
  if (volumeDiscountFactor(weightedUnits, rates) < 1) {
    assumptions.push("Tarif unitaire réduit pour tenir compte du volume de contenus demandés.");
  }

  const baseRate = rates.base_rates_eur[tier];
  const baseLow = Math.round(baseRate.low * billed);
  const baseHigh = Math.round(baseRate.high * billed);
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
      addMultiplier(key, "paid_ads", `Droits pub ${formatNumber(months)} mois`);
    }
  }

  // À vie : au moins 12 mois, et jamais moins que la durée écrite, pour qu'un
  // droit à vie ne coûte jamais moins cher que le même droit à durée fixe.
  const monthlyRightMonths = usage.perpetual
    ? Math.max(PERPETUAL_MONTHS_CAP, usage.duration_months ?? 0)
    : (usage.duration_months ?? ASSUMED_MONTHS);
  if ((usage.whitelisting || usage.spark_ads) && (usage.perpetual || usage.duration_months === null)) {
    assumptions.push(
      usage.perpetual
        ? `Whitelisting ou Spark Ads à vie chiffrés sur ${formatNumber(monthlyRightMonths)} mois.`
        : `Durée du whitelisting ou des Spark Ads non précisée : ${ASSUMED_MONTHS} mois supposés.`,
    );
  }
  if (usage.whitelisting) {
    addMultiplier(
      "whitelisting_per_month",
      "whitelisting",
      `Whitelisting ${formatNumber(monthlyRightMonths)} mois`,
      monthlyRightMonths,
    );
  }
  if (usage.spark_ads) {
    addMultiplier("spark_ads_per_month", "spark_ads", `Spark Ads ${formatNumber(monthlyRightMonths)} mois`, monthlyRightMonths);
  }

  if (deal.exclusivity.present) {
    let months = deal.exclusivity.duration_months;
    if (months === null) {
      months = ASSUMED_MONTHS;
      assumptions.push(`Durée de l'exclusivité non précisée : ${ASSUMED_MONTHS} mois supposés.`);
    }
    const key: MultiplierKey = months <= 1 ? "exclusivity_1m" : months < 6 ? "exclusivity_3m" : "exclusivity_6m_plus";
    // Libellé court, sans la catégorie : écrite librement dans l'offre, elle peut
    // être longue (« compléments alimentaires ») et faire passer la ligne sur deux
    // lignes à 320 px. Elle reste affichée dans « Le deal proposé ».
    addMultiplier(key, "exclusivity", `Exclusivité ${formatNumber(months)} mois`);
  }

  if (deal.raw_footage) {
    addMultiplier("raw_footage", "raw_footage", RAW_FOOTAGE_LABEL);
  }

  if (isWorldwide(usage.territory)) {
    addMultiplier("territory_worldwide", "territory", "Diffusion mondiale");
  } else if (usage.territory === null && (usage.paid_ads || usage.whitelisting || usage.spark_ads)) {
    assumptions.push("Territoire non précisé : diffusion en France supposée.");
  }

  const platforms = [...new Set(deal.deliverables.map((d) => d.platform).filter((p) => p !== null))];
  if (platforms.length > 1) {
    const extra = platforms.slice(1).map((p) => PLATFORM_LABEL[p] ?? p);
    addMultiplier(
      "extra_platform",
      "extra_platform",
      `Aussi sur ${extra.join(", ")}`,
      extra.length,
    );
  }

  if (deal.ip_transfer === "full_assignment") {
    addMultiplier("ip_full_assignment", "ip_transfer", "Cession totale des droits");
  }

  // Plafond de majoration cumulée. Quand la somme dépasse le plafond, chaque
  // ligne est réduite dans la même proportion : les lignes restent cohérentes
  // avec le total et l'impact de chaque point de négociation.
  const cap = upliftCap(deal, rates);
  const sumLow = uplifts.reduce((sum, u) => sum + u.low, 0);
  const sumHigh = uplifts.reduce((sum, u) => sum + u.high, 0);
  const scaleLow = sumLow > cap ? cap / sumLow : 1;
  const scaleHigh = sumHigh > cap ? cap / sumHigh : 1;
  if (scaleLow < 1 || scaleHigh < 1) {
    assumptions.push(UPLIFT_CAPPED_ASSUMPTION);
  }
  // Mission #104, A1 — les euros de chaque majoration, répartis pour que leur
  // somme vaille EXACTEMENT le total affiché. Arrondir chaque ligne de son
  // côté ferait perdre ou gagner quelques euros à l'addition ; arrondir le
  // total de son côté la ferait tomber faux. Chaque ligne reçoit donc sa part
  // entière, puis les euros restants vont aux plus grandes fractions.
  const exactLow = uplifts.map((u) => baseLow * u.low * scaleLow);
  const exactHigh = uplifts.map((u) => baseHigh * u.high * scaleHigh);
  const eurLow = apportion(exactLow);
  const eurHigh = apportion(exactHigh);
  uplifts.forEach((u, index) => {
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
      eur_low: eurLow[index],
      eur_high: eurHigh[index],
    });
  });

  // Variantes d'accroche ou de CTA, lues dans le format des livrables
  // (« 3 hooks », « 2 accroches », « 2 variantes de CTA »).
  const hookCount = deal.deliverables.reduce((sum, d) => {
    const match = d.format?.match(/(\d+)\s*(hooks?|accroches?|cta|variantes?)/i);
    return sum + (match ? Number(match[1]) : 0);
  }, 0);
  if (hookCount > 0) {
    const flat = rates.flat_eur.extra_hook_or_cta;
    lines.push({
      label: `${formatNumber(hookCount)} accroche${hookCount > 1 ? "s" : ""} ou CTA`,
      topic: "extra_hooks",
      type: "flat",
      low: flat.low,
      high: flat.high,
      eur_low: flat.low * hookCount,
      eur_high: flat.high * hookCount,
    });
  }

  // Mission #104, A1 — le total est la SOMME DES LIGNES AFFICHÉES, à l'euro
  // près, en bas comme en haut de fourchette.
  //
  // Avant : chaque ligne était arrondie à l'euro, le total était calculé sur
  // les majorations exactes puis descendu (bas) ou monté (haut) au multiple de
  // 10 le plus proche. L'addition affichée ne tombait donc pas juste :
  // 180 + 216 donnait 400 à l'écran, 340+170+102+119+34 donnait 760. Une
  // fourchette ronde ne vaut pas une addition fausse : quelqu'un qui refait le
  // calcul doit retrouver le chiffre.
  //
  // Le plafond de majoration, lui, est déjà réparti sur chaque ligne
  // (scaleLow / scaleHigh ci-dessus) : il n'a pas à figurer en ligne séparée,
  // et une ligne négative ferait compter sa réduction deux fois.
  let totalLow: number | null = baseLow + lines.reduce((sum, line) => sum + line.eur_low, 0);
  let totalHigh: number | null = baseHigh + lines.reduce((sum, line) => sum + line.eur_high, 0);

  // Sans montant proposé, la fourchette reste calculée : c'est quand la marque
  // ne donne pas de budget que le créateur a le plus besoin d'un chiffre.
  if (countFilledFields(deal) < MIN_FILLED_FIELDS) {
    totalLow = null;
    totalHigh = null;
    assumptions.push("Trop peu d'informations dans l'offre pour donner une fourchette totale fiable.");
  }

  // Montant proposé dans une autre devise que l'euro (mission #058) : il n'est
  // pas comparé à la fourchette, et on dit pourquoi. Le montant lui-même a déjà
  // été mis de côté par normalizeDeal ; la devise, elle, reste dans le deal.
  if (isForeignCurrency(deal.payment.currency)) {
    assumptions.push(FOREIGN_CURRENCY_ASSUMPTION);
  }

  // Contrôle de vraisemblance : l'écart est signalé, jamais corrigé. Un deal
  // peut réellement être très sous-payé.
  if (isFarAboveOffer(deal.payment.amount_eur, totalLow)) {
    assumptions.push(PLAUSIBILITY_ASSUMPTION);
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
