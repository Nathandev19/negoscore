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
