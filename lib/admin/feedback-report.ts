import { FEEDBACK_RATINGS, type FeedbackRating } from "@/lib/analysis/feedback-options";
import { normalizeDeal } from "@/lib/analysis/normalize";
import rates from "@/lib/rates/fr-2026.3.json";
import { TIERS, type Tier } from "@/lib/rates/tier";
import { analysisSchema, type Analysis } from "@/lib/schema";
import { isUuid } from "@/lib/security/request";
import { isMissingColumn, isMissingRelation, selectRows } from "@/lib/supabase/server";

// Mission #077 — lecture des retours « Cette estimation te paraît juste ? ».
//
// Ce qui est lu : la table analysis_feedback (réponse, commentaire, niveau et
// chiffres AFFICHÉS au moment de l'avis) et, dans l'analyse, uniquement la
// forme du deal (analyses.payload->deal). Jamais le compte, l'adresse email,
// le jeton anonyme ni le texte de l'offre : rien de tout ça n'est demandé à la
// base.

type Deal = Analysis["deal"];

export type FeedbackRow = {
  analysis_id: string;
  rating: FeedbackRating;
  comment: string | null;
  profile_tier: Tier | null;
  score: number | null;
  total_low: number | null;
  total_high: number | null;
  rate_table_version: string;
  created_at: string;
  updated_at: string;
  analysis: { deal: unknown } | null;
};

export type Distribution = { total: number; counts: Record<FeedbackRating, number> };
export type Group = { key: string; label: string; detail?: string; distribution: Distribution };
export type Breakdown = { key: string; title: string; groups: Group[] };

// Montant confronté à la fourchette, comme le verdict (lib/analysis/verdict.ts) :
// l'argent proposé, sinon la valeur des produits offerts quand elle est écrite.
export type Offered = { value: number; kind: "money" | "products" } | null;

export type FeedbackEntry = {
  analysisId: string;
  answeredAt: string;
  rating: FeedbackRating;
  comment: string | null;
  tier: Tier | null;
  score: number | null;
  offered: Offered;
  rangeLow: number | null;
  rangeHigh: number | null;
  // offered.value / rangeLow. null quand l'un des deux manque.
  ratioToLow: number | null;
  rateTableVersion: string;
};

export type FeedbackReport = {
  overall: Distribution;
  byTier: Group[];
  byVersion: Group[];
  byRatio: Group[];
  byShape: Breakdown[];
  entries: FeedbackEntry[];
};

function emptyDistribution(): Distribution {
  return { total: 0, counts: { too_low: 0, fair: 0, too_high: 0 } };
}

function distributionOf(rows: Array<{ rating: FeedbackRating }>): Distribution {
  const distribution = emptyDistribution();
  for (const row of rows) {
    if (!FEEDBACK_RATINGS.includes(row.rating)) continue;
    distribution.counts[row.rating] += 1;
    distribution.total += 1;
  }
  return distribution;
}

// Forme du deal lue dans l'analyse enregistrée. null : illisible (schéma
// inconnu). Mise en cohérence comme à l'affichage (mission #057).
export function dealOf(row: Pick<FeedbackRow, "analysis">): Deal | null {
  const parsed = analysisSchema.shape.deal.safeParse(row.analysis?.deal);
  return parsed.success ? normalizeDeal(parsed.data) : null;
}

// Droits publicitaires : tout usage payant des contenus, sous le nom de la
// marque (paid_ads) ou depuis le compte de la créatrice (whitelisting, Spark Ads).
export function hasAdRights(deal: Deal): boolean {
  return deal.usage.paid_ads || deal.usage.whitelisting || deal.usage.spark_ads;
}

export function offeredOf(deal: Deal | null): Offered {
  if (!deal) return null;
  if (deal.payment.amount_eur !== null) return { value: deal.payment.amount_eur, kind: "money" };
  if (deal.in_kind_value_eur !== null) return { value: deal.in_kind_value_eur, kind: "products" };
  return null;
}

// Un groupe par modalité, dans un ordre fixe. Les groupes vides sont gardés :
// « aucun retour » est une information, pas une absence de ligne.
function split(rows: FeedbackRow[], groups: Array<{ key: string; label: string; detail?: string; test: (row: FeedbackRow) => boolean }>): Group[] {
  return groups.map(({ key, label, detail, test }) => ({ key, label, detail, distribution: distributionOf(rows.filter(test)) }));
}

// Groupe « analyse illisible », affiché seulement s'il contient quelque chose.
function withUnreadable(groups: Group[], rows: FeedbackRow[]): Group[] {
  const unreadable = rows.filter((row) => dealOf(row) === null);
  return unreadable.length === 0
    ? groups
    : [...groups, { key: "illisible", label: "Analyse illisible", detail: "Forme du deal non lisible dans l'analyse enregistrée.", distribution: distributionOf(unreadable) }];
}

export const TIER_GROUP_LABEL: Record<Tier, string> = {
  starter: "Je débute",
  confirmed: "Collabs payées",
  experienced: "C'est mon métier",
};

// Version de la table qui sert aujourd'hui aux nouvelles analyses.
export const CURRENT_RATE_TABLE = rates.version;

// Mission #078, A — par version de la table de tarifs enregistrée avec la
// réponse. La table actuelle d'abord, toujours présente (« Aucun retour » tant
// qu'elle n'en a pas) ; puis les anciennes, de la plus récente à la plus
// ancienne. Le jour où la table change, les retours d'avant restent à part.
function byVersion(rows: FeedbackRow[]): Group[] {
  const older = [...new Set(rows.map((row) => row.rate_table_version))]
    .filter((version) => version !== CURRENT_RATE_TABLE)
    .sort((a, b) => b.localeCompare(a, "fr", { numeric: true }));
  return [
    { key: CURRENT_RATE_TABLE, label: CURRENT_RATE_TABLE, detail: "Table actuelle." },
    ...older.map((version) => ({ key: version, label: version, detail: "Ancienne table." })),
  ].map((group) => ({ ...group, distribution: distributionOf(rows.filter((row) => row.rate_table_version === group.key)) }));
}

// Mission #078, B — rapport entre le montant proposé et le bas de la fourchette
// jugée. Bornes : moins de 0,5 ; de 0,5 à 1 inclus ; plus de 1. Sans montant
// chiffrable (aucun montant écrit, devise étrangère, pas de fourchette, deal
// illisible) : groupe à part, jamais fondu dans un autre.
export const RATIO_GROUPS = [
  { key: "moins-0-5", label: "Moins de 0,5 × le bas", test: (ratio: number) => ratio < 0.5 },
  { key: "0-5-a-1", label: "De 0,5 à 1 × le bas", test: (ratio: number) => ratio >= 0.5 && ratio <= 1 },
  { key: "plus-de-1", label: "Plus de 1 × le bas", detail: "Proposé au-dessus du bas de la fourchette.", test: (ratio: number) => ratio > 1 },
] as const;

function byRatio(entries: FeedbackEntry[]): Group[] {
  return [
    ...RATIO_GROUPS.map(({ key, label, test, ...rest }) => ({
      key,
      label,
      detail: "detail" in rest ? rest.detail : undefined,
      distribution: distributionOf(entries.filter((entry) => entry.ratioToLow !== null && test(entry.ratioToLow))),
    })),
    {
      key: "non-chiffrable",
      label: "Montant non chiffrable",
      detail: "Aucun montant ni valeur de produits écrits, devise étrangère, pas de fourchette, ou analyse illisible.",
      distribution: distributionOf(entries.filter((entry) => entry.ratioToLow === null)),
    },
  ];
}

export function buildReport(rows: FeedbackRow[]): FeedbackReport {
  const byTier = split(rows, TIERS.map((tier) => ({ key: tier, label: TIER_GROUP_LABEL[tier], test: (row) => row.profile_tier === tier })));
  const unknownTier = rows.filter((row) => row.profile_tier === null);
  if (unknownTier.length > 0) {
    byTier.push({
      key: "inconnu",
      label: "Niveau non enregistré",
      // Migration 20260917000017 : avant elle, le niveau n'était pas choisi,
      // les chiffres étaient ceux du niveau « collabs payées ».
      detail: "Avis donnés avant l'enregistrement du niveau : les chiffres montrés étaient ceux du niveau « Collabs payées », imposé.",
      distribution: distributionOf(unknownTier),
    });
  }

  const shape = (test: (deal: Deal) => boolean) => (row: FeedbackRow) => {
    const deal = dealOf(row);
    return deal !== null && test(deal);
  };

  const byShape: Breakdown[] = [
    {
      key: "droits-pub",
      title: "Droits publicitaires",
      groups: withUnreadable(
        split(rows, [
          { key: "avec", label: "Avec droits pub", detail: "Pub payée, whitelisting ou Spark Ads.", test: shape(hasAdRights) },
          { key: "sans", label: "Sans droits pub", test: shape((deal) => !hasAdRights(deal)) },
        ]),
        rows,
      ),
    },
    {
      key: "exclusivite",
      title: "Exclusivité",
      groups: withUnreadable(
        split(rows, [
          { key: "avec", label: "Avec exclusivité", test: shape((deal) => deal.exclusivity.present) },
          { key: "sans", label: "Sans exclusivité", test: shape((deal) => !deal.exclusivity.present) },
        ]),
        rows,
      ),
    },
    {
      key: "produits",
      title: "Produits offerts",
      groups: withUnreadable(
        split(rows, [
          {
            key: "chiffres",
            label: "Valeur des produits écrite",
            test: shape((deal) => deal.in_kind_value_eur !== null),
          },
          {
            key: "non-chiffres",
            label: "Aucune valeur de produits écrite",
            // L'analyse n'enregistre les produits offerts que par leur valeur :
            // des produits offerts sans prix écrit ne s'y distinguent pas d'une
            // offre sans produits.
            detail: "Sans produits, ou avec des produits dont la valeur n'est pas écrite : l'analyse ne distingue pas les deux.",
            test: shape((deal) => deal.in_kind_value_eur === null),
          },
        ]),
        rows,
      ),
    },
  ];

  const entries = rows.map((row): FeedbackEntry => {
    const offered = offeredOf(dealOf(row));
    return {
      analysisId: row.analysis_id,
      answeredAt: row.updated_at,
      rating: row.rating,
      comment: row.comment,
      tier: row.profile_tier,
      score: row.score,
      offered,
      rangeLow: row.total_low,
      rangeHigh: row.total_high,
      ratioToLow: offered && row.total_low ? offered.value / row.total_low : null,
      rateTableVersion: row.rate_table_version,
    };
  });
  entries.sort((a, b) => b.answeredAt.localeCompare(a.answeredAt));

  return { overall: distributionOf(rows), byTier, byVersion: byVersion(rows), byRatio: byRatio(entries), byShape, entries };
}

const PAGE_SIZE = 1000;
const COLUMNS =
  "analysis_id,rating,comment,profile_tier,score,total_low,total_high,rate_table_version,created_at,updated_at,analysis:analyses(deal:payload->deal)";

// Toutes les lignes, par pages (la base plafonne une réponse à 1 000 lignes).
// "missing" : table ou colonne profile_tier absente (migrations 016 et 017).
export async function loadFeedbackRows(): Promise<FeedbackRow[] | "missing"> {
  const rows: FeedbackRow[] = [];
  try {
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const page = await selectRows<FeedbackRow>(
        "analysis_feedback",
        `select=${COLUMNS}&order=updated_at.desc,analysis_id.asc&limit=${PAGE_SIZE}&offset=${offset}`,
      );
      rows.push(...page);
      if (page.length < PAGE_SIZE) return rows;
    }
  } catch (caught) {
    if (isMissingRelation(caught) || isMissingColumn(caught)) return "missing";
    throw caught;
  }
}

// ─── Une analyse commentée (page /dev/retours/[id]) ──────────────────────────

export type FeedbackDetail = { feedback: FeedbackEntry; analysis: Analysis };

// L'analyse d'un retour, lue par son identifiant avec la clé de service : la
// page de résultat publique n'est lisible que par la personne qui a analysé
// l'offre, le propriétaire du site n'y aurait qu'un 404. Seul le contenu de
// l'analyse est lu, jamais le deal en base (compte, jeton, texte d'origine).
// null : pas d'analyse, ou aucun retour sur elle.
export async function loadFeedbackDetail(id: string): Promise<FeedbackDetail | null> {
  if (!isUuid(id)) return null;
  let rows: FeedbackRow[];
  try {
    rows = await selectRows<FeedbackRow>("analysis_feedback", `select=${COLUMNS}&analysis_id=eq.${id}&limit=1`);
  } catch (caught) {
    if (isMissingRelation(caught) || isMissingColumn(caught)) return null;
    throw caught;
  }
  const row = rows[0];
  if (!row) return null;
  const [stored] = await selectRows<{ payload: unknown }>("analyses", `select=payload&id=eq.${id}&limit=1`);
  const parsed = analysisSchema.safeParse(stored?.payload);
  if (!parsed.success) return null;
  return {
    feedback: buildReport([row]).entries[0],
    analysis: { ...parsed.data, deal: normalizeDeal(parsed.data.deal) },
  };
}
