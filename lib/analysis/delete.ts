import { viewerOwnsDeal } from "@/lib/analysis/load";
import type { SessionUser } from "@/lib/auth/session";
import { isUuid } from "@/lib/security/request";
import { deleteRows, removeDocuments, selectRows } from "@/lib/supabase/server";

// Suppression d'une analyse par la personne qui l'a lancée, avec ou sans compte.
// L'autorisation repose uniquement sur le rattachement serveur (session ou cookie
// anonyme httpOnly) : connaître l'identifiant d'une analyse ne donne aucun droit.
// Supprimés : les fichiers du stockage, puis le deal (texte source compris), ce
// qui supprime en cascade ses documents et son analyse.

type Row = { deal: { id: string; anon_token: string | null; user_id: string | null } };

export type DeleteOutcome = { deleted: true; filesRemoved: number } | { deleted: false };

export async function deleteAnalysisForViewer(
  analysisId: string,
  viewer: { user: SessionUser | null; anonToken: string | null },
): Promise<DeleteOutcome> {
  if (!isUuid(analysisId)) return { deleted: false };
  const [row] = await selectRows<Row>(
    "analyses",
    `select=deal:deals!inner(id,anon_token,user_id)&id=eq.${analysisId}&limit=1`,
  );
  // Inexistante ou appartenant à quelqu'un d'autre : même réponse.
  if (!row || !viewerOwnsDeal(row.deal, viewer)) return { deleted: false };

  const documents = await selectRows<{ storage_path: string }>(
    "deal_documents",
    `select=storage_path&deal_id=eq.${row.deal.id}`,
  );
  const removed = await removeDocuments(documents.map((d) => d.storage_path));
  await deleteRows("deals", `id=eq.${row.deal.id}`);
  console.log(JSON.stringify({ event: "analysis_deleted", files_removed: removed.length, signed_in: viewer.user !== null }));
  return { deleted: true, filesRemoved: removed.length };
}
