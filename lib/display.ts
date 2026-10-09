import { formatEur } from "@/lib/money";
import { RAW_FOOTAGE_LABEL } from "@/lib/content/labels";
import { variablePayOf } from "@/lib/negotiation/commission";
import type { PriceCapReason } from "@/lib/rates/score";
import type { Analysis } from "@/lib/schema";

// Mise en forme pour l'affichage. Aucun calcul métier : on ne fait que
// traduire et formater ce que contient l'analyse.

type Deal = Analysis["deal"];
type Band = NonNullable<Analysis["score"]>["band"];
type Severity = Analysis["red_flags"][number]["severity"];

// Les montants passent par le formateur unique de lib/money.ts.
export { formatEur, formatEurRange } from "@/lib/money";

// Formateur unique des nombres qui ne sont pas des euros (mois, jours,
// révisions, quantités, pourcentages, tailles de fichier) : virgule décimale,
// séparateur de milliers insécable, y compris à quatre chiffres (« 1 070 » :
// le format fr-FR par défaut ne groupe pas les nombres de quatre chiffres).
// Aucun nombre affiché ne doit être converti autrement (test : tests/formats.test.tsx).
const NUMBER_FORMATS = new Map<number, Intl.NumberFormat>();

export function formatNumber(value: number, maximumFractionDigits = 1): string {
  let format = NUMBER_FORMATS.get(maximumFractionDigits);
  if (!format) {
    format = new Intl.NumberFormat("fr-FR", { maximumFractionDigits, useGrouping: "always" });
    NUMBER_FORMATS.set(maximumFractionDigits, format);
  }
  return format.format(value);
}

// Pourcentage à la française : « 63,6 % », espace insécable avant le signe.
export function formatPercent(value: number): string {
  return `${formatNumber(value)}\u00a0%`;
}

export const BAND_LABEL: Record<Band, string> = {
  bad: "Mauvais deal",
  weak: "Deal faible",
  fair: "Deal correct",
  good: "Bon deal",
  excellent: "Excellent deal",
};

// Couleurs des bandes de score : table unique, importée partout. Les bandes
// ne sont jamais du texte : ce sont des aplats, avec un niveau par fond réel
// (onMarque sur le bleu, onCreme sur la crème) et du texte encre dessus.
// Valeurs dans app/globals.css, contrastes vérifiés par tests/design.test.ts.
// Les bandes viennent de bandFor() dans lib/rates/score.ts.
export const BAND_STYLE: Record<Band, { onMarque: string; onCreme: string }> = {
  bad: { onMarque: "bg-band-bad-on-marque", onCreme: "bg-band-bad-on-creme" },
  weak: { onMarque: "bg-band-weak-on-marque", onCreme: "bg-band-weak-on-creme" },
  fair: { onMarque: "bg-band-fair-on-marque", onCreme: "bg-band-fair-on-creme" },
  good: { onMarque: "bg-band-good-on-marque", onCreme: "bg-band-good-on-creme" },
  excellent: { onMarque: "bg-band-excellent-on-marque", onCreme: "bg-band-excellent-on-creme" },
};

// Raison affichée près du score quand il est plafonné faute de quantité connue
// (lib/rates/score.ts, UNKNOWN_QUANTITY_SCORE_CAP).
export const QUANTITY_CAP_NOTE =
  "La marque ne dit pas combien de contenus elle veut : le chiffrage en compte un seul, la note ne peut donc pas dépasser « Deal correct ».";

// Raison affichée près du score quand il est plafonné par le prix proposé
// (lib/rates/score.ts, PRICE_CAPS, mission #050). Le pourcentage est celui de
// cette offre : cette phrase n'est jamais reprise sur la carte partageable ni
// sur l'image d'aperçu, qui ne disent rien du montant.
//
// Mission #109, B — le plafond mord désormais aussi pour un montant DANS la
// fourchette, où « X % du bas de la fourchette » dépasserait 100 % et ne
// voudrait plus rien dire. Elle nomme alors la position, et la bande
// qu'elle interdit, en reprenant les libellés affichés juste à côté.
export function priceCapNote(percent: number, reason: PriceCapReason = "ratio"): string {
  if (reason === "bottom") {
    return `Le montant proposé est dans le tiers bas de la fourchette : le verdict ne peut pas dépasser « ${BAND_LABEL.fair} ».`;
  }
  if (reason === "middle") {
    return `Le montant proposé est au milieu de la fourchette : le verdict ne peut pas dépasser « ${BAND_LABEL.good} ».`;
  }
  // Mission #176 — « Le score » nommait un nombre que la créatrice ne voit
  // plus. C est le RÉSULTAT affiché, donc « le verdict ».
  return `Le montant proposé représente ${percent} % du bas de la fourchette. Le verdict ne peut pas monter plus haut.`;
}

// Pastille de verdict quand l'offre n'a pas de score.
export const EVALUABILITY_LABEL: Record<Exclude<Analysis["evaluability"], "complete">, string> = {
  unpriced: "Offre à chiffrer",
  terms_unknown: "Offre à préciser",
  incomplete: "Informations insuffisantes",
};

export const CONFIDENCE_LABEL: Record<Analysis["confidence"], string> = {
  high: "Confiance élevée",
  medium: "Confiance moyenne",
  low: "Confiance faible",
};

export const SEVERITY_LABEL: Record<Severity, string> = {
  high: "Grave",
  medium: "À surveiller",
  low: "Mineur",
};

// Gravité d'un red flag : les deux niveaux de danger aux couleurs de bande
// (aplat sur crème, texte encre). « Mineur » n'est pas un danger mais une
// remarque : pastille atténuée (grise), texte crème.
export const SEVERITY_BADGE: Record<Severity, string> = {
  high: "bg-band-bad-on-creme text-encre",
  medium: "bg-band-weak-on-creme text-encre",
  low: "bg-attenue text-creme",
};

const DELIVERABLE_LABEL: Record<Deal["deliverables"][number]["type"], [string, string]> = {
  video: ["vidéo", "vidéos"],
  photo: ["photo", "photos"],
  story: ["story", "stories"],
  live: ["live", "lives"],
};

const PLATFORM_LABEL: Record<NonNullable<Deal["deliverables"][number]["platform"]>, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  youtube: "YouTube",
  other: "autre plateforme",
};

const IP_TRANSFER_LABEL: Record<Deal["ip_transfer"], string | null> = {
  none: null,
  license: "Licence d'utilisation",
  full_assignment: "Cession totale de tes droits",
  unclear: "Pas clair",
};

const AI_TRAINING_LABEL: Record<Deal["ai_training_rights"], string | null> = {
  absent: null,
  present: "Demandé",
  unclear: "Pas clair",
};

// Livrables en une ligne, sans le champ libre « format » : utilisé sur la carte
// partageable, qui ne doit porter aucun texte recopié de l'offre.
export function deliverablesLine(deal: Deal): string | null {
  if (deal.deliverables.length === 0) return null;
  return deal.deliverables
    .map((d) => {
      const [one, many] = DELIVERABLE_LABEL[d.type];
      const platform = d.platform && d.platform !== "other" ? ` ${PLATFORM_LABEL[d.platform]}` : "";
      // Nombre non précisé : le pluriel, sans chiffre inventé.
      return d.quantity === null ? `${capitalizeFirst(many)}${platform}, nombre non précisé` : `${formatNumber(d.quantity)} ${d.quantity > 1 ? many : one}${platform}`;
    })
    .join(" · ");
}

export type RecapRow = { label: string; value: string };

// Ne renvoie que les lignes qui ont une valeur : jamais de « non spécifié ».
// Mission #116 — la rémunération variable, telle qu'elle est écrite dans
// l'offre. Le taux sans son assiette ne veut rien dire : quand l'assiette
// manque, la ligne le DIT plutôt que de laisser croire que « 15 % » suffit.
function variablePayRow(pay: Deal["variable_pay"]): RecapRow | null {
  if (!pay.present && pay.rate_percent === null && pay.per_sale_eur === null) return null;
  const parts = [
    pay.rate_percent !== null ? `${formatNumber(pay.rate_percent)} %` : null,
    pay.rate_percent !== null ? (pay.base ? `sur ${pay.base}` : "assiette non précisée") : null,
    // Une commission PAR VENTE est un montant écrit dans l'offre, pas une
    // estimation de gains : on le montre tel quel, sans jamais le multiplier.
    pay.per_sale_eur !== null ? `${formatEur(pay.per_sale_eur)} par vente` : null,
    pay.attribution_days !== null ? `attribution ${formatNumber(pay.attribution_days)} jours` : "attribution non précisée",
    pay.payout ? `versement : ${pay.payout}` : "versement non précisé",
  ].filter(Boolean);
  return { label: "Commission", value: parts.join(", ") || "Oui, sans détail écrit" };
}

export function dealRecapRows(deal: Deal): RecapRow[] {
  const rows: Array<RecapRow | null> = [
    deal.brand ? { label: "Marque", value: deal.brand } : null,
    deal.deliverables.length > 0
      ? {
          label: "Livrables",
          value: deal.deliverables
            .map((d) => {
              const [one, many] = DELIVERABLE_LABEL[d.type];
              const parts = [d.quantity === null ? many : `${formatNumber(d.quantity)} ${d.quantity > 1 ? many : one}`];
              if (d.platform) parts.push(PLATFORM_LABEL[d.platform]);
              if (d.format) parts.push(`(${d.format})`);
              if (d.quantity === null) parts.push("(nombre non précisé)");
              return parts.join(" ");
            })
            .join(", "),
        }
      : null,
    deal.publication_required ? { label: "Publication sur ton compte", value: "Oui" } : null,
    usageRow(deal.usage),
    deal.usage.territory ? { label: "Territoire", value: deal.usage.territory } : null,
    deal.exclusivity.present
      ? {
          label: "Exclusivité",
          value: [
            deal.exclusivity.duration_months !== null ? `${formatNumber(deal.exclusivity.duration_months)} mois` : null,
            deal.exclusivity.category,
          ]
            .filter(Boolean)
            .join(", ") || "Oui",
        }
      : null,
    deal.raw_footage ? { label: RAW_FOOTAGE_LABEL, value: "Inclus" } : null,
    IP_TRANSFER_LABEL[deal.ip_transfer]
      ? { label: "Droits d'auteur", value: IP_TRANSFER_LABEL[deal.ip_transfer] ?? "" }
      : null,
    AI_TRAINING_LABEL[deal.ai_training_rights]
      ? { label: "Entraînement IA", value: AI_TRAINING_LABEL[deal.ai_training_rights] ?? "" }
      : null,
    deal.revisions.unlimited
      ? { label: "Révisions", value: "Illimitées" }
      : deal.revisions.count !== null
        ? { label: "Révisions", value: formatNumber(deal.revisions.count) }
        : null,
    deal.payment.amount_eur !== null
      ? { label: "Rémunération", value: formatEur(deal.payment.amount_eur) }
      : null,
    deal.payment.terms_days !== null
      ? { label: "Délai de paiement", value: `${formatNumber(deal.payment.terms_days)} jours` }
      : null,
    deal.payment.schedule ? { label: "Échéancier", value: deal.payment.schedule } : null,
    deal.in_kind_value_eur !== null
      ? { label: "Produits offerts", value: formatEur(deal.in_kind_value_eur) }
      : null,
    // Mission #116, A3 — ce que l'outil a LU de la commission. La créatrice
    // doit voir qu'il l'a vue. Aucun euro n'y est associé : ni gain estimé,
    // ni potentiel. Seulement ce que l'offre écrit, et « non précisé » pour
    // ce qu'elle n'écrit pas — c'est justement ce qu'il faut obtenir.
    variablePayRow(variablePayOf(deal)),
    deal.deadlines.length > 0 ? { label: "Échéances", value: deal.deadlines.join(", ") } : null,
    deal.kill_fee ? { label: "Indemnité d'annulation", value: deal.kill_fee } : null,
    deal.termination ? { label: "Résiliation", value: deal.termination } : null,
    deal.governing_law ? { label: "Droit applicable", value: deal.governing_law } : null,
  ];
  return rows
    .filter((row): row is RecapRow => row !== null)
    .map((row) => ({ ...row, value: capitalizeFirst(row.value) }));
}

// Uniformise la casse des valeurs du récap : le modèle écrit tantôt
// « pub payante », tantôt « Licence d'utilisation ». On ne touche qu'à
// l'affichage, jamais au contenu de l'analyse.
function capitalizeFirst(value: string): string {
  const first = value.charAt(0);
  return first === first.toUpperCase() ? value : first.toUpperCase() + value.slice(1);
}

function usageRow(usage: Deal["usage"]): RecapRow | null {
  const kinds = [
    usage.organic ? "organique" : null,
    usage.paid_ads ? "pub payante" : null,
    usage.whitelisting ? "whitelisting" : null,
    usage.spark_ads ? "Spark Ads" : null,
  ].filter(Boolean);
  if (kinds.length === 0) return null;
  const duration = usage.perpetual
    ? "à vie"
    : usage.duration_months !== null
      ? `${formatNumber(usage.duration_months)} mois`
      : null;
  const value = kinds.join(", ");
  return { label: "Utilisation", value: duration ? `${value} · ${duration}` : value };
}

export function sortByPriority<T extends { priority: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.priority - b.priority);
}
