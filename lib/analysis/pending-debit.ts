import { deleteRows, insertIfAbsent, isMissingRelation, selectRows, updateRows } from "@/lib/supabase/server";

// Mission #099, point 1 (audit A1) — les analyses enregistrées sans avoir été
// décomptées (table pending_debits, migration 20260923000028).
//
// La règle du produit n'a pas changé : on ne débite qu'un résultat réellement
// produit, donc l'analyse est écrite AVANT le décompte. Quand le décompte est
// refusé, la route supprime ce qu'elle vient d'écrire. Ce module ne sert qu'au
// cas où cette suppression échoue elle aussi : l'analyse reste alors visible
// sans contrepartie, et il faut la reprendre.

export type PendingDebit = {
  analysis_id: string;
  deal_id: string;
  user_id: string | null;
  anon_token: string | null;
  plan: "free" | "pack" | "pro" | "retry";
  created_at: string;
  attempts: number;
  resolved_at: string | null;
  resolution: "decompte" | "supprimee" | null;
};

// Au-delà, une analyse non décomptée ne doit plus être visible.
export const DEBIT_GRACE_HOURS = 24;

const COLUMNS = "analysis_id,deal_id,user_id,anon_token,plan,created_at,attempts,resolved_at,resolution";

// Table absente (migration 028 pas encore appliquée) : on le dit une fois, et
// rien ne casse — l'analyse reste, et le journal a déjà tout pour la retrouver.
function absent(caught: unknown, operation: string): boolean {
  if (!isMissingRelation(caught)) return false;
  console.warn(JSON.stringify({ event: "pending_debits_table_absente", operation }));
  return true;
}

export async function recordPendingDebit(
  debit: Omit<PendingDebit, "created_at" | "attempts" | "resolved_at" | "resolution">,
): Promise<void> {
  try {
    await insertIfAbsent("pending_debits", { ...debit, attempts: 0, created_at: new Date().toISOString() });
  } catch (caught) {
    if (!absent(caught, "insertion")) throw caught;
  }
}

export async function openDebits(limit = 50): Promise<PendingDebit[]> {
  try {
    return await selectRows<PendingDebit>(
      "pending_debits",
      `select=${COLUMNS}&resolved_at=is.null&order=created_at.asc&limit=${limit}`,
    );
  } catch (caught) {
    if (!absent(caught, "lecture")) throw caught;
    return [];
  }
}

// RÈGLE COMMUNE (missions #092, #094) : c'est la BASE qui décide qui règle une
// ligne. Le filtre « resolved_at is null » fait partie de la mise à jour : deux
// passages concurrents ne peuvent pas la réussir tous les deux.
export async function claimDebit(analysisId: string, resolution: PendingDebit["resolution"]): Promise<boolean> {
  try {
    const rows = await updateRows<{ analysis_id: string }>(
      "pending_debits",
      `analysis_id=eq.${encodeURIComponent(analysisId)}&resolved_at=is.null`,
      { resolved_at: new Date().toISOString(), resolution, updated_at: new Date().toISOString() },
    );
    return rows.length > 0;
  } catch (caught) {
    if (!absent(caught, "règlement")) throw caught;
    return false;
  }
}

// Une tentative de plus, pour savoir combien de fois le rattrapage est passé.
export async function countAttempt(analysisId: string, attempts: number): Promise<void> {
  try {
    await updateRows("pending_debits", `analysis_id=eq.${encodeURIComponent(analysisId)}`, {
      attempts: attempts + 1,
      updated_at: new Date().toISOString(),
    });
  } catch (caught) {
    if (!absent(caught, "tentative")) throw caught;
  }
}

// L'analyse part avec son deal (cascade) : c'est le deal qui porte le texte de
// l'offre, et le supprimer efface tout ce qui a été produit à partir d'elle.
export async function removeUndebitedAnalysis(debit: PendingDebit): Promise<void> {
  await deleteRows("deals", `id=eq.${encodeURIComponent(debit.deal_id)}`);
}
