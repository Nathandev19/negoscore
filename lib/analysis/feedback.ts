import type { ResultView } from "@/lib/analysis/lock";
import type { FeedbackInput, StoredFeedback } from "@/lib/analysis/feedback-options";
import { isMissingRelation, selectRows, upsertRow } from "@/lib/supabase/server";

export { feedbackInputSchema } from "@/lib/analysis/feedback-options";

// « Cette estimation te paraît juste ? » : une réponse par analyse, modifiable.
// Stocké avec un instantané de ce qui a été montré (version de la table, score,
// fourchette), jamais avec une donnée personnelle ni le texte de l'offre.
// Table créée par la migration 20260917000016.

function warnMissing(operation: string) {
  console.warn(
    JSON.stringify({
      event: "analysis_feedback_missing",
      operation,
      detail: "Table analysis_feedback absente : appliquer la migration 20260917000016.",
    }),
  );
}

// null : pas encore de réponse. "missing" : la table n'existe pas encore.
export async function readFeedback(analysisId: string): Promise<StoredFeedback | null | "missing"> {
  try {
    const [row] = await selectRows<StoredFeedback>(
      "analysis_feedback",
      `select=rating,comment&analysis_id=eq.${analysisId}&limit=1`,
    );
    return row ?? null;
  } catch (caught) {
    if (!isMissingRelation(caught)) throw caught;
    warnMissing("read");
    return "missing";
  }
}

// Ligne enregistrée : uniquement la réponse et ce que l'analyse affichait.
export function feedbackRow(analysisId: string, analysis: ResultView, input: FeedbackInput) {
  return {
    analysis_id: analysisId,
    rating: input.rating,
    comment: input.comment,
    rate_table_version: analysis.estimate.rate_table_version,
    score: analysis.score?.value ?? null,
    total_low: analysis.estimate.total_low,
    total_high: analysis.estimate.total_high,
    updated_at: new Date().toISOString(),
  };
}

export async function saveFeedback(analysisId: string, analysis: ResultView, input: FeedbackInput): Promise<"saved" | "missing"> {
  try {
    await upsertRow("analysis_feedback", feedbackRow(analysisId, analysis, input), "analysis_id");
    return "saved";
  } catch (caught) {
    if (!isMissingRelation(caught)) throw caught;
    warnMissing("write");
    return "missing";
  }
}
