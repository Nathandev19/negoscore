import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { TrackView } from "@/components/analytics/track-view";
import { AnalysisResult } from "@/components/result/analysis-result";
import { EstimateFeedback } from "@/components/result/estimate-feedback";
import { ShareCardLink } from "@/components/result/share-card-link";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { ANALYTICS_EVENTS } from "@/lib/analytics/events";
import { readFeedback } from "@/lib/analysis/feedback";
import { loadResultForViewer } from "@/lib/analysis/load";
import { getViewer } from "@/lib/auth/viewer";
import { shareCardAvailable } from "@/lib/share-card/element";
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
  // Avis déjà donné : pré-rempli. Table absente (migration 016 non appliquée) :
  // le formulaire s'affiche vide et l'envoi répondra que c'est indisponible.
  const feedback = await readFeedback(id).catch(() => null);

  return (
    <>
      <SiteHeader tone="marque" />
      <TrackView event={ANALYTICS_EVENTS.resultViewed} />
      {result.unlocked ? null : <TrackView event={ANALYTICS_EVENTS.paywallEmailShown} />}
      <AnalysisResult
        analysis={result.analysis}
        unlockHref={`/connexion?next=${encodeURIComponent(`/analyse/resultat/${id}`)}`}
        // Analyse ouverte par son compte : le niveau choisi est aussi mémorisé sur le compte.
        rememberOnAccount={result.unlocked}
      >
        {shareCardAvailable(result.analysis) ? <ShareCardLink href={`/analyse/resultat/${id}/carte`} /> : null}
        <EstimateFeedback
          action={`/api/analyses/${id}/avis`}
          initial={feedback === "missing" ? null : feedback}
        />
        {result.sourceRemoved ? (
          <p role="note" className="border-y border-filet py-3 text-small">
            {result.sourceType === "text"
              ? "Le texte d'origine de cette offre a été supprimé au bout de 30 jours, comme prévu. L'analyse reste disponible."
              : "Le fichier d'origine de cette offre a été supprimé au bout de 30 jours, comme prévu. L'analyse reste disponible."}
          </p>
        ) : null}
        <p className="text-center text-small">
          <Link href={`/analyse/resultat/${id}/supprimer`} className="link">
            Supprimer cette analyse
          </Link>
        </p>
      </AnalysisResult>
      <SiteFooter />
    </>
  );
}
