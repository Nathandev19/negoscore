import type { ReactNode } from "react";
import {
  DealRecap,
  Estimate,
  GoodPoints,
  LegalNotice,
  NegotiateList,
  RedFlags,
} from "@/components/result/analysis-blocks";
import { LockedCounterOfferPlaceholder, LockedMessagePlaceholder, UnlockCta } from "@/components/result/locked-blocks";
import { ScoreBand } from "@/components/result/score-band";
import { CounterOffer, ReadyMessage } from "@/components/result/unlocked-blocks";
import { IncompleteCard, TermsUnknownCard, UnpricedCard } from "@/components/result/verdict-card";
import { counterOfferRange } from "@/lib/analysis/anchoring";
import { missingInformation } from "@/lib/analysis/evaluability";
import type { ResultView } from "@/lib/analysis/lock";

// Page de résultat, sous l'en-tête bleu (SiteHeader tone="marque") :
// 1. bandeau bleu : phrase de verdict, score, pastille, jauge ;
// 2. sur crème, dans cet ordre : détail du verdict si l'offre n'a pas de score,
//    fourchette en euros, ce qu'il faut négocier, le deal proposé, puis le reste.
// Les blocs contre-offre et message ne sont rendus que si le serveur a laissé
// ces champs dans l'analyse. Sinon, bloc de substitution sans contenu.
export function AnalysisResult({
  analysis,
  unlockHref,
  example = false,
  before,
  children,
}: {
  analysis: ResultView;
  unlockHref: string;
  // Exemple figé (démo) : aucune version de table affichée.
  example?: boolean;
  // Contenu au-dessus des blocs de lecture (bandeau d'exemple).
  before?: ReactNode;
  // Contenu sous les blocs (carte, avis, suppression).
  children?: ReactNode;
}) {
  const locked = !analysis.counter_offer || !analysis.ready_to_send_message;
  const incomplete = analysis.evaluability === "incomplete";
  // Sans montant de contre-offre (offre incomplète, ou montant déjà au-dessus de
  // la fourchette), le titre n'annonce pas de chiffre. Recalculé ici car la vue
  // verrouillée ne reçoit pas la contre-offre.
  const { estimate, deal } = analysis;
  const priced = counterOfferRange(deal.payment.amount_eur, estimate.total_low, estimate.total_high).low !== null;
  const counterOfferTitle = incomplete || !priced ? "Ta contre-offre" : undefined;
  return (
    <>
      <section aria-label="Verdict" className="on-marque grain bg-marque text-creme">
        <div className="mx-auto w-full max-w-5xl px-4 pt-6 pb-10 sm:px-6 lg:pt-10 lg:pb-14">
          <h1 className="sr-only">Résultat de l&apos;analyse de ton deal</h1>
          <ScoreBand analysis={analysis} />
        </div>
      </section>
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-12 px-4 pt-8 pb-16 sm:px-6 md:pt-12 md:pb-24 [&>*]:max-w-2xl">
        {before}
        {incomplete ? (
          <IncompleteCard missing={missingInformation(analysis)} />
        ) : analysis.evaluability === "terms_unknown" ? (
          <TermsUnknownCard deal={analysis.deal} estimate={analysis.estimate} missing={missingInformation(analysis)} />
        ) : analysis.evaluability === "unpriced" ? (
          <UnpricedCard confidence={analysis.confidence} />
        ) : null}
        {incomplete ? null : <Estimate estimate={analysis.estimate} example={example} />}
        <NegotiateList items={analysis.negotiate} />
        <DealRecap deal={analysis.deal} />
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
        <RedFlags items={analysis.red_flags} />
        <GoodPoints items={analysis.good_points} />
        <LegalNotice legal={analysis.fr_legal} />
        {children}
      </main>
    </>
  );
}
