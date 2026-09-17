import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { TrackView } from "@/components/analytics/track-view";
import { AnalysisResult } from "@/components/result/analysis-result";
import { EstimateFeedback } from "@/components/result/estimate-feedback";
import { RetryPanel, type RetryPanelState } from "@/components/result/retry-panel";
import { ShareCardLink } from "@/components/result/share-card-link";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { ANALYTICS_EVENTS } from "@/lib/analytics/events";
import { readFeedback } from "@/lib/analysis/feedback";
import { loadResultForViewer } from "@/lib/analysis/load";
import { retryStateFor, type RetryPageState } from "@/lib/analysis/retry";
import { getViewer } from "@/lib/auth/viewer";
import { shareCardAvailable } from "@/lib/share-card/element";
import { ANON_COOKIE } from "@/lib/security/request";

export const metadata: Metadata = {
  title: "Résultat de l'analyse",
  robots: { index: false, follow: false },
};

const RETRY_DATE = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", timeZone: "Europe/Paris" });

function panelState(state: RetryPageState | null): RetryPanelState | null {
  if (!state || state.kind === "not_applicable") return null;
  // « 1 octobre » s'écrit « 1er octobre ».
  if (state.kind === "available") return { kind: "available", until: RETRY_DATE.format(state.until).replace(/^1 /, "1er ") };
  if (state.kind === "used") return { kind: "used", retryHref: state.retryId ? `/analyse/resultat/${state.retryId}` : null };
  return { kind: state.kind };
}

export default async function AnalysisPage({ params }: PageProps<"/analyse/resultat/[id]">) {
  const { id } = await params;
  const anonToken = (await cookies()).get(ANON_COOKIE)?.value ?? null;
  const user = await getViewer();
  const result = await loadResultForViewer(id, { user, anonToken });
  if (!result) notFound();
  // Avis déjà donné : pré-rempli. Table absente (migration 016 non appliquée) :
  // le formulaire s'affiche vide et l'envoi répondra que c'est indisponible.
  const feedback = await readFeedback(id).catch(() => null);
  // Offre incomplète : relance gratuite (mission #043). null : indisponible
  // (migration 018 non appliquée, ou erreur de lecture), rien n'est affiché.
  const retry =
    result.analysis.evaluability === "incomplete" ? panelState(await retryStateFor(id).catch(() => null)) : null;

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
        retry={retry ? <RetryPanel state={retry} originId={id} /> : null}
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
