import type { SessionUser } from "@/lib/auth/session";
import { DEFAULT_TIER, latestTierChoice, parseTier, parseTierCookie, TIER_COOKIE, type Tier, type TierChoice } from "@/lib/rates/tier";
import { readCookie } from "@/lib/security/request";
import { isMissingColumn, isMissingRelation, selectRows, updateRows } from "@/lib/supabase/server";

// Niveau mémorisé pour les analyses suivantes (missions #039 et #065). Une
// préférence de personne, pas une donnée sensible, gardée à deux endroits :
//   - tout navigateur, avec ou sans compte : cookie negoscore_niveau, écrit par
//     le sélecteur lui-même, avec le moment du choix ;
//   - compte connecté : profiles.rate_tier et profiles.rate_tier_at (migration
//     20260918000020), pour la retrouver sur un autre appareil.
// C'est le choix le PLUS RÉCENT qui gagne, où qu'il soit rangé (#065). Avant,
// le compte passait toujours devant le cookie : un niveau ancien resté sur le
// compte (POST perdu, choix fait déconnecté) écrasait un choix plus récent.
//
// L'analyse elle-même garde le niveau avec lequel elle a été calculée : rien
// ici ne touche une analyse existante.

function warnMissing(operation: string, column: string) {
  console.warn(
    JSON.stringify({
      event: "rate_tier_missing",
      operation,
      detail: `Colonne profiles.${column} absente : appliquer la migration qui l'ajoute.`,
    }),
  );
}

function stampOf(value: string | null | undefined): number {
  const at = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(at) && at > 0 ? at : 0;
}

export async function readAccountTier(userId: string): Promise<TierChoice | null> {
  try {
    const [row] = await selectRows<{ rate_tier: string | null; rate_tier_at: string | null }>(
      "profiles",
      `select=rate_tier,rate_tier_at&id=eq.${userId}&limit=1`,
    );
    const tier = parseTier(row?.rate_tier);
    return tier ? { tier, at: stampOf(row?.rate_tier_at) } : null;
  } catch (caught) {
    if (!isMissingColumn(caught) && !isMissingRelation(caught)) throw caught;
  }
  // rate_tier_at absente (migration 020 non appliquée) : le niveau sans date.
  try {
    const [row] = await selectRows<{ rate_tier: string | null }>("profiles", `select=rate_tier&id=eq.${userId}&limit=1`);
    warnMissing("read", "rate_tier_at");
    const tier = parseTier(row?.rate_tier);
    return tier ? { tier, at: 0 } : null;
  } catch (caught) {
    if (!isMissingColumn(caught) && !isMissingRelation(caught)) throw caught;
    warnMissing("read", "rate_tier");
    return null;
  }
}

// « saved » : écrit. « stale » : rien d'écrit, le compte porte déjà un choix
// plus récent (deux onglets, requêtes arrivées dans le désordre). « missing » :
// colonne absente.
export type SaveOutcome = "saved" | "stale" | "missing";

// Le moment du choix vient du navigateur qui l'a fait : c'est la même horloge
// que celle du cookie. Un moment dans le futur est ramené à maintenant, pour
// qu'une horloge en avance ne fige pas un choix contre tous les suivants.
export async function saveAccountTier(userId: string, tier: Tier, at: number = Date.now()): Promise<SaveOutcome> {
  const when = new Date(Math.min(Math.max(at, 1), Date.now())).toISOString();
  try {
    // Écriture conditionnelle : seulement si le compte n'a pas de choix daté,
    // ou un choix plus ancien. Valeur entre guillemets : elle contient « . » et
    // « : », réservés dans les filtres PostgREST.
    const rows = await updateRows(
      "profiles",
      `id=eq.${userId}&or=(rate_tier_at.is.null,rate_tier_at.lt.%22${encodeURIComponent(when)}%22)`,
      { rate_tier: tier, rate_tier_at: when },
    );
    return rows.length > 0 ? "saved" : "stale";
  } catch (caught) {
    if (!isMissingColumn(caught) && !isMissingRelation(caught)) throw caught;
  }
  // rate_tier_at absente : le niveau seul, sans ordre, comme avant la #065.
  try {
    await updateRows("profiles", `id=eq.${userId}`, { rate_tier: tier });
    warnMissing("write", "rate_tier_at");
    return "saved";
  } catch (caught) {
    if (!isMissingColumn(caught) && !isMissingRelation(caught)) throw caught;
    warnMissing("write", "rate_tier");
    return "missing";
  }
}

// Niveau à utiliser pour une nouvelle analyse. Une lecture impossible du compte
// ne bloque jamais l'analyse : le cookie, puis le défaut de la table, prennent le relais.
export async function preferredTier(request: Request, user: SessionUser | null): Promise<Tier> {
  const cookie = parseTierCookie(readCookie(request, TIER_COOKIE));
  if (!user) return cookie?.tier ?? DEFAULT_TIER;

  const account = await readAccountTier(user.id).catch(() => null);
  const winner = latestTierChoice(account, cookie);
  if (!winner) return DEFAULT_TIER;

  // Le cookie est plus récent que le compte : le choix n'y est pas arrivé
  // (POST en échec, choix fait déconnecté, ou avant la #065 sur une analyse
  // non rattachée au compte). On le trace, et on rattrape le compte pour les
  // autres appareils. Un échec ici ne bloque pas l'analyse.
  if (winner === cookie && cookie.at > 0) {
    console.warn(
      JSON.stringify({
        event: "rate_tier_reconciled",
        reason: account ? "cookie_plus_recent" : "compte_sans_niveau",
        tier: cookie.tier,
      }),
    );
    await saveAccountTier(user.id, cookie.tier, cookie.at).catch((caught) => {
      console.error(
        JSON.stringify({ event: "rate_tier_error", operation: "reconcile", detail: caught instanceof Error ? caught.message.slice(0, 200) : "inconnu" }),
      );
    });
  }
  return winner.tier;
}
