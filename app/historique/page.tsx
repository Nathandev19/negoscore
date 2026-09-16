import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { getViewer, getViewerAccessToken } from "@/lib/auth/viewer";
import { formatEur } from "@/lib/display";
import { selectRowsAsUser } from "@/lib/supabase/as-user";

export const metadata: Metadata = {
  title: "Historique",
  robots: { index: false, follow: false },
};

type Row = {
  id: string;
  created_at: string;
  score: number | null;
  amount: number | null;
  evaluability: string | null;
};

// Analyse sans score : on dit pourquoi plutôt que d'afficher « —/100 ».
const NO_SCORE_LABEL: Record<string, string> = {
  terms_unknown: "À préciser",
  unpriced: "À chiffrer",
  incomplete: "Incomplète",
};

const DATE = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" });

export default async function HistoryPage() {
  const user = await getViewer();
  const token = await getViewerAccessToken();
  if (!user || !token) redirect("/connexion?next=%2Fhistorique");

  // Lecture sous l'identité de l'utilisateur : la RLS ne renvoie que ses analyses.
  const rows = await selectRowsAsUser<Row>(
    token,
    "analyses",
    "select=id,created_at,score,amount:payload->deal->payment->amount_eur,evaluability:payload->>evaluability&order=created_at.desc&limit=100",
  );

  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 pt-6 pb-12 sm:px-6 sm:pt-12">
        <h1 className="text-3xl font-black tracking-tight">Tes analyses</h1>
        {rows.length === 0 ? (
          <p className="text-neutral-700">
            Aucune analyse pour l&apos;instant. <Link href="/analyse" className="font-semibold underline">Analyser un deal</Link>
          </p>
        ) : (
          <ul className="flex flex-col divide-y rounded-xl border bg-white">
            {rows.map((row) => (
              <li key={row.id}>
                <Link href={`/analyse/resultat/${row.id}`} className="flex items-center justify-between gap-4 p-4 hover:bg-neutral-50">
                  <span className="flex flex-col">
                    <span className="font-semibold">{DATE.format(new Date(row.created_at))}</span>
                    <span className="text-sm text-neutral-600">
                      {typeof row.amount === "number" ? `Offre : ${formatEur(row.amount)}` : "Montant non précisé"}
                    </span>
                  </span>
                  {row.score !== null ? (
                    <span className="text-2xl font-black">{row.score}<span className="text-sm font-medium text-neutral-500">/100</span></span>
                  ) : (
                    <span className="text-sm font-semibold text-neutral-700">{NO_SCORE_LABEL[row.evaluability ?? ""] ?? "—"}</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
        <p className="text-sm">
          <Link href="/resilier" className="underline">
            Résilier votre contrat
          </Link>
        </p>
        <form action="/auth/deconnexion" method="post">
          <button type="submit" className="text-sm text-neutral-600 underline">
            Se déconnecter
          </button>
        </form>
      </main>
      <SiteFooter />
    </>
  );
}
