import { lockAnalysis, type ResultView } from "@/lib/analysis/lock";
import type { SessionUser } from "@/lib/auth/session";
import { analysisSchema } from "@/lib/schema";
import { isUuid, sameToken } from "@/lib/security/request";
import { selectRows } from "@/lib/supabase/server";

type Row = { payload: unknown; deal: { anon_token: string | null; user_id: string | null } };

// Lecture autorisée : le propriétaire connecté, ou le navigateur anonyme qui
// a lancé une analyse encore non rattachée. Déverrouillée : propriétaire connecté uniquement.
export async function loadResultForViewer(
  id: string,
  viewer: { user: SessionUser | null; anonToken: string | null },
): Promise<{ analysis: ResultView; unlocked: boolean } | null> {
  if (!isUuid(id)) return null;
  const rows = await selectRows<Row>("analyses", `select=payload,deal:deals!inner(anon_token,user_id)&id=eq.${id}&limit=1`);
  const row = rows[0];
  if (!row) return null;

  const owner = viewer.user !== null && row.deal.user_id === viewer.user.id;
  const anonymousOwner = row.deal.user_id === null && sameToken(row.deal.anon_token, viewer.anonToken);
  if (!owner && !anonymousOwner) return null;

  const parsed = analysisSchema.safeParse(row.payload);
  if (!parsed.success) return null;
  return owner ? { analysis: parsed.data, unlocked: true } : { analysis: lockAnalysis(parsed.data), unlocked: false };
}
