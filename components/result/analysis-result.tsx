"use client";

import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
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
import { SentMessageContext } from "@/components/result/negotiation/sent-message";
import { CounterOffer, MESSAGE_ANCHOR, ReadyMessage } from "@/components/result/unlocked-blocks";
import { IncompleteCard, TermsUnknownCard, UnpricedCard } from "@/components/result/verdict-card";
import { counterOfferRange, counterSameAsEstimate } from "@/lib/analysis/anchoring";
import { missingInformation } from "@/lib/analysis/evaluability";
import type { ResultView } from "@/lib/analysis/lock";
import { recomputeForDeal, recomputeForTier, tierChangeAvailable } from "@/lib/analysis/recompute";
import { computeFrLegal } from "@/lib/legal/fr";
import { changedGroups, splitByChange, type Negotiated } from "@/lib/negotiation/current";
import { TIER_LABEL, type Tier } from "@/lib/rates/tier";
import { BAND_LABEL } from "@/lib/display";
import { formatEurRange } from "@/lib/money";
import { isShowing, showOnce } from "@/lib/shown-once";

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
// Ancre d'arrivée lue une fois par chargement, pour le chemin où elle a été
// vue : elle est retirée de l'adresse juste après, et le signal ne doit pas
// s'éteindre pour autant — ni se rallumer sur une autre analyse.
// Mission #068 : l'arrivée est enregistrée dans le registre « montré une
// fois » (lib/shown-once.ts). Quitter la page par un lien interne consomme la
// pastille ; y revenir sans rechargement ne la réaffiche plus.
let arrivalPath: string | null | undefined;
// Le déplacement vers le message n'a lieu qu'une fois par chargement.
let arrivalHandled = false;

export function readArrival(): boolean {
  if (arrivalPath === undefined) {
    arrivalPath = window.location.hash === `#${MESSAGE_ANCHOR}` ? window.location.pathname : null;
    if (arrivalPath !== null) showOnce(UNLOCKED_KEY, arrivalPath);
  }
  return isShowing(UNLOCKED_KEY, window.location.pathname);
}

const noSubscription = () => () => undefined;

const UNLOCKED_KEY = "debloque";

export function AnalysisResult({
  analysis: stored,
  unlockHref,
  before,
  children,
  retry,
  afterMessage,
  analysisId = null,
  negotiated = null,
}: {
  analysis: ResultView;
  unlockHref: string;
  // Contenu au-dessus des blocs de lecture (bandeau d'exemple).
  before?: ReactNode;
  // Contenu sous les blocs (carte, avis, suppression).
  children?: ReactNode;
  // Offre incomplète : relance gratuite, juste sous la liste de ce qui manque.
  retry?: ReactNode;
  // Sous le message à envoyer : la suite de l'échange avec la marque (#080).
  afterMessage?: ReactNode;
  // Propriétaire connecté seulement : copier un message l'enregistre comme
  // message envoyé (mission #080 bis). null : simple copie.
  analysisId?: string | null;
  // Mission #084 — termes actuels après les tours de négociation. null : aucun
  // tour, la page décrit l'offre telle qu'elle a été analysée.
  negotiated?: Negotiated | null;
}) {
  const [tier, setTier] = useState<Tier>(stored.profile_tier);
  // Changement de niveau : le bandeau est remonté (key) pour rejouer l'animation,
  // depuis le score affiché juste avant. prefers-reduced-motion : valeur finale
  // directement (règle globale de globals.css).
  const [replay, setReplay] = useState<{ count: number; from: number | null }>({ count: 0, from: null });
  // origin : l'offre analysée, au niveau choisi. C'est sur elle que portent la
  // contre-offre et le premier message, déjà envoyés. analysis : ce que le code
  // déduit des termes (score, fourchette, deal, loi), recalculé sur les termes
  // ACTUELS après un tour (mission #084), sans appel au modèle.
  const origin = useMemo(() => recomputeForTier(stored, tier), [stored, tier]);
  // Table de l'analyse disparue du code (mission #085) : rien n'est recalculé,
  // score et fourchette restent ceux enregistrés, et la page le dit. Le deal
  // et la loi, qui ne dépendent d'aucune table, suivent les termes actuels.
  const recomputed = useMemo(() => (negotiated ? recomputeForDeal(origin, negotiated.deal) : origin), [origin, negotiated]);
  const analysis = recomputed ?? origin;
  const unpriced = negotiated !== null && recomputed === null;
  const currentDeal = negotiated?.deal ?? analysis.deal;
  const legal = unpriced ? computeFrLegal(currentDeal) : analysis.fr_legal;
  // Textes du modèle, écrits sur l'offre d'origine : un point dont le terme a
  // changé depuis est retiré, et le bloc dit d'où il vient.
  const changed = useMemo(() => (negotiated ? changedGroups(stored.deal, negotiated.deal) : null), [stored.deal, negotiated]);
  const fromOrigin = <T extends { label: string; why: string }>(items: readonly T[]) => {
    if (!negotiated || !changed) return { items: [...items], origin: undefined };
    const { kept, withdrawn } = splitByChange(items, changed);
    return { items: kept, origin: { withdrawn: withdrawn.map((item) => item.label) } };
  };
  const negotiate = fromOrigin(origin.negotiate);
  const redFlags = fromOrigin(origin.red_flags);
  const goodPoints = fromOrigin(origin.good_points);

  function chooseTier(next: Tier) {
    if (next === tier) return;
    setReplay({ count: replay.count + 1, from: analysis.score?.value ?? null });
    setTier(next);
    // Mémorisé pour les analyses suivantes, et sur le compte dès qu'une
    // session est ouverte, quelle que soit l'analyse (mission #065).
    rememberTier(next);
  }

  const locked = !origin.counter_offer || !origin.ready_to_send_message;
  const incomplete = analysis.evaluability === "incomplete";

  // Arrivée juste après la connexion qui débloque (mission #067) : le lien
  // « Débloquer » ramène sur #message. La page va alors directement au message
  // prêt à envoyer et signale une fois les deux blocs qui viennent de s'ouvrir.
  const arrivedOnMessage = useSyncExternalStore(noSubscription, readArrival, () => false);
  const justUnlocked = arrivedOnMessage && !locked;
  useEffect(() => {
    if (!justUnlocked || arrivalHandled) return;
    const target = document.getElementById(MESSAGE_ANCHOR);
    if (!target) return;
    arrivalHandled = true;
    // Mouvement réduit demandé : saut direct, sans défilement animé.
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    // Le focus suit : un lecteur d'écran repart du titre du message.
    target.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
    // Ancre retirée de l'adresse : un rechargement ne rejoue ni le déplacement
    // ni le signal « Débloqué à l'instant ».
    window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
  }, [justUnlocked]);
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
  // Contre-offre du premier message : calculée sur l'offre d'origine.
  const { estimate, deal } = origin;
  const priced = counterOfferRange(deal.payment.amount_eur, estimate.total_low, estimate.total_high).low !== null;
  // Mission #099 (audit C1) : sur une offre incomplète, le titre dit ce que le
  // bloc contient vraiment — des points à demander, pas un chiffrage.
  const counterOfferTitle = incomplete ? "Ce que tu peux demander" : !priced ? "Ta contre-offre" : undefined;
  // Mission #082 : contre-offre visible (débloquée) ET identique à la
  // fourchette : les deux ne s'affichent qu'une fois, sur une seule ligne.
  // Après un tour, la fourchette affichée est celle des termes actuels : la
  // contre-offre d'origine n'est plus fusionnée avec elle.
  const counterSame = negotiated ? null : counterSameAsEstimate(deal.payment.amount_eur, origin.counter_offer, estimate);
  return (
    <TierContext value={analysis.profile_tier}>
    <SentMessageContext value={{ analysisId, firstMessage: origin.ready_to_send_message?.text ?? null }}>
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
        {negotiated && !unpriced ? (
          <p role="note" className="border-l-4 border-encre py-1 pl-3 text-small">
            Score, fourchette et deal sont à jour des termes du tour {negotiated.turn}. Ta contre-offre et ton premier
            message restent ceux du début de l&apos;échange, calculés sur l&apos;offre d&apos;origine.
          </p>
        ) : null}
        {negotiated && unpriced ? (
          <p role="note" className="border-l-4 border-encre py-1 pl-3 text-small">
            Le deal est à jour des termes du tour {negotiated.turn}. Le score et la fourchette, eux, restent ceux de
            l&apos;offre d&apos;origine : la table de tarifs {stored.estimate.rate_table_version} de cette analyse
            n&apos;existe plus dans l&apos;outil, ils ne peuvent pas être recalculés sur les termes actuels.
          </p>
        ) : null}
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
          <Estimate estimate={analysis.estimate} counterSame={counterSame !== null}>
            <TierSelector tier={analysis.profile_tier} changeable={tierChangeAvailable(stored)} onChange={chooseTier} />
          </Estimate>
        )}
        {/* Mission #097 — ce sur quoi elle doit agir vient avant ce qui le
            commente : contre-offre et message d'abord, avec la suite de
            l'échange ; les conseils et le commentaire ensuite. */}
        {origin.counter_offer ? (
          <CounterOffer
            offer={origin.counter_offer}
            title={counterOfferTitle}
            justUnlocked={justUnlocked}
            sameAsEstimate={counterSame}
            missing={incomplete ? missingInformation(analysis) : []}
          />
        ) : (
          <LockedCounterOfferPlaceholder title={counterOfferTitle} />
        )}
        {origin.ready_to_send_message ? (
          <ReadyMessage message={origin.ready_to_send_message} justUnlocked={justUnlocked} />
        ) : (
          <LockedMessagePlaceholder />
        )}
        {locked ? <UnlockCta href={unlockHref} /> : null}
        {afterMessage}
        <NegotiateList items={negotiate.items} origin={negotiate.origin} />
        <DealRecap deal={currentDeal} updatedAtTurn={negotiated?.turn ?? null} />
        <RedFlags items={redFlags.items} origin={redFlags.origin} />
        <GoodPoints items={goodPoints.items} origin={goodPoints.origin} />
        <LegalNotice legal={legal} />
        {children}
        </div>
      </main>
    </SentMessageContext>
    </TierContext>
  );
}
