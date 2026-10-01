import { cookies, headers } from "next/headers";
import { isMissingColumn, selectRows } from "@/lib/supabase/server";
import { currentEnvironment, type TelemetryEnvironment } from "@/lib/telemetry/environment";
import { INTERNAL_COOKIE, internalList, internalSecret, internalTokenValid, isInternalEmail, isMeasurementAgent } from "@/lib/telemetry/internal";
import { agentFamily, clientIp, dailySalt, visitorFingerprint, type AgentFamily } from "@/lib/telemetry/visiteur";

// Mission #103 — écrire une ligne en lui attachant son environnement.
// Mission #118 — et en disant si elle vient de l'intérieur.
//
// Déploiement descendant-compatible, comme la clé d'idempotence (mission #060)
// et le montant des achats (mission #090) : le code peut précéder la migration
// qui ajoute la colonne. Dans ce cas la ligne s'écrit SANS le champ manquant
// plutôt que d'échouer devant l'utilisateur. Le repli est progressif : on ne
// renonce à l'environnement que si c'est LUI qui manque, et pas parce que
// `internal` n'existe pas encore.
//
// Le sens est volontairement prudent, dans les deux champs : en cas de doute,
// la ligne n'est jamais comptée comme production, et jamais marquée interne
// (marquer à tort effacerait du cockpit un vrai visiteur).

// Mission #131 — trois champs de diagnostic s'ajoutent, et un seul mot les
// décrit : ils servent à LIRE une ligne, jamais à décider quoi que ce soit.
// `visitor` dit si deux lignes viennent du même appareil, `internal_reason`
// pourquoi une ligne est écartée, `agent_family` d'où elle vient.
export type InternalReason = "cookie" | "compte" | "mesure";

export type TelemetryTag = {
  environment?: TelemetryEnvironment;
  internal?: boolean;
  visitor?: string | null;
  internal_reason?: InternalReason | null;
  agent_family?: AgentFamily | null;
};

// `diagnostic` : les trois colonnes de la mission #131, qui n'existent que
// sur product_events. Les quatre autres tables marquées (analyses, deals,
// purchases, analysis_feedback) ne les ont pas et n'en ont pas l'usage : les
// leur envoyer coûterait un aller-retour perdu à chaque écriture.
export async function withEnvironment<T>(
  write: (extra: TelemetryTag) => Promise<T>,
  options: { userId?: string | null; diagnostic?: boolean } = {},
): Promise<T> {
  const environment = currentEnvironment();
  const raison = await internalReason(options.userId ?? null);
  const internal = raison !== null;
  if (!options.diagnostic) return writeWithFallback(write, environment, internal);
  const diagnostic = await diagnosticTag();
  try {
    return await write({ environment, internal, internal_reason: raison, ...diagnostic });
  } catch (caught) {
    if (!isMissingColumn(caught)) throw caught;
    console.warn(JSON.stringify({ event: "telemetry_colonne_absente", champ: "diagnostic" }));
    return writeWithFallback(write, environment, internal);
  }
}

// Le repli d'origine (#103, #118), inchangé : internal d'abord, puis
// l'environnement, puis rien. Le code peut précéder sa migration.
async function writeWithFallback<T>(
  write: (extra: TelemetryTag) => Promise<T>,
  environment: TelemetryEnvironment,
  internal: boolean,
): Promise<T> {
  try {
    return await write({ environment, internal });
  } catch (caught) {
    if (!isMissingColumn(caught)) throw caught;
    console.warn(JSON.stringify({ event: "telemetry_colonne_absente", champ: "internal" }));
    try {
      return await write({ environment });
    } catch (again) {
      if (!isMissingColumn(again)) throw again;
      console.warn(JSON.stringify({ event: "telemetry_environment_colonne_absente" }));
      return write({});
    }
  }
}

// L'empreinte du jour et la famille de navigateur. Hors contexte de requête
// (webhook rejoué, tâche planifiée), il n'y a ni adresse ni agent : les deux
// champs restent vides, et c'est une information en soi.
async function diagnosticTag(): Promise<{ visitor: string | null; agent_family: AgentFamily | null }> {
  try {
    const entetes = await headers();
    const agent = entetes.get("user-agent");
    // L'adresse n'existe que dans cette expression : elle entre dans le hash
    // et n'en ressort jamais.
    return {
      visitor: visitorFingerprint(await dailySalt(), clientIp(entetes), agent),
      agent_family: agentFamily(agent),
    };
  } catch {
    return { visitor: null, agent_family: null };
  }
}

// ─── Deux sources, et une seule suffit ─────────────────────────────────────
//
// 1. LE COOKIE DE CE NAVIGATEUR (lib/telemetry/internal.ts). Sans aucune
//    entrée-sortie, et il répond même déconnecté : c'est lui qui règle le cas
//    courant, le téléphone et le PC en navigation quotidienne.
//
// 2. LE COMPTE qui écrit la ligne. Indispensable là où il n'y a pas de
//    navigateur du tout : le webhook Whop écrit l'achat et l'événement
//    purchase_completed depuis une requête de Whop, qui ne porte évidemment
//    pas mon cookie. Sans cette seconde source, un paiement de test
//    continuerait d'être compté comme un revenu réel.
// 3. LE NAVIGATEUR DE MESURE (mission #135). Il ne peut porter ni cookie ni
//    session : il vide tout avant chaque page, et le secret du cookie ne
//    sort pas de Vercel. Il s'annonce donc dans son User-Agent, et la ligne
//    est écrite comme interne plutôt que jetée — on veut pouvoir compter
//    les passages de mesure.
// Mission #131 — la source est NOMMÉE, pas seulement comptée. Sans elle, on
// ne peut pas vérifier que le marquage de #118 et le jeton de #135 font ce
// qu'on croit : une ligne écartée ressemble à une ligne absente.
export async function internalReason(userId: string | null = null): Promise<InternalReason | null> {
  if (await internalBrowser()) return "cookie";
  if (await measurementBrowser()) return "mesure";
  if (await internalAccount(userId)) return "compte";
  return null;
}

export async function internalTraffic(userId: string | null = null): Promise<boolean> {
  return (await internalReason(userId)) !== null;
}

async function measurementBrowser(): Promise<boolean> {
  try {
    return isMeasurementAgent((await headers()).get("user-agent"));
  } catch {
    // Hors du contexte d'une requête : pas d'en-tête, donc pas de mesure.
    return false;
  }
}

async function internalBrowser(): Promise<boolean> {
  try {
    const jar = await cookies();
    return internalTokenValid(jar.get(INTERNAL_COOKIE)?.value, internalSecret());
  } catch {
    // Hors du contexte d'une requête (tâche planifiée, rattrapage) : pas de
    // navigateur, donc pas de marquage par cookie. Le compte reste à lire.
    return false;
  }
}

// Le couple identifiant → appartenance, gardé en mémoire du processus pour ne
// pas relire le profil à chaque événement d'une même analyse. Une instance
// serverless vit quelques minutes ; cinq minutes de mémoire ne retardent
// l'effet d'un ajout dans la liste que d'autant.
const ACCOUNT_TTL_MS = 5 * 60 * 1000;
const ACCOUNT_CACHE_MAX = 200;
const accountCache = new Map<string, { internal: boolean; at: number }>();

export function forgetInternalAccounts(): void {
  accountCache.clear();
}

async function internalAccount(userId: string | null): Promise<boolean> {
  if (!userId) return false;
  // Aucune adresse interne configurée : rien à chercher, et aucune requête.
  if (internalList().length === 0) return false;
  const cached = accountCache.get(userId);
  const now = Date.now();
  if (cached && now - cached.at < ACCOUNT_TTL_MS) return cached.internal;
  let internal = false;
  try {
    const rows = await selectRows<{ email: string | null }>("profiles", `id=eq.${encodeURIComponent(userId)}&select=email&limit=1`);
    internal = isInternalEmail(rows[0]?.email);
  } catch {
    // Profil illisible : on ne marque pas. Une ligne de visiteur comptée est
    // moins grave qu'une ligne de visiteur effacée du cockpit.
    return false;
  }
  if (accountCache.size >= ACCOUNT_CACHE_MAX) accountCache.clear();
  accountCache.set(userId, { internal, at: now });
  return internal;
}
