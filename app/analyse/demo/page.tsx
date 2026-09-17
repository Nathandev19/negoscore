import type { Metadata } from "next";
import { AnalysisResult } from "@/components/result/analysis-result";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { lockAnalysis } from "@/lib/analysis/lock";
import { sampleAnalysis } from "@/lib/sample-analysis";

export const metadata: Metadata = {
  title: "Exemple d'analyse",
};

export default function DemoResultPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-10 px-4 pt-2 pb-12 sm:px-6 sm:pt-8">
        <p role="note" className="rounded-xl border border-brand/25 bg-brand-tint p-4 text-small font-medium text-ink">
          Exemple figé, pas une vraie analyse : l&apos;offre est inventée et les montants ne sont pas recalculés. Pour
          chiffrer ton offre, colle-la sur la page Analyser un deal.
        </p>
        <AnalysisResult analysis={lockAnalysis(sampleAnalysis)} unlockHref="/connexion?next=%2Fanalyse" example />
      </main>
      <SiteFooter />
    </>
  );
}
