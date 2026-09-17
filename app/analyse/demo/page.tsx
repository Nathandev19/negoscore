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
      <SiteHeader tone="marque" />
      <AnalysisResult
        analysis={lockAnalysis(sampleAnalysis)}
        unlockHref="/connexion?next=%2Fanalyse"
        before={
          <p role="note" className="border-l-4 border-encre py-1 pl-3 text-small font-semibold text-encre">
            Exemple, pas une vraie analyse : l&apos;offre est inventée, mais la fourchette, le score et la contre-offre
            sont calculés par le moteur actuel, comme pour ton offre. Pour chiffrer ton offre, colle-la sur la page
            Analyser un deal.
          </p>
        }
      />
      <SiteFooter />
    </>
  );
}
