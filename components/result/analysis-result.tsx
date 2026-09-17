"use client";

import { useMemo, useState, type ReactNode } from "react";
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
import { rememberTier, TierContext, TierSelector } from "@/components/result/tier-selector";
import { CounterOffer, ReadyMessage } from "@/components/result/unlocked-blocks";
import { IncompleteCard, TermsUnknownCard, UnpricedCard } from "@/components/result/verdict-card";
import { counterOfferRange } from "@/lib/analysis/anchoring";
import { missingInformation } from "@/lib/analysis/evaluability";
import type { ResultView } from "@/lib/analysis/lock";
import { recomputeForTier, tierChangeAvailable } from "@/lib/analysis/recompute";
import type { Tier } from "@/lib/rates/tier";

// Page de résultat, sous l'en-tête bleu (SiteHeader tone="marque") :
// 1. bandeau bleu : phrase de verdict, score, pastille, jauge, niveau ;
// 2. sur crème, dans cet ordre : détail du verdict si l'offre n'a pas de score,
//    niveau et fourchette en euros, ce qu'il faut négocier, le deal proposé, puis le reste.
// Les blocs contre-offre et message ne sont rendus que si le serveur a laissé
// ces champs dans l'analyse. Sinon, bloc de substitution sans contenu.
//
// Composant client : changer de niveau recalcule toute la page ici, dans le
// navigateur, avec le moteur déterministe (lib/analysis/recompute.ts). Le
// niveau affiché au chargement est celui de l'analyse enregistrée.
export function AnalysisResult({
  analysis: stored,
  unlockHref,
  before,
  children,
  rememberOnAccount = false,
  retry,
}: {
  analysis: ResultView;
  unlockHref: string;
  // Contenu au-dessus des blocs de lecture (bandeau d'exemple).
  before?: ReactNode;
  // Contenu sous les blocs (carte, avis, suppression).
  children?: ReactNode;
  // Compte connecté : le niveau choisi est aussi mémorisé sur le compte.
  rememberOnAccount?: boolean;
  // Offre incomplète : relance gratuite, juste sous la liste de ce qui manque.
  retry?: ReactNode;
}) {
  const [tier, setTier] = useState<Tier>(stored.profile_tier);
  // Changement de niveau : le bandeau est remonté (key) pour rejouer l'animation,
  // depuis le score affiché juste avant. prefers-reduced-motion : valeur finale
  // directement (règle globale de globals.css).
  const [replay, setReplay] = useState<{ count: number; from: number | null }>({ count: 0, from: null });
  const analysis = useMemo(() => recomputeForTier(stored, tier), [stored, tier]);

  function chooseTier(next: Tier) {
    if (next === tier) return;
    setReplay({ count: replay.count + 1, from: analysis.score?.value ?? null });
    setTier(next);
    rememberTier(next, rememberOnAccount);
  }

  const locked = !analysis.counter_offer || !analysis.ready_to_send_message;
  const incomplete = analysis.evaluability === "incomplete";
  // Sans montant de contre-offre (offre incomplète, ou montant déjà au-dessus de
  // la fourchette), le titre n'annonce pas de chiffre. Recalculé ici car la vue
  // verrouillée ne reçoit pas la contre-offre.
  const { estimate, deal } = analysis;
  const priced = counterOfferRange(deal.payment.amount_eur, estimate.total_low, estimate.total_high).low !== null;
  const counterOfferTitle = incomplete || !priced ? "Ta contre-offre" : undefined;
  return (
    <TierContext value={analysis.profile_tier}>
      <section aria-label="Verdict" className="on-marque grain bg-marque text-creme">
        <div className="mx-auto w-full max-w-5xl px-4 pt-6 pb-10 sm:px-6 lg:pt-10 lg:pb-14">
          <h1 className="sr-only">Résultat de l&apos;analyse de ton deal</h1>
          <ScoreBand key={replay.count} analysis={analysis} from={replay.from} showTier={!incomplete} />
        </div>
      </section>
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-12 px-4 pt-8 pb-16 sm:px-6 md:pt-12 md:pb-24 [&>*]:max-w-2xl">
        {before}
        {incomplete ? (
          <>
            <IncompleteCard missing={missingInformation(analysis)} />
            {retry}
          </>
        ) : analysis.evaluability === "terms_unknown" ? (
          <TermsUnknownCard deal={analysis.deal} estimate={analysis.estimate} missing={missingInformation(analysis)} />
        ) : analysis.evaluability === "unpriced" ? (
          <UnpricedCard confidence={analysis.confidence} />
        ) : null}
        {incomplete ? null : (
          <Estimate estimate={analysis.estimate}>
            <TierSelector tier={analysis.profile_tier} changeable={tierChangeAvailable(stored)} onChange={chooseTier} />
          </Estimate>
        )}
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
    </TierContext>
  );
}
