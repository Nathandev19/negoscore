import { deleteRowsReturning, removeDocuments, selectRows, SupabaseRequestError, updateRows } from "@/lib/supabase/server";
import { purgeLoginClaims } from "@/lib/auth/login-claims";

// Purge quotidienne des données dont la durée de conservation est écoulée,
// telle qu'annoncée dans la politique de confidentialité :
//   - documents déposés : 30 jours (lignes deal_documents ET fichiers du bucket) ;
//   - texte collé des offres (deals.raw_text) : 30 jours, remplacé par NULL ;
//     le deal et son analyse restent consultables ;
//   - analyses lancées sans compte : 30 jours, deal et analyse supprimés ;
//   - adresses IP hachées (usage_guard) : 30 jours au maximum ;
//   - journal des paiements (whop_events) et preuves de consentement : 5 ans.
// Les deals et les analyses ne sont JAMAIS supprimés ici : seule la matière
// première (documents et texte collé) a une durée de 30 jours. Idempotente :
// un second passage ne trouve rien.

const DAY_MS = 24 * 60 * 60 * 1000;
// Durées annoncées : 30 jours. La purge tourne une fois par jour : en supprimant
// dès 29 jours, une donnée ne vit jamais plus de 30 jours, quel que soit le
// moment de la journée où le cron passe.
export const DOCUMENT_RETENTION_DAYS = 30;
export const DOCUMENT_PURGE_AFTER_DAYS = 29;
export const SOURCE_TEXT_RETENTION_DAYS = 30;
export const SOURCE_TEXT_PURGE_AFTER_DAYS = 29;
export const IP_HASH_RETENTION_DAYS = 30;
export const IP_HASH_PURGE_AFTER_DAYS = 29;
export const PAYMENT_RECORD_RETENTION_YEARS = 5;
// Analyses lancées sans compte (mission #061) : le navigateur qui les a lancées
// n'y a accès que 30 jours (durée du cookie deal_anon_token). Passé ce délai,
// personne ne peut plus les consulter ni les supprimer, alors qu'elles portent
// la marque, les montants et parfois le prénom d'un tiers. Elles sont donc
// supprimées, deal compris — jamais celles rattachées à un compte.
export const ANON_ANALYSIS_RETENTION_DAYS = 30;
export const ANON_ANALYSIS_PURGE_AFTER_DAYS = 29;
const BATCH = 200;

// Portée explicite : quand elle est fournie, SEULES les lignes désignées sont
// considérées, catégorie par catégorie ; une catégorie absente de la portée
// n'est pas purgée du tout. Sert aux tests d'intégration, qui tournent sur la
// base de production et ne doivent toucher que les lignes qu'ils ont créées.
// Sans portée, la purge porte sur toute la base (appel quotidien du cron).
export type PurgeScope = {
  documentIds?: string[];
  // Deals dont le texte collé peut être effacé.
  sourceTextDealIds?: string[];
  // Deals sans compte, supprimés en entier au bout de 30 jours.
  anonDealIds?: string[];
  usageGuardIds?: string[];
  whopEventIds?: string[];
  consentIds?: string[];
  // Réclamations de connexion (mission #067).
  loginClaimIds?: string[];
};

export type PurgeReport = {
  documents: number;
  files_removed: number;
  source_texts: number;
  anon_analyses: number;
  usage_guard: number;
  whop_events: number;
  checkout_consents: number;
  login_claims: number;
};

export function purgeCutoffs(now: Date) {
  const years = new Date(now);
  years.setUTCFullYear(years.getUTCFullYear() - PAYMENT_RECORD_RETENTION_YEARS);
  return {
    documents: new Date(now.getTime() - DOCUMENT_PURGE_AFTER_DAYS * DAY_MS).toISOString(),
    sourceTexts: new Date(now.getTime() - SOURCE_TEXT_PURGE_AFTER_DAYS * DAY_MS).toISOString(),
    usageGuard: new Date(now.getTime() - IP_HASH_PURGE_AFTER_DAYS * DAY_MS).toISOString(),
    anonAnalyses: new Date(now.getTime() - ANON_ANALYSIS_PURGE_AFTER_DAYS * DAY_MS).toISOString(),
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

  // Texte collé : effacé, jamais le deal ni son analyse. Le filtre raw_text non
  // nul rend l'opération idempotente.
  const textScope = scopeFilter(scope, scope?.sourceTextDealIds, "id");
  const sourceTexts =
    textScope === null
      ? []
      : await updateRows<{ id: string }>(
          "deals",
          `raw_text=not.is.null&created_at=lt.${encodeURIComponent(cutoffs.sourceTexts)}${textScope}&select=id`,
          { raw_text: null },
        );

  // Une fenêtre de limitation dure au plus 24 h : une ligne dont la fenêtre a
  // commencé il y a plus de 30 jours n'est plus utilisée.
  const guardScope = scopeFilter(scope, scope?.usageGuardIds, "id");
  const usageGuard =
    guardScope === null
      ? []
      : await deleteRowsReturning("usage_guard", `window_start=lt.${encodeURIComponent(cutoffs.usageGuard)}${guardScope}`, "id");

  // Analyses sans compte : le deal part en entier, l'analyse suit en cascade.
  // Les fichiers déposés ont déjà été retirés du stockage par la purge des
  // documents ci-dessus : un document est toujours créé avant son deal, il est
  // donc toujours plus vieux que la même limite. Les deals rattachés à un
  // compte ne sont jamais touchés (user_id=is.null).
  const anonScope = scopeFilter(scope, scope?.anonDealIds, "id");
  const anonDeals =
    anonScope === null
      ? []
      : await deleteRowsReturning(
          "deals",
          `user_id=is.null&created_at=lt.${encodeURIComponent(cutoffs.anonAnalyses)}${anonScope}`,
          "id",
        );

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

  // Réclamations de connexion expirées (mission #067) : elles ne servent plus
  // à rien passé 2 heures, et portent une adresse email et un jeton anonyme.
  const claimScope = scopeFilter(scope, scope?.loginClaimIds, "id");
  const loginClaims = claimScope === null ? [] : await purgeLoginClaims(now, claimScope);

  return {
    documents,
    files_removed: filesRemoved,
    source_texts: sourceTexts.length,
    anon_analyses: anonDeals.length,
    usage_guard: usageGuard.length,
    whop_events: whopEvents.length,
    checkout_consents: consents.length,
    login_claims: loginClaims.length,
  };
}
