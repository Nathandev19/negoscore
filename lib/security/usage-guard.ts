import { adjustInteger, rpc } from "@/lib/supabase/server";

// Compteurs persistants dans usage_guard, par clé hachée, calculés par une
// fonction SQL atomique. Par défaut : 5 analyses par heure et par IP hachée.

export const ANALYSES_PER_WINDOW = 5;
export const WINDOW_SECONDS = 60 * 60;

export type GuardResult = { allowed: boolean; count: number; retryInMinutes: number };

export async function hitUsageGuard(
  keyHash: string,
  { limit = ANALYSES_PER_WINDOW, windowSeconds = WINDOW_SECONDS }: { limit?: number; windowSeconds?: number } = {},
): Promise<GuardResult> {
  const rows = await rpc<Array<{ allowed: boolean; hit_count: number; retry_after_seconds: number }>>("usage_guard_hit", {
    p_ip_hash: keyHash,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  const row = rows[0];
  return {
    allowed: row.allowed,
    count: row.hit_count,
    retryInMinutes: Math.max(1, Math.ceil(row.retry_after_seconds / 60)),
  };
}

// Annule un essai compté : sert à rendre une analyse gratuite qui a échoué.
export async function releaseUsageGuard(keyHash: string): Promise<void> {
  await adjustInteger("usage_guard", `ip_hash=eq.${keyHash}`, "count", -1, (count) => count > 0);
}
