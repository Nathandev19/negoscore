import { headers } from "next/headers";
import { insertIfAbsent, isMissingColumn } from "@/lib/supabase/server";
import { normalizeReferrer } from "@/lib/analytics/referrer";
import { classerVisite, type VerdictVisite } from "@/lib/analytics/robot-visite";
import { withEnvironment } from "@/lib/telemetry/tagged";

export const PRODUCT_EVENTS = [
  "landing_view", "pricing_view", "analysis_started", "analysis_completed", "feedback_submitted", "signup",
  "negotiation_started", "negotiation_turn", "negotiation_concluded", "checkout_started", "purchase_completed",
  // Mission #120 — les pages d'arrivée depuis un moteur de recherche. UN SEUL
  // nom pour les trois guides : `path` est déjà enregistré et les distingue,
  // trois noms d'événement ne diraient rien de plus et rendraient chaque
  // nouveau guide dépendant d'un changement de code.
  "guide_view", "example_view",
  // Mission #130 — le niveau choisi sur une page de résultat. Le payload
  // de l'analyse, lui, ne bouge pas : il porte la fourchette, le score et
  // la contre-offre calculés AU niveau qu'il déclare, et y réécrire le
  // niveau sans recalculer le reste rendrait la ligne fausse.
  "tier_changed",
  // Mission #157 — arrivée sur l'analyse, distincte des visites historiques.
  "analysis_page_view",
  // Mission #165 — une carte de verdict est partie. DEUX DRAPEAUX, et rien
  // d'autre : ils disent qu'une image a quitté l'appareil, par le partage
  // natif ou par un téléchargement. Jamais le montant, jamais la fourchette,
  // jamais l'analyse concernée. Ce qu'on veut savoir est « est-ce que ça
  // circule », pas « qui a partagé quoi ».
  "carte_partagee",
  "carte_telechargee",
  // Mission #209 — le comportement À L'INTÉRIEUR d'une page, une ligne par
  // page vue, émise au départ. Le funnel mesure les étapes ; celui-ci mesure
  // ce qui se passe entre deux étapes, et c'est ce qui manquait pour savoir
  // si 400 visites payantes sans analyse étaient du faux trafic ou une page
  // qui n'appelle rien. Les valeurs sont des TRANCHES, dans `metadata`.
  "page_engagement",
] as const;
export type ProductEventName = (typeof PRODUCT_EVENTS)[number];

export type Attribution = {
  path?: string | null; referrer_host?: string | null; utm_source?: string | null; utm_medium?: string | null;
  utm_campaign?: string | null; utm_content?: string | null;
};

function clean(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9._~-]+/g, "_").slice(0, max);
  // Anciennes visites /__proto__ et /constructor : avant la #113, une valeur
  // héritée de Object.prototype était convertie en texte par URLSearchParams.
  // Ces deux marqueurs ne sont jamais une attribution, même dans une URL forgée.
  if (normalized === "_object_object_" || normalized === "function_object_native_code_") return null;
  return normalized || null;
}

export function parseAttribution(value: unknown): Attribution {
  const input = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    path: typeof input.path === "string" && input.path.startsWith("/") ? input.path.slice(0, 300) : null,
    referrer_host: typeof input.referrer_host === "string" ? normalizeReferrer(input.referrer_host, "") : null,
    utm_source: clean(input.utm_source, 100), utm_medium: clean(input.utm_medium, 100),
    utm_campaign: clean(input.utm_campaign, 150), utm_content: clean(input.utm_content, 150),
  };
}

// Mission #162 — COMPLÉTER SANS JAMAIS ÉCRASER.
//
// Même règle qu'en #152 pour les liens internes : une attribution déjà là ne
// se réécrit pas. Ici, `fallback` est l'attribution relevée à la demande du
// lien de connexion ; elle ne remplit que les champs que la requête courante
// ne renseigne pas. Si la demande ne portait rien, rien n'est inventé.
export function mergeAttribution(current: Attribution | null | undefined, fallback: Attribution | null | undefined): Attribution {
  const a = current ?? {};
  const b = fallback ?? {};
  const champ = (cle: keyof Attribution) => a[cle] ?? b[cle] ?? null;
  return {
    path: champ("path"), referrer_host: champ("referrer_host"), utm_source: champ("utm_source"),
    utm_medium: champ("utm_medium"), utm_campaign: champ("utm_campaign"), utm_content: champ("utm_content"),
  };
}

// Cette attribution dit-elle quelque chose ? Une attribution dont tous les
// champs sont vides ne vaut pas la peine d'être rangée.
export function hasAttribution(value: Attribution | null | undefined): boolean {
  return value != null && Object.values(value).some((champ) => champ != null && champ !== "");
}

// Mission #213 — QUELS ÉVÉNEMENTS SONT CLASSÉS, ET POURQUOI PAS TOUS.
//
// Seules les ARRIVÉES mesurées depuis un navigateur. Deux raisons, et la
// seconde est la plus importante :
//
//   — c'est là qu'est le défaut. Le constat porte sur landing_view et sur le
//     page_engagement qui le suit ;
//   — se tromper n'y coûte pas la même chose qu'ailleurs. `recordProductEvent`
//     est aussi appelé par le webhook Whop, qui écrit `purchase_completed`
//     depuis une requête de Whop : elle porte un User-Agent de serveur, que
//     l'expression de la #120 peut très bien reconnaître comme un robot. Un
//     achat réel classé robot disparaîtrait du revenu affiché. Une liste
//     fermée rend ce cas impossible par construction, au lieu de le rendre
//     improbable.
//
// Ce que ça laisse passer, dit franchement : un robot qui lancerait une
// analyse resterait compté dans `analysis_started`. Il se verrait — un funnel
// avec zéro visite et une analyse n'a pas de lecture innocente — et le jour
// où ça arrive, c'est une valeur de plus dans cette liste.
export const ROBOT_CLASSIFIED_EVENTS = [
  "landing_view", "pricing_view", "guide_view", "example_view", "analysis_page_view", "page_engagement",
] as const satisfies ReadonlyArray<ProductEventName>;

const CLASSIFIES = new Set<string>(ROBOT_CLASSIFIED_EVENTS);

const NON_CLASSE: VerdictVisite = { robot: false, reason: null, agent_signature: null };

async function verdictPour(event: ProductEventName): Promise<VerdictVisite> {
  if (!CLASSIFIES.has(event)) return NON_CLASSE;
  try {
    return classerVisite(await headers());
  } catch {
    // Hors contexte de requête (tâche planifiée, rattrapage) : aucun
    // navigateur, donc rien à classer. Jamais robot par défaut.
    return NON_CLASSE;
  }
}

export async function recordProductEvent(input: {
  event: ProductEventName; userId?: string | null; attribution?: Attribution; entityType?: string | null;
  entityId?: string | null; metadata?: Record<string, string | number | boolean | null>; dedupeKey?: string | null;
}): Promise<void> {
  const a = parseAttribution(input.attribution);
  const referrerDomain = a.referrer_host == null ? null : normalizeReferrer(a.referrer_host, "");
  const verdict = await verdictPour(input.event);
  try {
    await withEnvironment((environment) =>
      insertEvent({
        ...environment,
        // Mission #213 — SÉPARER, PAS SUPPRIMER. La ligne est écrite comme
        // les autres ; c'est l'agrégation qui l'écarte des compteurs, et
        // l'écran qui la montre écartée. Réviser le classement ne demande
        // donc aucune donnée qu'on n'aurait plus.
        robot: verdict.robot, robot_reason: verdict.reason, agent_signature: verdict.agent_signature,
        event_name: input.event, user_id: input.userId ?? null, path: a.path ?? null, referrer_host: referrerDomain,
        ...(referrerDomain ? { referrer_domain: referrerDomain } : {}),
        utm_source: a.utm_source ?? null, utm_medium: a.utm_medium ?? null, utm_campaign: a.utm_campaign ?? null,
        utm_content: a.utm_content ?? null, entity_type: input.entityType ?? null, entity_id: input.entityId ?? null,
        metadata: input.metadata ?? {}, dedupe_key: input.dedupeKey ?? null,
      }),
      // Mission #131 — et le diagnostic (empreinte, raison, famille d'agent),
      // qui n'existe que sur cette table.
      // Mission #118 — le compte qui produit l'événement, pour les écritures
      // sans navigateur : le webhook Whop écrit purchase_completed depuis une
      // requête de Whop, qui ne porte pas le cookie interne.
      // Un événement ne porte pas d'adresse : l'appelant ne connaît qu'un
      // identifiant de compte. Le cookie de #118 couvre les navigateurs.
      { account: { id: input.userId ?? null, email: null }, diagnostic: true },
    );
  } catch (error) {
    console.error(JSON.stringify({ event: "product_telemetry_error", name: input.event, detail: error instanceof Error ? error.message.slice(0, 120) : "inconnu" }));
  }
}

async function insertEvent(row: Record<string, unknown>): Promise<void> {
  try {
    await insertIfAbsent("product_events", row);
  } catch (error) {
    // Le code peut être déployé avant que Nathan applique la migration à la
    // main. Les événements continuent alors d'être écrits, sans ces champs.
    //
    // Mission #213 — le repli se fait en DEUX temps, du plus récent au plus
    // ancien, parce que les deux migrations peuvent manquer indépendamment :
    // on retire d'abord les trois colonnes de la 43, puis `referrer_domain`
    // (la 38). Tout retirer d'un coup ferait perdre `referrer_domain` sur une
    // base où il existe, et c'est une mesure qu'on a déjà payée.
    if (!isMissingColumn(error)) throw error;
    const sansRobot = { ...row };
    delete sansRobot.robot;
    delete sansRobot.robot_reason;
    delete sansRobot.agent_signature;
    try {
      await insertIfAbsent("product_events", sansRobot);
      console.warn(JSON.stringify({ event: "telemetry_colonne_absente", champ: "robot" }));
      return;
    } catch (encore) {
      if (!isMissingColumn(encore)) throw encore;
    }
    const previousSchema = { ...sansRobot };
    delete previousSchema.referrer_domain;
    await insertIfAbsent("product_events", previousSchema);
  }
}
