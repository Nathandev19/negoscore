import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { getViewer, getViewerAccessToken } from "@/lib/auth/viewer";
import { Button } from "@/components/ui/button";
import { BAND_STYLE, formatEur } from "@/lib/display";
import { bandFor } from "@/lib/rates/score";
import { cn } from "@/lib/utils";
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
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-4 pt-10 pb-16 sm:px-6 md:pt-16 md:pb-24">
        <h1 className="text-h1 font-extrabold">Tes analyses</h1>
        {rows.length === 0 ? (
          <p>
            Aucune analyse pour l&apos;instant. <Link href="/analyse" className="link font-semibold">Analyser un deal</Link>
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-filet border-y border-filet">
            {rows.map((row) => (
              <li key={row.id}>
                <Link href={`/analyse/resultat/${row.id}`} className="group flex items-center justify-between gap-4 py-4">
                  <span className="flex flex-col">
                    <span className="font-semibold text-encre decoration-1 underline-offset-4 group-hover:underline">{DATE.format(new Date(row.created_at))}</span>
                    <span className="text-sm text-attenue">
                      {typeof row.amount === "number" ? `Offre : ${formatEur(row.amount)}` : "Montant non précisé"}
                    </span>
                  </span>
                  {row.score !== null ? (
                    <span className={cn("figures text-2xl", BAND_STYLE[bandFor(row.score)].text)}>
                      {row.score}
                      <span className="font-sans text-sm font-medium text-attenue">/100</span>
                    </span>
                  ) : (
                    <span className="text-sm font-semibold text-encre">{NO_SCORE_LABEL[row.evaluability ?? ""] ?? "—"}</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-col gap-1">
          <Link href="/resilier" className="link flex min-h-11 w-fit items-center text-sm">
            Résilier votre contrat
          </Link>
          <form action="/auth/deconnexion" method="post">
            <Button type="submit" variant="link" className="text-sm">
              Se déconnecter
            </Button>
          </form>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
