import { FEEDBACK_RATINGS, type FeedbackRating } from "@/lib/analysis/feedback-options";
import { normalizeDeal } from "@/lib/analysis/normalize";
import { offeredOf, type Offered } from "@/lib/negotiation/terms";
import { CURRENT_RATE_VERSION } from "@/lib/rates/tables";
import { TIERS, type Tier } from "@/lib/rates/tier";
import { analysisSchema, type Analysis } from "@/lib/schema";
import { isUuid } from "@/lib/security/request";
import { isMissingColumn, isMissingRelation, selectRows } from "@/lib/supabase/server";

// Mission #077 — lecture des retours « Cette estimation te paraît juste ? ».
//
// Ce qui est lu : la table analysis_feedback (réponse, commentaire, niveau,
// tour et chiffres AFFICHÉS au moment de l'avis) et uniquement la forme du deal
// JUGÉ : celle de l'analyse (analyses.payload->deal) pour un avis sur l'offre
// d'origine, celle du tour (negotiation_turns.payload->deal_after) pour un avis
// donné après un tour de négociation (mission #086). Jamais le compte, l'adresse email,
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
  // Mission #086 : tour jugé (0 : offre d'origine, 2 à 5 : après ce tour). Un
  // avis par analyse ET par tour.
  turn_number: number;
  // false : avis d'avant la migration 20260920000024, tour non noté ; rangé
  // sur l'offre d'origine (turn_number 0), et affiché comme supposé.
  turn_recorded: boolean;
  created_at: string;
  updated_at: string;
  analysis: { deal: unknown } | null;
  // Termes du tour jugé, lus dans negotiation_turns par loadFeedbackRows.
  // Absent : tour introuvable (le regroupement le range à part).
  turn_deal?: unknown;
};

export type Distribution = { total: number; counts: Record<FeedbackRating, number> };
export type Group = { key: string; label: string; detail?: string; distribution: Distribution };
export type Breakdown = { key: string; title: string; groups: Group[] };

// Montant confronté à la fourchette : lib/negotiation/terms.ts (offeredOf).
export type { Offered } from "@/lib/negotiation/terms";

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
  // Tour jugé (0 : offre d'origine) ; null : non enregistré (avis ancien).
  turn: number | null;
};

export type FeedbackReport = {
  overall: Distribution;
  byTier: Group[];
  byVersion: Group[];
  byTurn: Group[];
  // Nombre d'analyses comptées dans les répartitions, et nombre d'avis.
  analyses: number;
  avis: number;
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

// Forme du deal JUGÉ : celle du tour de négociation pour un avis donné après
// un tour (mission #086), celle de l'analyse sinon (avis sur l'offre
// d'origine, ou avis ancien, supposé l'être). null : illisible (schéma
// inconnu, tour introuvable). Mise en cohérence comme à l'affichage (#057).
export function dealOf(row: Pick<FeedbackRow, "analysis" | "turn_number" | "turn_deal">): Deal | null {
  const judged = row.turn_number > 0 ? row.turn_deal : row.analysis?.deal;
  const parsed = analysisSchema.shape.deal.safeParse(judged);
  return parsed.success ? normalizeDeal(parsed.data) : null;
}

// Droits publicitaires : tout usage payant des contenus, sous le nom de la
// marque (paid_ads) ou depuis le compte de la créatrice (whitelisting, Spark Ads).
export function hasAdRights(deal: Deal): boolean {
  return deal.usage.paid_ads || deal.usage.whitelisting || deal.usage.spark_ads;
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
    : [
        ...groups,
        {
          key: "illisible",
          label: "Forme du deal illisible",
          detail: "Analyse illisible, ou tour de négociation jugé introuvable.",
          distribution: distributionOf(unreadable),
        },
      ];
}

export const TIER_GROUP_LABEL: Record<Tier, string> = {
  starter: "Je débute",
  confirmed: "Collabs payées",
  experienced: "C'est mon métier",
};

// Version de la table qui sert aujourd'hui aux nouvelles analyses.
export const CURRENT_RATE_TABLE = CURRENT_RATE_VERSION;

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

// Mission #086, C et E — sur quoi porte l'avis. Les avis d'avant
// l'enregistrement du tour sont comptés à part, avec ce qu'on en suppose.
function byTurn(rows: FeedbackRow[]): Group[] {
  const groups: Group[] = [
    {
      key: "origine",
      label: "Offre d'origine",
      distribution: distributionOf(rows.filter((row) => row.turn_recorded && row.turn_number === 0)),
    },
    {
      key: "apres-tour",
      label: "Après un tour de négociation",
      detail: "Chiffres et forme du deal : ceux des termes du tour jugé.",
      distribution: distributionOf(rows.filter((row) => row.turn_number > 0)),
    },
  ];
  const unknown = rows.filter((row) => !row.turn_recorded);
  if (unknown.length > 0) {
    groups.push({
      key: "non-enregistre",
      label: "Tour non enregistré",
      detail: "Avis donnés avant l'enregistrement du tour : supposés porter sur l'offre d'origine, et comptés comme tels ailleurs.",
      distribution: distributionOf(unknown),
    });
  }
  return groups;
}

// Mission #086, C — un avis par tour : une même analyse peut en avoir
// plusieurs. Les répartitions (ensemble, niveau, version, rapport, forme)
// comptent chaque analyse UNE fois : son avis sur l'offre d'origine s'il
// existe (le seul qui juge un chiffrage non négocié), sinon celui du dernier
// tour jugé. Le tableau par tour jugé et la liste montrent, eux, chaque avis.
export function onePerAnalysis(rows: readonly FeedbackRow[]): FeedbackRow[] {
  const kept = new Map<string, FeedbackRow>();
  for (const row of rows) {
    const current = kept.get(row.analysis_id);
    const better = !current || (current.turn_number !== 0 && (row.turn_number === 0 || row.turn_number > current.turn_number));
    if (better) kept.set(row.analysis_id, row);
  }
  return [...kept.values()];
}

function entryOf(row: FeedbackRow): FeedbackEntry {
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
    turn: row.turn_recorded ? row.turn_number : null,
  };
}

export function buildReport(allRows: FeedbackRow[]): FeedbackReport {
  const rows = onePerAnalysis(allRows);
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

  // Liste : chaque avis, le plus récent d'abord.
  const entries = allRows.map(entryOf);
  entries.sort((a, b) => b.answeredAt.localeCompare(a.answeredAt));

  return {
    overall: distributionOf(rows),
    analyses: rows.length,
    avis: allRows.length,
    byTier,
    byVersion: byVersion(rows),
    byTurn: byTurn(allRows),
    byRatio: byRatio(rows.map(entryOf)),
    byShape,
    entries,
  };
}

// Mission #107 — borne explicite du rapport. La base plafonne de toute façon
// une réponse à 1 000 lignes : au-delà, il faudrait paginer à l'écran, ce que
// 0 retour enregistré ne justifie pas encore.
export const FEEDBACK_MAX = 1000;
const COLUMNS =
  "analysis_id,rating,comment,profile_tier,score,total_low,total_high,rate_table_version,turn_number,turn_recorded,created_at,updated_at,analysis:analyses(deal:payload->deal)";

// Mission #086 — termes des tours jugés, lus dans negotiation_turns : seulement
// payload->deal_after, jamais la réponse collée.
//
// Mission #107 — un seul lot pour les volumes réels. Le lot reste borné parce
// que la liste d'identifiants voyage dans l'ADRESSE de la requête : 150 UUID
// font déjà 5,5 Kio, et une passerelle refuse une adresse trop longue. C'est
// la seule raison de ce découpage, et il ne se déclenche qu'au-delà de 150
// analyses commentées sur un tour.
const TURN_BATCH = 150;
export async function attachTurnDeals(rows: FeedbackRow[]): Promise<FeedbackRow[]> {
  const wanted = rows.filter((row) => row.turn_number > 0);
  if (wanted.length === 0) return rows;
  const ids = [...new Set(wanted.map((row) => row.analysis_id))].filter(isUuid);
  const deals = new Map<string, unknown>();
  for (let start = 0; start < ids.length; start += TURN_BATCH) {
    const batch = ids.slice(start, start + TURN_BATCH);
    const found = await selectRows<{ analysis_id: string; turn_number: number; deal: unknown }>(
      "negotiation_turns",
      `select=analysis_id,turn_number,deal:payload->deal_after&kind=eq.reply&analysis_id=in.(${batch.join(",")})`,
    );
    for (const turn of found) deals.set(`${turn.analysis_id}:${turn.turn_number}`, turn.deal);
  }
  return rows.map((row) =>
    row.turn_number > 0 ? { ...row, turn_deal: deals.get(`${row.analysis_id}:${row.turn_number}`) } : row,
  );
}

// Mission #107 — UNE requête bornée, au lieu d'une boucle page par page.
//
// L'ancienne version demandait 1 000 lignes, puis les 1 000 suivantes, jusqu'à
// une page incomplète : le nombre d'allers-retours grandissait avec le volume,
// et la page attendait toute la chaîne avant de s'afficher. La borne est
// maintenant explicite et le nombre de lectures constant. Au-delà, le rapport
// porte sur les ${FEEDBACK_MAX} retours les plus récents, et le dit.
//
// "missing" : table ou colonne profile_tier absente (migrations 016 et 017).
export async function loadFeedbackRows(): Promise<FeedbackRow[] | "missing"> {
  try {
    const rows = await selectRows<FeedbackRow>(
      "analysis_feedback",
      `select=${COLUMNS}&order=updated_at.desc,analysis_id.asc&limit=${FEEDBACK_MAX}`,
    );
    if (rows.length === FEEDBACK_MAX) {
      console.warn(JSON.stringify({ event: "feedback_report_tronque", limite: FEEDBACK_MAX }));
    }
    return await attachTurnDeals(rows);
  } catch (caught) {
    if (isMissingRelation(caught) || isMissingColumn(caught)) return "missing";
    throw caught;
  }
}

// ─── Un avis commenté (page /dev/retours/[id]?tour=N) ─────────────────────────

// judgedDeal : forme du deal jugé (termes du tour pour un avis après un tour),
// null si introuvable.
export type FeedbackDetail = { feedback: FeedbackEntry; analysis: Analysis; judgedDeal: Deal | null };

// L'analyse d'un retour, lue par son identifiant avec la clé de service : la
// page de résultat publique n'est lisible que par la personne qui a analysé
// l'offre, le propriétaire du site n'y aurait qu'un 404. Seul le contenu de
// l'analyse est lu, jamais le deal en base (compte, jeton, texte d'origine).
// turn : le tour de l'avis (0 : l'offre d'origine, avis anciens compris).
// null : pas d'analyse, ou aucun avis sur elle pour ce tour.
export async function loadFeedbackDetail(id: string, turn = 0): Promise<FeedbackDetail | null> {
  if (!isUuid(id) || !Number.isInteger(turn)) return null;
  let rows: FeedbackRow[];
  try {
    rows = await selectRows<FeedbackRow>("analysis_feedback", `select=${COLUMNS}&analysis_id=eq.${id}&turn_number=eq.${turn}&limit=1`);
  } catch (caught) {
    if (isMissingRelation(caught) || isMissingColumn(caught)) return null;
    throw caught;
  }
  const [row] = rows.length > 0 ? await attachTurnDeals(rows.slice(0, 1)) : [];
  if (!row) return null;
  const [stored] = await selectRows<{ payload: unknown }>("analyses", `select=payload&id=eq.${id}&limit=1`);
  const parsed = analysisSchema.safeParse(stored?.payload);
  if (!parsed.success) return null;
  return {
    feedback: entryOf(row),
    analysis: { ...parsed.data, deal: normalizeDeal(parsed.data.deal) },
    judgedDeal: dealOf(row),
  };
}
