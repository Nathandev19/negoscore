import { analysisSchema, type Analysis } from "@/lib/schema";
import { isUuid, sameToken } from "@/lib/security/request";
import { selectRows } from "@/lib/supabase/server";

type Row = { payload: unknown; deal: { anon_token: string | null } };

// Lit une analyse par son id, pour le navigateur qui l'a lancée. Renvoie null
// si l'id est invalide, inconnu, ou appartient à un autre jeton anonyme.
export async function loadAnalysisForViewer(id: string, anonToken: string | null): Promise<Analysis | null> {
  if (!isUuid(id) || !anonToken) return null;
  const rows = await selectRows<Row>("analyses", `select=payload,deal:deals!inner(anon_token)&id=eq.${id}&limit=1`);
  const row = rows[0];
  if (!row || !sameToken(row.deal.anon_token, anonToken)) return null;
  const parsed = analysisSchema.safeParse(row.payload);
  return parsed.success ? parsed.data : null;
}
