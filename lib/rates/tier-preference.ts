import type { SessionUser } from "@/lib/auth/session";
import { DEFAULT_TIER, parseTier, TIER_COOKIE, type Tier } from "@/lib/rates/tier";
import { readCookie } from "@/lib/security/request";
import { isMissingColumn, isMissingRelation, selectRows, updateRows } from "@/lib/supabase/server";

// Niveau mémorisé pour les analyses suivantes (mission #039). Une préférence de
// calcul, pas une donnée sensible :
//   - compte connecté : colonne profiles.rate_tier (migration 20260917000017),
//     pour la retrouver sur un autre appareil ;
//   - tout navigateur, avec ou sans compte : cookie negoscore_niveau, écrit par
//     le sélecteur lui-même.
// Le compte passe avant le cookie : c'est le dernier choix fait, où qu'il ait été fait.

function warnMissing(operation: string) {
  console.warn(
    JSON.stringify({
      event: "rate_tier_missing",
      operation,
      detail: "Colonne profiles.rate_tier absente : appliquer la migration 20260917000017.",
    }),
  );
}

export async function readAccountTier(userId: string): Promise<Tier | null> {
  try {
    const [row] = await selectRows<{ rate_tier: string | null }>("profiles", `select=rate_tier&id=eq.${userId}&limit=1`);
    return parseTier(row?.rate_tier);
  } catch (caught) {
    if (!isMissingColumn(caught) && !isMissingRelation(caught)) throw caught;
    warnMissing("read");
    return null;
  }
}

export async function saveAccountTier(userId: string, tier: Tier): Promise<"saved" | "missing"> {
  try {
    await updateRows("profiles", `id=eq.${userId}`, { rate_tier: tier });
    return "saved";
  } catch (caught) {
    if (!isMissingColumn(caught) && !isMissingRelation(caught)) throw caught;
    warnMissing("write");
    return "missing";
  }
}

// Niveau à utiliser pour une nouvelle analyse. Une lecture impossible du compte
// ne bloque jamais l'analyse : le cookie, puis le défaut de la table, prennent le relais.
export async function preferredTier(request: Request, user: SessionUser | null): Promise<Tier> {
  if (user) {
    const fromAccount = await readAccountTier(user.id).catch(() => null);
    if (fromAccount) return fromAccount;
  }
  return parseTier(readCookie(request, TIER_COOKIE)) ?? DEFAULT_TIER;
}
