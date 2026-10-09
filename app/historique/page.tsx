import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { HistoryView, type HistoryRow } from "@/components/account/history-view";
import { getViewer, getViewerAccessToken } from "@/lib/auth/viewer";
import { loadHistoryTurns, summariesFromTurns } from "@/lib/negotiation/history-load";
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

  // Mission #107 — les deux lectures partent ENSEMBLE : la liste des analyses
  // (sous l'identité de la personne, la RLS ne renvoie que les siennes) et ses
  // tours de négociation, qui ne dépendent que de son compte. Avant, la
  // seconde attendait la première pour un filtre dont elle n'avait pas besoin.
  const [rows, turns] = await Promise.all([
    selectRowsAsUser<HistoryRow>(
      token,
      "analyses",
      // Mission #174 — « band » est PROJETÉE, plus recalculée. La liste
      // dérivait la pastille de la note avec bandFor(score) : sur une offre
      // sous le plancher, elle affichait « correct » là où la page de
      // résultat dit « faible » (relevé en #172). Une bande se lit, elle ne
      // se redevine pas.
      "select=id,created_at,score,band:payload->score->>band,amount:payload->deal->payment->amount_eur,evaluability:payload->>evaluability,tier:payload->>profile_tier,rateTable:rate_table_version&order=created_at.desc&limit=100",
    ),
    loadHistoryTurns(user.id),
  ]);

  // Mission #087 : état des échanges et chiffres actuels, pour les analyses
  // listées qui ont des tours (lib/negotiation/history-load.ts). Une lecture de
  // plus seulement s'il y a des tours à résumer.
  const summaries = await summariesFromTurns(
    turns,
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
