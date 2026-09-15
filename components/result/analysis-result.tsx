import {
  DealRecap,
  Estimate,
  GoodPoints,
  LegalNotice,
  NegotiateList,
  RedFlags,
} from "@/components/result/analysis-blocks";
import { LockedCounterOffer, LockedMessage } from "@/components/result/locked-blocks";
import { ScoreCard } from "@/components/result/score-card";
import { UnlockDialog } from "@/components/result/unlock-dialog";
import type { Analysis } from "@/lib/schema";

export function AnalysisResult({ analysis }: { analysis: Analysis }) {
  return (
    <>
      <h1 className="sr-only">Résultat de l&apos;analyse de ton deal</h1>
      <ScoreCard score={analysis.score} confidence={analysis.confidence} />
      <DealRecap deal={analysis.deal} />
      <GoodPoints items={analysis.good_points} />
      <NegotiateList items={analysis.negotiate} />
      <RedFlags items={analysis.red_flags} />
      <LegalNotice legal={analysis.fr_legal} />
      <Estimate estimate={analysis.estimate} />
      <LockedCounterOffer offer={analysis.counter_offer} />
      <LockedMessage message={analysis.ready_to_send_message} />
      <UnlockDialog />
    </>
  );
}
