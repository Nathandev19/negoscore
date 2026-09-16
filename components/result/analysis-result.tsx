import {
  DealRecap,
  Estimate,
  GoodPoints,
  LegalNotice,
  NegotiateList,
  RedFlags,
} from "@/components/result/analysis-blocks";
import { LockedCounterOfferPlaceholder, LockedMessagePlaceholder, UnlockCta } from "@/components/result/locked-blocks";
import { ScoreCard } from "@/components/result/score-card";
import { CounterOffer, ReadyMessage } from "@/components/result/unlocked-blocks";
import { IncompleteCard, TermsUnknownCard, UnpricedCard } from "@/components/result/verdict-card";
import { missingInformation } from "@/lib/analysis/evaluability";
import type { ResultView } from "@/lib/analysis/lock";

// Les blocs contre-offre et message ne sont rendus que si le serveur a
// laissé ces champs dans l'analyse. Sinon, bloc de substitution sans contenu.
export function AnalysisResult({ analysis, unlockHref }: { analysis: ResultView; unlockHref: string }) {
  const locked = !analysis.counter_offer || !analysis.ready_to_send_message;
  const incomplete = analysis.evaluability === "incomplete";
  // Offre incomplète : la contre-offre ne porte pas de montant, le titre ne l'annonce pas.
  const counterOfferTitle = incomplete ? "Ta contre-offre" : undefined;
  return (
    <>
      <h1 className="sr-only">Résultat de l&apos;analyse de ton deal</h1>
      {analysis.evaluability === "complete" && analysis.score ? (
        <ScoreCard score={analysis.score} confidence={analysis.confidence} />
      ) : incomplete ? (
        <IncompleteCard missing={missingInformation(analysis)} />
      ) : analysis.evaluability === "terms_unknown" ? (
        <TermsUnknownCard deal={analysis.deal} estimate={analysis.estimate} missing={missingInformation(analysis)} />
      ) : (
        <UnpricedCard confidence={analysis.confidence} />
      )}
      <DealRecap deal={analysis.deal} />
      <GoodPoints items={analysis.good_points} />
      <NegotiateList items={analysis.negotiate} />
      <RedFlags items={analysis.red_flags} />
      <LegalNotice legal={analysis.fr_legal} />
      {incomplete ? null : <Estimate estimate={analysis.estimate} />}
      {analysis.counter_offer ? (
        <CounterOffer offer={analysis.counter_offer} title={counterOfferTitle} />
      ) : (
        <LockedCounterOfferPlaceholder title={counterOfferTitle} />
      )}
      {analysis.ready_to_send_message ? (
        <ReadyMessage message={analysis.ready_to_send_message} />
      ) : (
        <LockedMessagePlaceholder />
      )}
      {locked ? <UnlockCta href={unlockHref} /> : null}
    </>
  );
}
