"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  Assumptions,
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
import { TIER_LABEL, type Tier } from "@/lib/rates/tier";
import { BAND_LABEL } from "@/lib/display";
import { formatEurRange } from "@/lib/money";

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
  retry,
}: {
  analysis: ResultView;
  unlockHref: string;
  // Contenu au-dessus des blocs de lecture (bandeau d'exemple).
  before?: ReactNode;
  // Contenu sous les blocs (carte, avis, suppression).
  children?: ReactNode;
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
    // Mémorisé pour les analyses suivantes, et sur le compte dès qu'une
    // session est ouverte, quelle que soit l'analyse (mission #065).
    rememberTier(next);
  }

  const locked = !analysis.counter_offer || !analysis.ready_to_send_message;
  const incomplete = analysis.evaluability === "incomplete";
  // Vide au chargement : une région live remplie dès son montage n'est pas
  // annoncée. Elle ne parle qu'après un changement de niveau.
  const range = formatEurRange(analysis.estimate.total_low, analysis.estimate.total_high);
  const announcement =
    replay.count === 0
      ? ""
      : [
          `Niveau « ${TIER_LABEL[analysis.profile_tier].short} ».`,
          analysis.score ? `Score : ${analysis.score.value} sur 100, ${BAND_LABEL[analysis.score.band].toLowerCase()}.` : null,
          range ? `Fourchette estimée : ${range}.` : null,
        ]
          .filter(Boolean)
          .join(" ");
  // Sans montant de contre-offre (offre incomplète, ou montant déjà au-dessus de
  // la fourchette), le titre n'annonce pas de chiffre. Recalculé ici car la vue
  // verrouillée ne reçoit pas la contre-offre.
  const { estimate, deal } = analysis;
  const priced = counterOfferRange(deal.payment.amount_eur, estimate.total_low, estimate.total_high).low !== null;
  const counterOfferTitle = incomplete || !priced ? "Ta contre-offre" : undefined;
  return (
    <TierContext value={analysis.profile_tier}>
      {/* Le bandeau et le h1 sont DANS main (mission #062, A9) : ils portent
          l'essentiel du résultat et n'étaient dans aucun point de repère. */}
      <main id="contenu" className="flex flex-1 flex-col">
        <section aria-label="Verdict" className="on-marque grain bg-marque text-creme">
          <div className="mx-auto w-full max-w-5xl px-4 pt-6 pb-10 sm:px-6 lg:pt-10 lg:pb-14">
            <h1 className="sr-only">Résultat de l&apos;analyse de ton deal</h1>
            <ScoreBand key={replay.count} analysis={analysis} from={replay.from} showTier={!incomplete} />
          </div>
        </section>
        {/* Changement de niveau : tout est recalculé dans le navigateur, sans
            rien recharger. Cette région, montée vide, dit ce qui a changé
            (mission #062, A3). */}
        <p role="status" aria-live="polite" className="sr-only">
          {announcement}
        </p>
        <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-12 px-4 pt-8 pb-16 sm:px-6 md:pt-12 md:pb-24 [&>*]:max-w-2xl">
        {before}
        {incomplete ? (
          <>
            <IncompleteCard missing={missingInformation(analysis)} />
            {/* Le bloc Estimation n'est pas rendu ici : sans ce rappel, un texte
                tronqué à l'analyse ne se voyait nulle part (mission #062, D1). */}
            <Assumptions items={analysis.estimate.assumptions} />
            {retry}
          </>
        ) : analysis.evaluability === "terms_unknown" ? (
          <TermsUnknownCard deal={analysis.deal} estimate={analysis.estimate} missing={missingInformation(analysis)} />
        ) : analysis.evaluability === "unpriced" ? (
          <UnpricedCard confidence={analysis.confidence} />
        ) : null}
        {incomplete ? null : (
          <Estimate estimate={analysis.estimate}>
            <TierSelector tier={analysis.profile_tier} original={stored.profile_tier} changeable={tierChangeAvailable(stored)} onChange={chooseTier} />
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
        </div>
      </main>
    </TierContext>
  );
}
