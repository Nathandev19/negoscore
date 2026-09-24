import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { TrackView } from "@/components/analytics/track-view";
import { AnalysisResult } from "@/components/result/analysis-result";
import { EstimateFeedback } from "@/components/result/estimate-feedback";
import { NegotiationThread } from "@/components/result/negotiation/negotiation-thread";
import { RetryPanel, type RetryPanelState } from "@/components/result/retry-panel";
import { ShareCardLink } from "@/components/result/share-card-link";
import { SessionUnavailable } from "@/components/session-unavailable";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { ANALYTICS_EVENTS } from "@/lib/analytics/events";
import { lastJudgedRange, readFeedback, shouldAskFeedback } from "@/lib/analysis/feedback";
import { judgedRanges } from "@/lib/analysis/judged-ranges";
import { loadResultForViewer } from "@/lib/analysis/load";
import { recomputeForDeal } from "@/lib/analysis/recompute";
import { retryStateFor, type RetryPageState } from "@/lib/analysis/retry";
import { getViewerState } from "@/lib/auth/viewer";
import { currentState } from "@/lib/negotiation/current";
import { loadSentMessages, type SentMessage } from "@/lib/negotiation/sent";
import { loadThread, type Thread } from "@/lib/negotiation/store";
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
  // Mission #089 bis — même garde que le layout, pour elle-même : la page est
  // rendue en parallèle de lui, et lire la suite avec user = null pendant une
  // panne dirait « introuvable » à la propriétaire de l'analyse.
  const { state, user } = await getViewerState();
  if (state === "indisponible") return <SessionUnavailable />;
  const result = await loadResultForViewer(id, { user, anonToken });
  if (!result) notFound();
  // Offre incomplète : relance gratuite (mission #043). null : indisponible
  // (migration 018 non appliquée, ou erreur de lecture), rien n'est affiché.
  const retry =
    result.analysis.evaluability === "incomplete" ? panelState(await retryStateFor(id).catch(() => null)) : null;
  // Suite de l'échange (mission #080) : pour la personne connectée qui a lancé
  // l'analyse. Table absente ou lecture en échec : le fil ne s'affiche pas,
  // plutôt qu'un fil vide qui ferait croire qu'il n'y a rien.
  const owner = result.unlocked && user !== null;
  const thread: Thread | "missing" | null = owner ? await loadThread(id).catch(() => "missing" as const) : null;
  // Compris dans l'analyse (mission #080 ter) : ouvert au propriétaire connecté.
  const showThread = thread !== "missing";
  // Message retenu comme envoyé pour le dernier tour (mission #080 bis).
  const answeredTurn = 1 + (thread && thread !== "missing" ? thread.turns.length : 0);
  // Mission #084 : termes actuels après les tours (null : aucun tour).
  const negotiated = thread && thread !== "missing" ? currentState(thread) : null;
  // Table disparue du code après un tour (mission #085) : pas de carte.
  const cardAnalysis = negotiated ? recomputeForDeal(result.analysis, negotiated.deal) : result.analysis;
  const cardAvailable = cardAnalysis !== null && shareCardAvailable(cardAnalysis);
  // Mission #086 : le tour dont la page affiche les chiffres. Table de
  // l'analyse disparue : la page montre ceux d'origine, tour 0.
  const judgedTurn = negotiated && cardAnalysis !== null ? negotiated.turn : 0;
  // Avis déjà donné sur CE tour : pré-rempli, jamais celui d'un autre tour.
  // Table ou colonnes absentes (migrations non appliquées) : le formulaire
  // s'affiche vide et l'envoi répondra que c'est indisponible.
  const feedback = await readFeedback(id, judgedTurn).catch(() => null);
  // Mission #097 — la question n'est reposée que si la fourchette a changé
  // depuis la dernière réponse donnée sur cette analyse.
  const judgedAnalysis = cardAnalysis ?? result.analysis;
  const lastJudged = await lastJudgedRange(id).catch(() => null);
  const askFeedback = shouldAskFeedback({
    current: { low: judgedAnalysis.estimate.total_low, high: judgedAnalysis.estimate.total_high },
    lastJudged,
    answeredThisTurn: feedback !== null && feedback !== "missing",
  });
  const sent: SentMessage | undefined = owner ? (await loadSentMessages(id).catch(() => new Map<number, SentMessage>())).get(answeredTurn) : undefined;

  return (
    <>
      <SiteHeader tone="marque" />
      <TrackView event={ANALYTICS_EVENTS.resultViewed} />
      {result.unlocked ? null : <TrackView event={ANALYTICS_EVENTS.paywallEmailShown} />}
      <AnalysisResult
        analysis={result.analysis}
        // Retour sur le message prêt à envoyer, une fois débloqué (mission #067).
        unlockHref={`/connexion?next=${encodeURIComponent(`/analyse/resultat/${id}#message`)}`}
        retry={retry ? <RetryPanel state={retry} originId={id} /> : null}
        // Copier un message l'enregistre comme envoyé : propriétaire connecté seulement.
        analysisId={owner ? id : null}
        // Mission #084 : après un tour, ce qui se déduit des termes est
        // recalculé sur les termes actuels.
        negotiated={negotiated}
        afterMessage={
          showThread ? (
            // Clé explicite : élément serveur passé en propriété à un composant
            // client, sinon React signale une clé manquante en développement.
            <NegotiationThread
              key="echange"
              analysisId={id}
              turns={(thread?.turns ?? []).map(({ turnNumber, createdAt, brandReply, payload }) => ({ turnNumber, createdAt, brandReply, payload }))}
              conclusion={thread?.conclusion?.payload.conclusion ?? null}
              access={owner ? "open" : "signed_out"}
              sent={sent ? { text: sent.text, source: sent.source, updatedAt: sent.updatedAt } : null}
            />
          ) : null
        }
      >
        {cardAvailable ? <ShareCardLink href={`/analyse/resultat/${id}/carte`} /> : null}
        {askFeedback ? (
          <EstimateFeedback
            action={`/api/analyses/${id}/avis`}
            turn={judgedTurn}
            initial={feedback === "missing" ? null : feedback}
            ranges={judgedRanges(judgedAnalysis)}
          />
        ) : null}
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
