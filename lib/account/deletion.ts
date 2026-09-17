import { signOut, type SessionUser } from "@/lib/auth/session";
import { isCancelled, isProActive, type PlanState } from "@/lib/billing/plan-access";
import {
  countRows,
  deleteAuthUser,
  deleteRows,
  removeDocuments,
  rpc,
  selectRows,
  SupabaseRequestError,
} from "@/lib/supabase/server";

// Suppression définitive d'un compte, à la demande de l'utilisateur.
//
// SUPPRIMÉ : l'identité Supabase Auth, le profil, les deals, les documents
// (lignes et fichiers du stockage), les analyses, la ligne de crédits.
// CONSERVÉ : whop_events et checkout_consents, qui documentent des
// transactions commerciales (obligation légale de conservation).

export const DELETION_CONFIRMATION_WORD = "SUPPRIMER";

export type DeletionBlocker = "pro_active" | "consents_unprotected";
export type DeletionResult = { deleted: true; removedFiles: number } | { deleted: false; blocker: DeletionBlocker };

// Saisie active : le mot exact, sans tenir compte de la casse ni des espaces autour.
export function isDeletionConfirmed(value: unknown): boolean {
  return typeof value === "string" && value.trim().toUpperCase() === DELETION_CONFIRMATION_WORD;
}

// Un abonnement Pro actif et non résilié serait encore prélevé : on ne
// supprime pas le compte qui le porte. Un Pro déjà résilié ne sera plus
// prélevé ; seul l'accès restant jusqu'à la fin de période est perdu.
export function deletionBlocker(credits: PlanState | null, now: Date = new Date()): "pro_active" | null {
  return isProActive(credits, now) && !isCancelled(credits) ? "pro_active" : null;
}

// Vrai quand la migration qui retire la cascade vers auth.users est appliquée.
async function consentsSurviveDeletion(): Promise<boolean> {
  try {
    return (await rpc<boolean>("checkout_consents_survive_account_deletion", {})) === true;
  } catch (caught) {
    // Fonction absente : migration non appliquée, les consentements partiraient en cascade.
    if (caught instanceof SupabaseRequestError && caught.status === 404) return false;
    throw caught;
  }
}

export async function deleteAccount(user: SessionUser, accessToken: string | null): Promise<DeletionResult> {
  const [credits] = await selectRows<PlanState>(
    "credits",
    `select=plan,balance,period_end,cancelled_at&user_id=eq.${user.id}&limit=1`,
  );
  const blocker = deletionBlocker(credits ?? null);
  if (blocker) return { deleted: false, blocker };

  // Jamais de preuve de consentement perdue : tant que la base les supprimerait
  // avec l'identité, un compte qui en a n'est pas supprimé.
  const consents = await countRows("checkout_consents", `select=id&user_id=eq.${user.id}`);
  if (consents > 0 && !(await consentsSurviveDeletion())) {
    return { deleted: false, blocker: "consents_unprotected" };
  }

  // 1. Fichiers du stockage d'abord : une ligne supprimée ne permettrait plus
  //    de retrouver le fichier.
  const documents = await selectRows<{ storage_path: string }>(
    "deal_documents",
    `select=storage_path,deal:deals!inner(user_id)&deal.user_id=eq.${user.id}`,
  );
  const removed = await removeDocuments(documents.map((d) => d.storage_path));

  // 2. Données du compte. Les documents et les analyses partent avec leurs deals.
  await deleteRows("deals", `user_id=eq.${user.id}`);
  await deleteRows("credits", `user_id=eq.${user.id}`);
  await deleteRows("profiles", `id=eq.${user.id}`);

  // 3. Sessions révoquées, puis identité supprimée : un jeton encore en
  //    circulation ne correspond plus à aucun utilisateur.
  if (accessToken) await signOut(accessToken);
  await deleteAuthUser(user.id);

  console.log(
    JSON.stringify({ event: "account_deleted", documents: documents.length, files_removed: removed.length, consents_kept: consents }),
  );
  return { deleted: true, removedFiles: removed.length };
}
