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
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-12 px-4 pt-6 pb-16 sm:px-6 md:pt-12 md:pb-24">
        <p role="note" className="border-y border-encre py-3 text-small font-medium text-encre">
          Exemple figé, pas une vraie analyse : l&apos;offre est inventée et les montants ne sont pas recalculés. Pour
          chiffrer ton offre, colle-la sur la page Analyser un deal.
        </p>
        <AnalysisResult analysis={lockAnalysis(sampleAnalysis)} unlockHref="/connexion?next=%2Fanalyse" example />
      </main>
      <SiteFooter />
    </>
  );
}
