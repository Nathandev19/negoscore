import type { ResultView } from "@/lib/analysis/lock";
import type { FeedbackInput, StoredFeedback } from "@/lib/analysis/feedback-options";
import { isMissingColumn, isMissingRelation, selectRows, upsertRow } from "@/lib/supabase/server";

export { feedbackInputSchema } from "@/lib/analysis/feedback-options";

// « Cette estimation te paraît juste ? » : modifiable.
// Stocké avec un instantané de ce qui a été montré (version de la table, score,
// fourchette, tour), jamais avec une donnée personnelle ni le texte de l'offre.
// Une réponse par analyse ET par tour (mission #086).
// Table créée par la migration 20260917000016, niveau ajouté par 20260917000017,
// tour jugé ajouté par 20260920000024 (mission #086).

function warnMissing(operation: string) {
  console.warn(
    JSON.stringify({
      event: "analysis_feedback_missing",
      operation,
      detail:
        "Table analysis_feedback, colonne profile_tier ou turn_number absente : appliquer les migrations 20260917000016, 20260917000017 et 20260920000024.",
    }),
  );
}

// L'avis de CE tour (0 : l'offre d'origine), jamais celui d'un autre : un avis
// par tour (mission #086, clé analysis_id + turn_number).
// null : pas encore de réponse pour ce tour. "missing" : table ou colonnes
// absentes (migrations pas encore appliquées).
export async function readFeedback(analysisId: string, turn: number): Promise<StoredFeedback | null | "missing"> {
  try {
    const [row] = await selectRows<{ rating: StoredFeedback["rating"]; comment: string | null; turn_number: number; turn_recorded: boolean }>(
      "analysis_feedback",
      `select=rating,comment,turn_number,turn_recorded&analysis_id=eq.${analysisId}&turn_number=eq.${turn}&limit=1`,
    );
    // Avis d'avant la migration : rangé sur l'offre d'origine, tour non noté.
    return row ? { rating: row.rating, comment: row.comment, turn: row.turn_recorded ? row.turn_number : null } : null;
  } catch (caught) {
    if (!isMissingRelation(caught) && !isMissingColumn(caught)) throw caught;
    warnMissing("read");
    return "missing";
  }
}

// Mission #097 — la fourchette sur laquelle porte le DERNIER avis donné sur
// cette analyse, tous tours confondus. Sert à ne pas reposer la question quand
// rien n'a changé depuis. null : aucun avis, ou table absente.
export type JudgedRange = { low: number | null; high: number | null };

export async function lastJudgedRange(analysisId: string): Promise<JudgedRange | null> {
  try {
    const [row] = await selectRows<{ total_low: number | null; total_high: number | null }>(
      "analysis_feedback",
      `select=total_low,total_high,updated_at&analysis_id=eq.${analysisId}&order=updated_at.desc&limit=1`,
    );
    return row ? { low: row.total_low, high: row.total_high } : null;
  } catch (caught) {
    if (!isMissingRelation(caught) && !isMissingColumn(caught)) throw caught;
    warnMissing("read range");
    return null;
  }
}

// La question n'est reposée à un tour suivant que si la fourchette a changé
// depuis la dernière réponse. Elle reste affichée tant que personne n'a
// répondu, et quand la réponse de CE tour existe déjà : la modifier n'est pas
// une nouvelle demande.
export function shouldAskFeedback({
  current,
  lastJudged,
  answeredThisTurn,
}: {
  current: JudgedRange;
  lastJudged: JudgedRange | null;
  answeredThisTurn: boolean;
}): boolean {
  // Mission #099, point 8 (audit B2) — « Cette estimation te paraît juste ? »
  // sous une page qui dit « Pas d'estimation » ne veut rien dire, et l'avis
  // enregistré porterait sur des chiffres absents (mission #086). Sans
  // fourchette, on ne demande rien. Une offre sans montant de la marque
  // (« unpriced »), elle, EN a une : c'est même le seul chiffre de la page, et
  // le plus utile à faire juger.
  if (current.low === null && current.high === null) return false;
  if (answeredThisTurn || lastJudged === null) return true;
  return current.low !== lastJudged.low || current.high !== lastJudged.high;
}

// Ligne enregistrée : uniquement la réponse et ce que l'analyse affichait.
// analysis : l'analyse DÉJÀ recalculée au niveau de l'avis (voir la route) ; son
// niveau est celui des chiffres enregistrés, même si le recalcul était impossible.
// Mission #086 : ce sont les chiffres du tour jugé (lib/analysis/judged.ts), et
// turn est ce tour (0 : l'offre d'origine).
export function feedbackRow(analysisId: string, analysis: ResultView, input: FeedbackInput, turn: number) {
  return {
    analysis_id: analysisId,
    rating: input.rating,
    comment: input.comment,
    rate_table_version: analysis.estimate.rate_table_version,
    profile_tier: analysis.profile_tier,
    turn_number: turn,
    turn_recorded: true,
    score: analysis.score?.value ?? null,
    total_low: analysis.estimate.total_low,
    total_high: analysis.estimate.total_high,
    updated_at: new Date().toISOString(),
  };
}

export async function saveFeedback(analysisId: string, analysis: ResultView, input: FeedbackInput, turn: number): Promise<"saved" | "missing"> {
  try {
    // Un avis par tour : renvoyer un avis sur le même tour le remplace ; un
    // avis sur un autre tour s'ajoute, il n'écrase jamais celui d'origine.
    await upsertRow("analysis_feedback", feedbackRow(analysisId, analysis, input, turn), "analysis_id,turn_number");
    return "saved";
  } catch (caught) {
    // Colonne profile_tier ou turn_number absente : l'avis est refusé plutôt
    // qu'enregistré sans son niveau ou sans son tour.
    if (!isMissingRelation(caught) && !isMissingColumn(caught)) throw caught;
    warnMissing("write");
    return "missing";
  }
}
