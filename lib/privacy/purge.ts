import { deleteRowsReturning, removeDocuments, selectRows, SupabaseRequestError } from "@/lib/supabase/server";

// Purge quotidienne des données dont la durée de conservation est écoulée,
// telle qu'annoncée dans la politique de confidentialité :
//   - documents déposés : 30 jours (lignes deal_documents ET fichiers du bucket) ;
//   - adresses IP hachées (usage_guard) : 30 jours au maximum ;
//   - journal des paiements (whop_events) et preuves de consentement : 5 ans.
// Les deals et les analyses ne sont JAMAIS supprimés ici : seuls les documents
// source ont une durée de 30 jours. Idempotente : un second passage ne trouve rien.

const DAY_MS = 24 * 60 * 60 * 1000;
// Durée annoncée : 30 jours. La purge tourne une fois par jour : en supprimant
// dès 29 jours, un document ne vit jamais plus de 30 jours.
export const DOCUMENT_RETENTION_DAYS = 30;
export const DOCUMENT_PURGE_AFTER_DAYS = 29;
export const IP_HASH_RETENTION_DAYS = 30;
export const PAYMENT_RECORD_RETENTION_YEARS = 5;
const BATCH = 200;

// Portée explicite : quand elle est fournie, SEULES les lignes désignées sont
// considérées, catégorie par catégorie ; une catégorie absente de la portée
// n'est pas purgée du tout. Sert aux tests d'intégration, qui tournent sur la
// base de production et ne doivent toucher que les lignes qu'ils ont créées.
// Sans portée, la purge porte sur toute la base (appel quotidien du cron).
export type PurgeScope = {
  documentIds?: string[];
  usageGuardIds?: string[];
  whopEventIds?: string[];
  consentIds?: string[];
};

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
    documents: new Date(now.getTime() - DOCUMENT_PURGE_AFTER_DAYS * DAY_MS).toISOString(),
    usageGuard: new Date(now.getTime() - IP_HASH_RETENTION_DAYS * DAY_MS).toISOString(),
    paymentRecords: years.toISOString(),
  };
}

// Filtre PostgREST limitant une requête à la portée. null : rien à considérer.
export function scopeFilter(scope: PurgeScope | undefined, ids: string[] | undefined, column: string): string | null {
  if (!scope) return "";
  if (!ids || ids.length === 0) return null;
  return `&${column}=in.(${ids.map((id) => `"${id.replace(/"/g, "")}"`).join(",")})`;
}

// Fichiers d'abord, puis lignes : une ligne supprimée ne permettrait plus de
// retrouver son fichier. Par lots, jusqu'à épuisement.
async function purgeDocuments(cutoff: string, restrict: string): Promise<{ documents: number; filesRemoved: number }> {
  let documents = 0;
  let filesRemoved = 0;
  for (;;) {
    const rows = await selectRows<{ id: string; storage_path: string }>(
      "deal_documents",
      `select=id,storage_path&created_at=lt.${encodeURIComponent(cutoff)}${restrict}&order=created_at.asc&limit=${BATCH}`,
    );
    if (rows.length === 0) break;
    filesRemoved += (await removeDocuments(rows.map((row) => row.storage_path))).length;
    const deleted = await deleteRowsReturning("deal_documents", `id=in.(${rows.map((row) => row.id).join(",")})`, "id");
    documents += deleted.length;
    if (rows.length < BATCH) break;
  }
  return { documents, filesRemoved };
}

// Événement échu : traité il y a plus de 5 ans, ou jamais traité et reçu il y a
// plus de 5 ans, soit coalesce(processed_at, received_at) < limite.
export function whopEventsExpiredFilter(cutoff: string): string {
  return `or=${encodeURIComponent(`(processed_at.lt."${cutoff}",and(processed_at.is.null,received_at.lt."${cutoff}"))`)}`;
}

// Colonne absente (migration 013 non appliquée) : code PostgreSQL 42703.
function isMissingColumn(caught: unknown): boolean {
  return caught instanceof SupabaseRequestError && (caught.code === "42703" || /received_at/.test(caught.message));
}

async function purgeWhopEvents(cutoff: string, restrict: string): Promise<string[]> {
  try {
    return await deleteRowsReturning("whop_events", `${whopEventsExpiredFilter(cutoff)}${restrict}`, "event_id");
  } catch (caught) {
    if (!isMissingColumn(caught)) throw caught;
    // Avant la migration : seuls les événements traités peuvent être datés.
    console.warn(
      JSON.stringify({
        event: "purge_whop_received_at_missing",
        detail: "Colonne whop_events.received_at absente : appliquer la migration 20260917000013. Événements jamais traités non purgés.",
      }),
    );
    return deleteRowsReturning("whop_events", `processed_at=lt.${encodeURIComponent(cutoff)}${restrict}`, "event_id");
  }
}

export async function runPurge(now: Date = new Date(), scope?: PurgeScope): Promise<PurgeReport> {
  const cutoffs = purgeCutoffs(now);

  const documentScope = scopeFilter(scope, scope?.documentIds, "id");
  const { documents, filesRemoved } =
    documentScope === null ? { documents: 0, filesRemoved: 0 } : await purgeDocuments(cutoffs.documents, documentScope);

  // Une fenêtre de limitation dure au plus 24 h : une ligne dont la fenêtre a
  // commencé il y a plus de 30 jours n'est plus utilisée.
  const guardScope = scopeFilter(scope, scope?.usageGuardIds, "id");
  const usageGuard =
    guardScope === null
      ? []
      : await deleteRowsReturning("usage_guard", `window_start=lt.${encodeURIComponent(cutoffs.usageGuard)}${guardScope}`, "id");

  const eventScope = scopeFilter(scope, scope?.whopEventIds, "event_id");
  const whopEvents = eventScope === null ? [] : await purgeWhopEvents(cutoffs.paymentRecords, eventScope);

  const consentScope = scopeFilter(scope, scope?.consentIds, "id");
  const consents =
    consentScope === null
      ? []
      : await deleteRowsReturning(
          "checkout_consents",
          `created_at=lt.${encodeURIComponent(cutoffs.paymentRecords)}${consentScope}`,
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
