import { deleteRowsReturning, removeDocuments, selectRows, SupabaseRequestError, updateRows } from "@/lib/supabase/server";
import { purgeLoginClaims } from "@/lib/auth/login-claims";

// Purge quotidienne des données dont la durée de conservation est écoulée,
// telle qu'annoncée dans la politique de confidentialité :
//   - documents déposés : 30 jours (lignes deal_documents ET fichiers du bucket) ;
//   - texte collé des offres (deals.raw_text) : 30 jours, remplacé par NULL ;
//   - réponses de marque collées (negotiation_turns.brand_reply, mission #080) :
//     30 jours, remplacées par NULL ; le tour et ce qui en a été tiré restent ;
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

// Mission #131 — LE SEL DU JOUR, ET LES COLONNES DE DIAGNOSTIC.
//
// Le sel sert à calculer l'empreinte d'un appareil pour UNE journée. On garde
// celui d'hier le temps qu'une journée se termine partout (fuseaux, écritures
// en retard), et pas un jour de plus : une fois le sel détruit, plus rien ne
// peut relier deux journées, y compris pour nous. C'est ce qui rend
// l'empreinte acceptable sans bandeau de consentement.
export const SALT_RETENTION_DAYS = 2;

// L'empreinte, la raison d'exclusion et la famille de navigateur ne servent
// qu'au diagnostic RÉCENT : « ce +1 d'hier, c'est qui ». Passé une semaine, la
// question ne se pose plus, et le sel qui donnait un sens à l'empreinte
// n'existe de toute façon plus. Les compteurs du cockpit, eux, ne lisent
// aucune de ces trois colonnes : les effacer ne change pas un chiffre.
export const EVENT_DIAGNOSTIC_RETENTION_DAYS = 7;
// Analyses lancées sans compte (mission #061) : le navigateur qui les a lancées
// n'y a accès que 30 jours (durée du cookie deal_anon_token). Passé ce délai,
// personne ne peut plus les consulter ni les supprimer, alors qu'elles portent
// la marque, les montants et parfois le prénom d'un tiers. Elles sont donc
// supprimées, deal compris — jamais celles rattachées à un compte.
export const ANON_ANALYSIS_RETENTION_DAYS = 30;
export const ANON_ANALYSIS_PURGE_AFTER_DAYS = 29;

// Mission #209 quater — LES RELEVÉS D'AUDIENCE, 13 MOIS.
//
// Avant cette mission, AUCUNE ligne de product_events n'était jamais
// supprimée : la purge n'y effaçait que trois colonnes de diagnostic
// (EVENT_DIAGNOSTIC_RETENTION_DAYS ci-dessus). Les visites, les vues de page
// et, depuis la #209, les relevés de comportement en page étaient donc gardés
// indéfiniment, sans qu'aucune durée ne soit annoncée nulle part.
//
// D'OÙ SORT LE CHIFFRE DE 13 MOIS, pour que le prochain qui lise n'ait pas à
// le deviner. Les deux durées qui circulent n'ont PAS le même statut, et la
// page de la CNIL sur les outils de mesure d'audience est nette là-dessus :
//
//   25 mois  est un MAXIMUM : les informations collectées doivent être
//            conservées « pour une durée maximale de vingt-cinq mois ».
//   13 mois  n'est PAS un plafond. La CNIL recommande que la durée de vie des
//            traceurs soit « limitée à une durée permettant une comparaison
//            pertinente des audiences dans le temps », « comme c'est le cas
//            d'une durée de treize mois ». C'est l'ILLUSTRATION d'un critère
//            qualitatif, pas une règle chiffrée.
//
// Les deux sont des RECOMMANDATIONS, distinctes des CONDITIONS d'exemption de
// consentement — finalité limitée à la seule mesure d'audience, pour le compte
// exclusif de l'éditeur, statistiques anonymes, aucun recoupement avec un
// autre traitement, aucun suivi global de la navigation. Ces conditions-là,
// notre mesure les tient.
//
// CE QUE LA SOURCE NE DIT PAS, et il faut le savoir avant de s'appuyer
// dessus : cette page ne traite pas le cas où AUCUN traceur n'est déposé. Tous
// ses critères portent sur des traceurs écrits dans le terminal, et notre
// mesure n'en pose aucun — ni cookie, ni stockage local (voir
// components/analytics/page-engagement.tsx). On ne prétend donc pas appliquer
// une obligation qui nous viserait : on retient la PLUS COURTE des deux durées
// citées, par minimisation. Une donnée qu'on ne garde pas est une donnée qu'on
// ne peut pas perdre.
export const EVENT_RETENTION_MONTHS = 13;

const BATCH = 200;

// PLAFOND PAR PASSAGE. La purge est quotidienne et idempotente : une table en
// retard se rattrape en plusieurs nuits, et jamais en une seule rafale.
//
// L'idempotence n'est pas un luxe ici : la documentation de Vercel écrit que
// la livraison d'un cron est « best effort », qu'un passage peut être SAUTÉ
// sans même laisser de trace dans les journaux, que le même passage peut être
// invoqué DEUX FOIS, et elle demande en toutes lettres des opérations
// idempotentes. Deux passages simultanés ne peuvent ici que lire les mêmes
// identifiants et en supprimer chacun une part : le second n'en retrouve pas,
// et le compte du rapport reste juste.
//
// Ça n'est pas une précaution abstraite : product_events n'a jamais été purgée
// depuis son premier jour, donc le PREMIER passage après cette mission est le
// seul qui puisse trouver beaucoup de lignes d'un coup. Le plafond borne ce
// passage-là, et le rapport dit s'il a été atteint — sinon on ne saurait pas
// qu'il reste du travail.
export const EVENT_PURGE_MAX_PER_RUN = 20 * BATCH;

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
  // Tours de négociation dont la réponse collée peut être effacée (mission #080).
  brandReplyTurnIds?: string[];
  // Relevés d'audience supprimables au bout de 13 mois (mission #209 quater).
  productEventIds?: string[];
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
  brand_replies: number;
  salts: number;
  event_diagnostic: number;
  // Lignes de product_events supprimées, et si le plafond du passage a été
  // atteint — auquel cas il en reste, et le passage du lendemain les prendra.
  product_events: number;
  product_events_plafonne: boolean;
};

export function purgeCutoffs(now: Date) {
  const years = new Date(now);
  years.setUTCFullYear(years.getUTCFullYear() - PAYMENT_RECORD_RETENTION_YEARS);
  const months = new Date(now);
  months.setUTCMonth(months.getUTCMonth() - EVENT_RETENTION_MONTHS);
  return {
    documents: new Date(now.getTime() - DOCUMENT_PURGE_AFTER_DAYS * DAY_MS).toISOString(),
    sourceTexts: new Date(now.getTime() - SOURCE_TEXT_PURGE_AFTER_DAYS * DAY_MS).toISOString(),
    usageGuard: new Date(now.getTime() - IP_HASH_PURGE_AFTER_DAYS * DAY_MS).toISOString(),
    anonAnalyses: new Date(now.getTime() - ANON_ANALYSIS_PURGE_AFTER_DAYS * DAY_MS).toISOString(),
    paymentRecords: years.toISOString(),
    salts: new Date(now.getTime() - SALT_RETENTION_DAYS * DAY_MS).toISOString().slice(0, 10),
    eventDiagnostic: new Date(now.getTime() - EVENT_DIAGNOSTIC_RETENTION_DAYS * DAY_MS).toISOString(),
    // 13 mois MOINS UN JOUR d'âge, donc une limite d'un jour PLUS RÉCENTE que
    // « il y a 13 mois ». Le sens compte, et il est contre-intuitif : on
    // supprime ce qui est plus vieux que la limite, donc reculer la limite
    // ferait vivre les lignes PLUS longtemps. C'est l'erreur que la première
    // écriture contenait, et le test l'a attrapée.
    //
    // Pourquoi un jour d'avance : la purge ne passe qu'une fois par jour. En
    // coupant à 13 mois moins un jour, une ligne ne vit jamais PLUS de
    // 13 mois, quelle que soit l'heure du passage. Même raisonnement que les
    // 29 jours des durées de 30 ci-dessus.
    productEvents: new Date(months.getTime() + DAY_MS).toISOString(),
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

async function purgeBrandReplies(cutoff: string, restrict: string): Promise<Array<{ id: string }>> {
  try {
    return await updateRows<{ id: string }>(
      "negotiation_turns",
      `brand_reply=not.is.null&created_at=lt.${encodeURIComponent(cutoff)}${restrict}&select=id`,
      { brand_reply: null },
    );
  } catch (caught) {
    if (caught instanceof SupabaseRequestError && (caught.status === 404 || caught.code === "42P01" || caught.code === "PGRST205")) return [];
    throw caught;
  }
}

// Mission #209 quater — LES RELEVÉS D'AUDIENCE ÉCHUS.
//
// LE GARDE-FOU N'EST PAS UN CONTRÔLE, C'EST LA FORME DE L'OPÉRATION : on ne
// supprime QUE des identifiants qu'on vient de lire AVEC la limite de date.
// Aucun DELETE ne porte une condition de date — ils portent une liste d'id —
// donc aucun ne peut emporter une ligne qui n'a pas été vue comme échue.
// Un filtre de date oublié dans un DELETE supprimerait la table ; ici, un
// filtre de date oublié dans le SELECT ne supprime rien de plus que ce que le
// SELECT a rendu, et le test le vérifie ligne par ligne.
//
// Par lots de BATCH, et sous plafond par passage : voir
// EVENT_PURGE_MAX_PER_RUN. Idempotente — un second passage ne trouve rien.
async function purgeProductEvents(
  cutoff: string,
  restrict: string,
): Promise<{ supprimes: number; plafonne: boolean }> {
  let supprimes = 0;
  for (;;) {
    if (supprimes >= EVENT_PURGE_MAX_PER_RUN) return { supprimes, plafonne: true };
    const rows = await selectRows<{ id: string }>(
      "product_events",
      `select=id&occurred_at=lt.${encodeURIComponent(cutoff)}${restrict}&order=occurred_at.asc&limit=${BATCH}`,
    );
    if (rows.length === 0) break;
    const deleted = await deleteRowsReturning(
      "product_events",
      `id=in.(${rows.map((row) => row.id).join(",")})`,
      "id",
    );
    // UN LOT QUI N'AVANCE PAS ARRÊTE LA BOUCLE.
    //
    // Trouvé par la batterie de mutation, et c'est le défaut le plus sérieux
    // de la première écriture : en remplaçant la liste d'identifiants par une
    // condition de date mal formée, la suppression ne retirait plus rien, la
    // lecture suivante rendait LES MÊMES lignes, et la boucle tournait sans
    // fin. En production, ça n'aurait pas supprimé une ligne de trop — ça
    // aurait fait tourner le cron jusqu'à ce que l'hébergeur le coupe, sans
    // rapport et sans trace de ce qui n'allait pas.
    //
    // Une boucle qui ne peut plus progresser doit s'arrêter et le dire.
    if (deleted.length === 0) {
      console.warn(
        JSON.stringify({
          event: "purge_product_events_sans_progres",
          detail: `${rows.length} ligne(s) lue(s) comme échues, aucune supprimée : la purge s'arrête plutôt que de boucler.`,
        }),
      );
      return { supprimes, plafonne: false };
    }
    supprimes += deleted.length;
    if (rows.length < BATCH) break;
  }
  return { supprimes, plafonne: false };
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

  // Réponses de marque collées (mission #080) : même durée que le texte des
  // offres, même règle. Table absente (migration 022 non appliquée) : rien à
  // effacer.
  const replyScope = scopeFilter(scope, scope?.brandReplyTurnIds, "id");
  const brandReplies = replyScope === null ? [] : await purgeBrandReplies(cutoffs.sourceTexts, replyScope);

  // Mission #131 — le sel d'avant-hier, et le diagnostic d'il y a plus d'une
  // semaine. Les deux tolèrent l'absence : tant que la migration
  // 20261002000036 n'est pas appliquée, il n'y a ni table ni colonnes, et la
  // purge ne doit pas échouer pour autant.
  const saltScope = scopeFilter(scope, undefined, "day");
  const salts =
    scope !== undefined || saltScope === null
      ? []
      : await deleteRowsReturning("telemetry_salts", `day=lt.${encodeURIComponent(cutoffs.salts)}`, "day").catch(() => []);

  const diagnostic =
    scope !== undefined
      ? []
      : await updateRows<{ id: string }>(
          "product_events",
          `visitor=not.is.null&occurred_at=lt.${encodeURIComponent(cutoffs.eventDiagnostic)}&select=id`,
          { visitor: null, internal_reason: null, agent_family: null },
        ).catch(() => []);

  // Les relevés d'audience échus. En DERNIER : les colonnes de diagnostic
  // ci-dessus sont effacées sur des lignes qui restent, ce qui n'a de sens que
  // si on ne vient pas de les supprimer.
  const relevesScope = scopeFilter(scope, scope?.productEventIds, "id");
  const releves =
    relevesScope === null
      ? { supprimes: 0, plafonne: false }
      : await purgeProductEvents(cutoffs.productEvents, relevesScope);

  return {
    documents,
    files_removed: filesRemoved,
    source_texts: sourceTexts.length,
    anon_analyses: anonDeals.length,
    usage_guard: usageGuard.length,
    whop_events: whopEvents.length,
    checkout_consents: consents.length,
    login_claims: loginClaims.length,
    brand_replies: brandReplies.length,
    salts: salts.length,
    event_diagnostic: diagnostic.length,
    product_events: releves.supprimes,
    product_events_plafonne: releves.plafonne,
  };
}
