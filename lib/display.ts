import { formatEur } from "@/lib/money";
import type { Analysis } from "@/lib/schema";

// Mise en forme pour l'affichage. Aucun calcul métier : on ne fait que
// traduire et formater ce que contient l'analyse.

type Deal = Analysis["deal"];
type Band = NonNullable<Analysis["score"]>["band"];
type Severity = Analysis["red_flags"][number]["severity"];

// Les montants passent par le formateur unique de lib/money.ts.
export { formatEur, formatEurRange } from "@/lib/money";

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

// Pastille de verdict quand l'offre n'a pas de score.
export const EVALUABILITY_LABEL: Record<Exclude<Analysis["evaluability"], "complete">, string> = {
  unpriced: "Offre à chiffrer",
  terms_unknown: "Offre à préciser",
  incomplete: "Informations insuffisantes",
};

// Segments de la jauge de score, dans l'ordre : première valeur de chaque
// bande. La cohérence avec bandFor() est vérifiée par tests/design.test.ts.
export const BAND_SEGMENTS: ReadonlyArray<{ band: Band; from: number }> = [
  { band: "bad", from: 0 },
  { band: "weak", from: 30 },
  { band: "fair", from: 50 },
  { band: "good", from: 70 },
  { band: "excellent", from: 85 },
];

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
      return d.quantity === null ? `${capitalizeFirst(many)}${platform}, nombre non précisé` : `${d.quantity} ${d.quantity > 1 ? many : one}${platform}`;
    })
    .join(" · ");
}

export type RecapRow = { label: string; value: string };

// Ne renvoie que les lignes qui ont une valeur : jamais de « non spécifié ».
export function dealRecapRows(deal: Deal): RecapRow[] {
  const rows: Array<RecapRow | null> = [
    deal.brand ? { label: "Marque", value: deal.brand } : null,
    deal.deliverables.length > 0
      ? {
          label: "Livrables",
          value: deal.deliverables
            .map((d) => {
              const [one, many] = DELIVERABLE_LABEL[d.type];
              const parts = [d.quantity === null ? many : `${d.quantity} ${d.quantity > 1 ? many : one}`];
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
            deal.exclusivity.duration_months !== null ? `${deal.exclusivity.duration_months} mois` : null,
            deal.exclusivity.category,
          ]
            .filter(Boolean)
            .join(", ") || "Oui",
        }
      : null,
    deal.raw_footage ? { label: "Raw footage", value: "Inclus" } : null,
    IP_TRANSFER_LABEL[deal.ip_transfer]
      ? { label: "Droits d'auteur", value: IP_TRANSFER_LABEL[deal.ip_transfer] ?? "" }
      : null,
    AI_TRAINING_LABEL[deal.ai_training_rights]
      ? { label: "Entraînement IA", value: AI_TRAINING_LABEL[deal.ai_training_rights] ?? "" }
      : null,
    deal.revisions.unlimited
      ? { label: "Révisions", value: "Illimitées" }
      : deal.revisions.count !== null
        ? { label: "Révisions", value: String(deal.revisions.count) }
        : null,
    deal.payment.amount_eur !== null
      ? { label: "Rémunération", value: formatEur(deal.payment.amount_eur) }
      : null,
    deal.payment.terms_days !== null
      ? { label: "Délai de paiement", value: `${deal.payment.terms_days} jours` }
      : null,
    deal.payment.schedule ? { label: "Échéancier", value: deal.payment.schedule } : null,
    deal.in_kind_value_eur !== null
      ? { label: "Produits offerts", value: formatEur(deal.in_kind_value_eur) }
      : null,
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
      ? `${usage.duration_months} mois`
      : null;
  const value = kinds.join(", ");
  return { label: "Utilisation", value: duration ? `${value} · ${duration}` : value };
}

export function sortByPriority<T extends { priority: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.priority - b.priority);
}
