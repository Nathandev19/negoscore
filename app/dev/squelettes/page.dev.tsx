import { AccountView } from "@/components/account/account-view";
import { CancelView } from "@/components/account/cancel-view";
import { HistoryView } from "@/components/account/history-view";
import { ThanksView } from "@/components/account/thanks-view";
import { DeleteAnalysisView } from "@/components/result/delete-analysis-view";
import { ResultSkeleton } from "@/components/result/result-skeleton";
import { accountSummary } from "@/lib/account/summary";

// DÉVELOPPEMENT UNIQUEMENT (extension .dev.tsx, voir next.config.ts) : chaque
// squelette de chargement (mission #048) et la page réelle qu'il précède, avec
// des données d'exemple, sans base ni session, pour vérifier à l'œil et par
// mesure qu'aucun bloc ne bouge à l'arrivée du contenu.
// /dev/squelettes?page=compte|historique|merci|resilier|supprimer|resultat&etat=squelette|contenu
// Contenu de « resultat » : /dev/resultat?etat=debloque.

const credits = { plan: "pack" as const, balance: 2, period_end: null, cancelled_at: null };
const rows = ["2026-09-17T10:00:00Z", "2026-09-12T10:00:00Z", "2026-09-02T10:00:00Z"].map((created_at, index) => ({
  id: `00000000-0000-4000-8000-00000000000${index}`,
  created_at,
  score: [33, null, 61][index],
  amount: [300, 450, null][index],
  evaluability: ["complete", "terms_unknown", "complete"][index],
  tier: "starter",
}));

export default async function SkeletonPreviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const skeleton = params.etat !== "contenu";
  switch (params.page) {
    case "historique":
      return <HistoryView rows={skeleton ? null : rows} />;
    case "merci":
      return skeleton ? <ThanksView /> : <ThanksView credits={null} />;
    case "resilier":
      return <CancelView data={skeleton ? null : { credits, error: null, forDeletion: false, etat: null }} />;
    case "supprimer":
      return <DeleteAnalysisView data={skeleton ? null : { id: rows[0].id, unavailable: false }} />;
    case "resultat":
      return <ResultSkeleton />;
    default:
      return <AccountView data={skeleton ? null : { email: "nina@exemple.fr", summary: accountSummary(credits) }} />;
  }
}
