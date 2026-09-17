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

// Couleurs des bandes de score : table unique, importée partout. Les valeurs
// sont les variables de app/globals.css (fond teinté à 8 %, texte à 4,5:1
// au moins sur ce fond, vérifié par tests/design.test.ts). Les bandes viennent
// de bandFor() dans lib/rates/score.ts.
export const BAND_STYLE: Record<Band, { text: string; tint: string; border: string; accent: string }> = {
  bad: { text: "text-band-bad-text", tint: "bg-band-bad-tint", border: "border-band-bad/25", accent: "bg-band-bad" },
  weak: { text: "text-band-weak-text", tint: "bg-band-weak-tint", border: "border-band-weak/25", accent: "bg-band-weak" },
  fair: { text: "text-band-fair-text", tint: "bg-band-fair-tint", border: "border-band-fair/25", accent: "bg-band-fair" },
  good: { text: "text-band-good-text", tint: "bg-band-good-tint", border: "border-band-good/25", accent: "bg-band-good" },
  excellent: {
    text: "text-band-excellent-text",
    tint: "bg-band-excellent-tint",
    border: "border-band-excellent/25",
    accent: "bg-band-excellent",
  },
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

export const SEVERITY_BADGE: Record<Severity, string> = {
  high: "bg-red-600 text-white",
  medium: "bg-orange-100 text-orange-900",
  low: "bg-neutral-200 text-neutral-800",
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
              const parts = [`${d.quantity} ${d.quantity > 1 ? many : one}`];
              if (d.platform) parts.push(PLATFORM_LABEL[d.platform]);
              if (d.format) parts.push(`(${d.format})`);
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
