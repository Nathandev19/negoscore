import { deleteRowsReturning, removeDocuments, selectRows } from "@/lib/supabase/server";

// Purge quotidienne des données dont la durée de conservation est écoulée,
// telle qu'annoncée dans la politique de confidentialité :
//   - documents déposés : 30 jours (lignes deal_documents ET fichiers du bucket) ;
//   - adresses IP hachées (usage_guard) : 30 jours au maximum ;
//   - journal des paiements (whop_events) et preuves de consentement : 5 ans.
// Les deals et les analyses ne sont JAMAIS supprimés ici : seuls les documents
// source ont une durée de 30 jours. Idempotente : un second passage ne trouve rien.

const DAY_MS = 24 * 60 * 60 * 1000;
export const DOCUMENT_RETENTION_DAYS = 30;
export const IP_HASH_RETENTION_DAYS = 30;
export const PAYMENT_RECORD_RETENTION_YEARS = 5;
const BATCH = 200;

export type PurgeReport = {
  documents: number;
  files_removed: number;
  usage_guard: number;
  whop_events: number;
  checkout_consents: number;
};

export function purgeCutoffs(now: Date) {
  const years = new Date(now);
  years.setUTCFullYear(years.getUTCFullYear() - PAYMENT_RECORD_RETENTION_YEARS);
  return {
    documents: new Date(now.getTime() - DOCUMENT_RETENTION_DAYS * DAY_MS).toISOString(),
    usageGuard: new Date(now.getTime() - IP_HASH_RETENTION_DAYS * DAY_MS).toISOString(),
    paymentRecords: years.toISOString(),
  };
}

// Fichiers d'abord, puis lignes : une ligne supprimée ne permettrait plus de
// retrouver son fichier. Par lots, jusqu'à épuisement.
async function purgeDocuments(cutoff: string): Promise<{ documents: number; filesRemoved: number }> {
  let documents = 0;
  let filesRemoved = 0;
  for (;;) {
    const rows = await selectRows<{ id: string; storage_path: string }>(
      "deal_documents",
      `select=id,storage_path&created_at=lt.${encodeURIComponent(cutoff)}&order=created_at.asc&limit=${BATCH}`,
    );
    if (rows.length === 0) break;
    filesRemoved += (await removeDocuments(rows.map((row) => row.storage_path))).length;
    const deleted = await deleteRowsReturning("deal_documents", `id=in.(${rows.map((row) => row.id).join(",")})`, "id");
    documents += deleted.length;
    if (rows.length < BATCH) break;
  }
  return { documents, filesRemoved };
}

export async function runPurge(now: Date = new Date()): Promise<PurgeReport> {
  const cutoffs = purgeCutoffs(now);
  const { documents, filesRemoved } = await purgeDocuments(cutoffs.documents);
  // Une fenêtre de limitation dure au plus 24 h : une ligne dont la fenêtre a
  // commencé il y a plus de 30 jours n'est plus utilisée.
  const usageGuard = await deleteRowsReturning(
    "usage_guard",
    `window_start=lt.${encodeURIComponent(cutoffs.usageGuard)}`,
    "id",
  );
  // whop_events n'a pas de date de réception : processed_at, posé au
  // traitement de l'événement, en tient lieu.
  const whopEvents = await deleteRowsReturning(
    "whop_events",
    `processed_at=lt.${encodeURIComponent(cutoffs.paymentRecords)}`,
    "event_id",
  );
  const consents = await deleteRowsReturning(
    "checkout_consents",
    `created_at=lt.${encodeURIComponent(cutoffs.paymentRecords)}`,
    "id",
  );

  return {
    documents,
    files_removed: filesRemoved,
    usage_guard: usageGuard.length,
    whop_events: whopEvents.length,
    checkout_consents: consents.length,
  };
}
