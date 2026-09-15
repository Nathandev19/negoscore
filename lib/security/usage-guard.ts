import { rpc } from "@/lib/supabase/server";

// Limite persistante : 5 analyses par heure et par IP hachée, comptées dans
// la table usage_guard par une fonction SQL atomique.

export const ANALYSES_PER_WINDOW = 5;
export const WINDOW_SECONDS = 60 * 60;

export type GuardResult = { allowed: boolean; count: number; retryInMinutes: number };

export async function hitUsageGuard(ipHash: string): Promise<GuardResult> {
  const rows = await rpc<Array<{ allowed: boolean; hit_count: number; retry_after_seconds: number }>>("usage_guard_hit", {
    p_ip_hash: ipHash,
    p_limit: ANALYSES_PER_WINDOW,
    p_window_seconds: WINDOW_SECONDS,
  });
  const row = rows[0];
  return {
    allowed: row.allowed,
    count: row.hit_count,
    retryInMinutes: Math.max(1, Math.ceil(row.retry_after_seconds / 60)),
  };
}
