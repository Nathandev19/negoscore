import type { Metadata } from "next";
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
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { sampleAnalysis } from "@/lib/sample-analysis";

export const metadata: Metadata = {
  title: "Résultat de l'analyse",
};

export default function DemoResultPage() {
  const analysis = sampleAnalysis;

  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-10 px-4 pt-2 pb-12 sm:px-6 sm:pt-8">
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
      </main>
      <SiteFooter />
    </>
  );
}
