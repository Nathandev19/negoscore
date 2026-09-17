import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { TrackView } from "@/components/analytics/track-view";
import { AnalysisResult } from "@/components/result/analysis-result";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { ANALYTICS_EVENTS } from "@/lib/analytics/events";
import { loadResultForViewer } from "@/lib/analysis/load";
import { getViewer } from "@/lib/auth/viewer";
import { ANON_COOKIE } from "@/lib/security/request";

export const metadata: Metadata = {
  title: "Résultat de l'analyse",
  robots: { index: false, follow: false },
};

export default async function AnalysisPage({ params }: PageProps<"/analyse/resultat/[id]">) {
  const { id } = await params;
  const anonToken = (await cookies()).get(ANON_COOKIE)?.value ?? null;
  const user = await getViewer();
  const result = await loadResultForViewer(id, { user, anonToken });
  if (!result) notFound();

  return (
    <>
      <SiteHeader />
      <TrackView event={ANALYTICS_EVENTS.resultViewed} />
      {result.unlocked ? null : <TrackView event={ANALYTICS_EVENTS.paywallEmailShown} />}
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-10 px-4 pt-2 pb-12 sm:px-6 sm:pt-8">
        <AnalysisResult
          analysis={result.analysis}
          unlockHref={`/connexion?next=${encodeURIComponent(`/analyse/resultat/${id}`)}`}
        />
        {result.sourceRemoved ? (
          <p role="note" className="rounded-xl border border-line bg-surface-soft p-4 text-small">
            {result.sourceType === "text"
              ? "Le texte d'origine de cette offre a été supprimé au bout de 30 jours, comme prévu. L'analyse reste disponible."
              : "Le fichier d'origine de cette offre a été supprimé au bout de 30 jours, comme prévu. L'analyse reste disponible."}
          </p>
        ) : null}
        <p className="text-center text-small">
          <Link href={`/analyse/resultat/${id}/supprimer`} className="text-subtle underline underline-offset-4 hover:text-ink">
            Supprimer cette analyse
          </Link>
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
