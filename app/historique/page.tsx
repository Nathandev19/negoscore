import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { HistoryView, type HistoryRow } from "@/components/account/history-view";
import { getViewer, getViewerAccessToken } from "@/lib/auth/viewer";
import { loadNegotiationSummaries } from "@/lib/negotiation/history-load";
import { selectRowsAsUser } from "@/lib/supabase/as-user";

export const metadata: Metadata = {
  title: "Historique",
  robots: { index: false, follow: false },
};

// Un visiteur sans session est redirigé par proxy.ts avant tout rendu ; la
// vérification reste ici par sécurité.
export default async function HistoryPage() {
  const user = await getViewer();
  const token = await getViewerAccessToken();
  if (!user || !token) redirect("/connexion?next=%2Fhistorique");

  // Lecture sous l'identité de l'utilisateur : la RLS ne renvoie que ses analyses.
  const rows = await selectRowsAsUser<HistoryRow>(
    token,
    "analyses",
    "select=id,created_at,score,amount:payload->deal->payment->amount_eur,evaluability:payload->>evaluability,tier:payload->>profile_tier,rateTable:rate_table_version&order=created_at.desc&limit=100",
  );

  // Mission #087 : état des échanges et chiffres actuels, pour les analyses
  // listées qui ont des tours (lib/negotiation/history-load.ts).
  const summaries = await loadNegotiationSummaries(
    user.id,
    token,
    rows.map((row) => row.id),
  );

  return (
    <HistoryView
      rows={rows.map((row) => ({ ...row, negotiation: summaries?.get(row.id) ?? null }))}
      negotiationUnavailable={summaries === null}
    />
  );
}
