import type { Metadata } from "next";
import { publicPageMetadata } from "@/lib/seo";
import { ViewPixel } from "@/components/analytics/view-pixel";
import { AnalysisResult } from "@/components/result/analysis-result";
import { SampleOfferQuote } from "@/components/result/sample-offer-quote";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { lockAnalysis } from "@/lib/analysis/lock";
import { sampleAnalysis } from "@/lib/sample-analysis";

export const metadata: Metadata = publicPageMetadata("/analyse/demo");

export default function DemoResultPage() {
  return (
    <>
      <SiteHeader tone="marque" />
      {/* Mission #120 — la vue, et d'où vient le clic (?de=). Le
          paramètre ne crée pas d'adresse dupliquée : la canonique
          déclarée par publicPageMetadata reste /analyse/demo. */}
      <ViewPixel page="/analyse/demo" />
      {/* Mission #125 — `above` porte le message de marque qui a produit ce
          verdict, juste avant le score. Sans lui, la page affirmait un chiffre
          sans jamais montrer ce qu'elle avait lu. */}
      <AnalysisResult
        analysis={lockAnalysis(sampleAnalysis)}
        unlockHref="/connexion?next=%2Fanalyse"
        above={<SampleOfferQuote />}
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
