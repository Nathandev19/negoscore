import type { Metadata } from "next";
import { AnalysisResult } from "@/components/result/analysis-result";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { lockAnalysis } from "@/lib/analysis/lock";
import { sampleAnalysis } from "@/lib/sample-analysis";

export const metadata: Metadata = {
  title: "Résultat de l'analyse",
};

export default function DemoResultPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-10 px-4 pt-2 pb-12 sm:px-6 sm:pt-8">
        <AnalysisResult analysis={lockAnalysis(sampleAnalysis)} unlockHref="/connexion?next=%2Fanalyse" />
      </main>
      <SiteFooter />
    </>
  );
}
