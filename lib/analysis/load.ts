import { cache } from "react";
import { lockAnalysis, type ResultView } from "@/lib/analysis/lock";
import type { SessionUser } from "@/lib/auth/session";
import { analysisSchema } from "@/lib/schema";
import { isUuid, sameToken } from "@/lib/security/request";
import { selectRows } from "@/lib/supabase/server";

type Viewer = { user: SessionUser | null; anonToken: string | null };

type DealRef = {
  id: string;
  anon_token: string | null;
  user_id: string | null;
  source_type: "text" | "image" | "pdf";
  raw_text: string | null;
  deal_documents: Array<{ id: string }>;
};

type Row = { payload: unknown; deal: DealRef };

// Rattachement serveur, seule base d'autorisation : le propriétaire connecté,
// ou le navigateur anonyme (cookie httpOnly) d'une analyse encore non rattachée.
export function viewerOwnsDeal(deal: Pick<DealRef, "anon_token" | "user_id">, viewer: Viewer): "owner" | "anonymous" | null {
  if (deal.user_id !== null) return viewer.user !== null && deal.user_id === viewer.user.id ? "owner" : null;
  return sameToken(deal.anon_token, viewer.anonToken) ? "anonymous" : null;
}

// Matière première effacée par la purge des 30 jours : texte collé remis à
// NULL, ou fichier déposé supprimé. L'analyse, elle, reste.
function sourceRemoved(deal: DealRef): boolean {
  return deal.source_type === "text" ? deal.raw_text === null : deal.deal_documents.length === 0;
}

export type LoadedResult = {
  analysis: ResultView;
  unlocked: boolean;
  sourceRemoved: boolean;
  sourceType: DealRef["source_type"];
};

// Mémorisé par requête (mission #049), sur des valeurs simples : le layout de
// la page de résultat lit le résultat pour décider le 404 avant tout rendu, la
// page le relit ensuite. Une seule lecture part vers la base.
const loadCached = cache(
  async (id: string, userId: string | null, anonToken: string | null): Promise<LoadedResult | null> =>
    load(id, { user: userId === null ? null : ({ id: userId } as SessionUser), anonToken }),
);

export function loadResultForViewer(id: string, viewer: Viewer): Promise<LoadedResult | null> {
  return loadCached(id, viewer.user?.id ?? null, viewer.anonToken);
}

async function load(id: string, viewer: Viewer): Promise<LoadedResult | null> {
  if (!isUuid(id)) return null;
  const rows = await selectRows<Row>(
    "analyses",
    `select=payload,deal:deals!inner(id,anon_token,user_id,source_type,raw_text,deal_documents(id))&id=eq.${id}&limit=1`,
  );
  const row = rows[0];
  if (!row) return null;

  const access = viewerOwnsDeal(row.deal, viewer);
  if (!access) return null;

  const parsed = analysisSchema.safeParse(row.payload);
  if (!parsed.success) return null;
  // Le texte source ne quitte jamais le serveur : seul le fait qu'il ait été effacé est transmis.
  return {
    analysis: access === "owner" ? parsed.data : lockAnalysis(parsed.data),
    unlocked: access === "owner",
    sourceRemoved: sourceRemoved(row.deal),
    sourceType: row.deal.source_type,
  };
}
