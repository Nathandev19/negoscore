import { ADMIN_PERIODS, type AdminPeriod, type DashboardData } from "@/lib/admin/data";

// Mission #132 — les états du cockpit qu'on ne peut pas attendre de la base.
//
// Les graphiques se jugent à l'œil, et les défauts corrigés par cette mission
// n'apparaissaient que dans des cas précis : deux jours de données (le
// graphique avait l'air cassé), une période entièrement vide (un zéro se
// lisait comme une absence), un mois complet (les dates se chevauchaient).
// Ces fixtures servent à les regarder, dans /dev/cockpit, sans base et sans
// session propriétaire.
//
// Aucune ne sert au produit : elles ne sont lues que par une page .dev.tsx,
// absente du build de production.

export const COCKPIT_PREVIEWS = ["lancement", "vide", "un-jour", "mois"] as const;
export type CockpitPreview = (typeof COCKPIT_PREVIEWS)[number];

const VIDE: DashboardData = {
  counts: {},
  excluded: 0,
  internal: 0,
  paid_pro: 0,
  granted_pro: 0,
  feedback: { total: 0, fair: 0, not_fair: 0 },
  purchases: { purchases: 0, revenue_eur: 0, revenue_covered: 0 },
  timeseries: [],
  acquisition: [],
  guides: [],
  example: { total: 0, direct: 0 },
  tier_changes: [],
};

function jours(nombre: number, valeurs: (index: number) => { page_views: number; analyses: number }): DashboardData["timeseries"] {
  return Array.from({ length: nombre }, (_, index) => {
    const date = new Date(Date.UTC(2026, 8, 1 + index));
    const { page_views, analyses } = valeurs(index);
    return { day: date.toISOString().slice(0, 10), page_views, analyses, signups: 0, purchases: 0 };
  });
}

// L'état réel du 01/10 : presque tout à zéro, deux jours d'activité sur sept.
const LANCEMENT: DashboardData = {
  ...VIDE,
  counts: {
    landing_view: 80,
    pricing_view: 4,
    guide_view: 12,
    example_view: 4,
    analysis_started: 2,
    analysis_completed: 2,
  },
  excluded: 4,
  internal: 16,
  feedback: { total: 1, fair: 1, not_fair: 0 },
  // Sept jours contigus, du 25/09 au 01/10 : cinq à zéro, puis les deux
  // jours réels. C'est l'état qui faisait croire à un graphique cassé.
  timeseries: [
    { day: "2026-09-25", page_views: 0, analyses: 0, signups: 0, purchases: 0 },
    { day: "2026-09-26", page_views: 0, analyses: 0, signups: 0, purchases: 0 },
    { day: "2026-09-27", page_views: 0, analyses: 0, signups: 0, purchases: 0 },
    { day: "2026-09-28", page_views: 0, analyses: 0, signups: 0, purchases: 0 },
    { day: "2026-09-29", page_views: 0, analyses: 0, signups: 0, purchases: 0 },
    { day: "2026-09-30", page_views: 8, analyses: 0, signups: 0, purchases: 0 },
    { day: "2026-10-01", page_views: 24, analyses: 2, signups: 0, purchases: 0 },
  ],
  acquisition: [
    { source: "non_attribue", campaign: "non_attribue", content: "non_attribue", visits: 12, analyses: 1, signups: 0, purchases: 0 },
    { source: "instagram", campaign: "lancement", content: "bio_instagram", visits: 5, analyses: 1, signups: 0, purchases: 0 },
    { source: "tiktok", campaign: "lancement", content: "video_1_negociation", visits: 4, analyses: 0, signups: 0, purchases: 0 },
    { source: "instagram", campaign: "lancement", content: "dm_exemple", visits: 2, analyses: 0, signups: 0, purchases: 0 },
    { source: "instagram", campaign: "lancement", content: "dm_prospection", visits: 1, analyses: 0, signups: 0, purchases: 0 },
  ],
  guides: [
    { path: "/combien-facturer", views: 3, to_example: 0 },
    { path: "/droits-utilisation", views: 3, to_example: 0 },
    { path: "/produits-offerts", views: 3, to_example: 0 },
  ],
  example: { total: 2, direct: 2 },
  tier_changes: [],
};

// Un seul jour : le cas où un graphique à barres a le plus de chances d'avoir
// l'air cassé.
const UN_JOUR: DashboardData = {
  ...LANCEMENT,
  timeseries: [{ day: "2026-10-01", page_views: 3, analyses: 1, signups: 0, purchases: 0 }],
};

// Trente et un jours : les dates se chevauchaient, et le graphique défilait.
const MOIS: DashboardData = {
  ...LANCEMENT,
  counts: { ...LANCEMENT.counts, landing_view: 420, analysis_started: 31, analysis_completed: 24, signup: 6, checkout_started: 3, purchase_completed: 2 },
  purchases: { purchases: 2, revenue_eur: 17.98, revenue_covered: 2 },
  feedback: { total: 9, fair: 6, not_fair: 3 },
  timeseries: jours(31, (index) => ({
    page_views: index % 7 === 0 ? 0 : 6 + ((index * 7) % 23),
    analyses: index % 5 === 0 ? 0 : (index % 3) + 1,
  })),
  tier_changes: [
    { tier: "experienced", changes: 7 },
    { tier: "confirmed", changes: 2 },
  ],
};

const ETATS: Record<CockpitPreview, DashboardData> = {
  lancement: LANCEMENT,
  vide: VIDE,
  "un-jour": UN_JOUR,
  mois: MOIS,
};

export function cockpitPreview(etat: CockpitPreview): DashboardData {
  return ETATS[etat];
}

// Mission #133 — les quatre périodes d'un état, pour regarder un CHANGEMENT
// de période et non une période.
//
// Le cockpit tient désormais les quatre en mémoire : un aperçu qui n'en
// fournit qu'une ne permet pas de juger ce que la mission demande, à savoir
// que les barres bougent au clic. Chaque période garde les derniers jours de
// la série, et ses compteurs sont ramenés à la même proportion : des chiffres
// faux entre eux rendraient l'aperçu inutilisable pour juger à l'œil.
export function cockpitPreviewCaches(etat: CockpitPreview): Record<AdminPeriod, DashboardData> {
  const base = ETATS[etat];
  const jours: Record<AdminPeriod, number> = { "24h": 1, "7d": 7, "30d": 30, all: base.timeseries.length };
  return Object.fromEntries(ADMIN_PERIODS.map((period) => [period, derniersJours(base, jours[period])])) as Record<
    AdminPeriod,
    DashboardData
  >;
}

function derniersJours(base: DashboardData, nombre: number): DashboardData {
  const garde = base.timeseries.slice(Math.max(0, base.timeseries.length - nombre));
  const total = base.timeseries.reduce((somme, jour) => somme + jour.page_views, 0);
  const retenu = garde.reduce((somme, jour) => somme + jour.page_views, 0);
  const part = total === 0 ? 1 : retenu / total;
  return {
    ...base,
    timeseries: garde,
    counts: Object.fromEntries(Object.entries(base.counts).map(([nom, valeur]) => [nom, Math.round(valeur * part)])),
    acquisition: base.acquisition.map((row) => ({ ...row, visits: Math.round(row.visits * part) })),
    guides: base.guides.map((row) => ({ ...row, views: Math.round(row.views * part) })),
  };
}
