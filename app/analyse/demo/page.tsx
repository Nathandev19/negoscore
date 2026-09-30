import type { Metadata } from "next";
import Link from "next/link";
import { publicPageMetadata } from "@/lib/seo";
import { ViewPixel } from "@/components/analytics/view-pixel";
import { AnalysisResult } from "@/components/result/analysis-result";
import { SampleOfferQuote } from "@/components/result/sample-offer-quote";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { lockAnalysis } from "@/lib/analysis/lock";
import { sampleAnalysis } from "@/lib/sample-analysis";

export const metadata: Metadata = publicPageMetadata("/analyse/demo");

// Clés explicites sur les éléments passés en propriété (mission #127) : ce sont
// des éléments SERVEUR remis à un composant client, et React signale sinon une
// clé manquante en développement. Même raison, et même forme, que la clé
// « echange » de app/analyse/resultat/[id]/page.tsx.
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
        above={<SampleOfferQuote key="offre-source" />}
        before={
          <p key="avertissement" role="note" className="border-l-4 border-encre py-1 pl-3 text-small font-semibold text-encre">
            Exemple, pas une vraie analyse : l&apos;offre est inventée, mais la fourchette, le score et la contre-offre
            sont calculés par le moteur actuel, comme pour ton offre. Pour chiffrer ton offre, colle-la sur la page{" "}
            {/* Mission #126 — c'était du TEXTE. La phrase disait où aller sans
                y mener : les seuls liens vers /analyse étaient ceux de la
                navigation et du pied de page. Le texte, lui, ne change pas. */}
            <Link href="/analyse" className="link">
              Analyser un deal
            </Link>
            .
          </p>
        }
        beforeUnlock={
          /* Mission #126 — LA PAGE MÈNE ENFIN QUELQUE PART.
             Depuis #125 elle est une porte d'entrée : /exemple y conduit, et
             c'est le lien qui part en DM. Elle n'avait pourtant aucun appel à
             l'action dans son corps — il fallait remonter à la barre de
             navigation, ou sur mobile ouvrir le menu.

             Mission #127 — et il passe AVANT le mur d'email. Le but du produit
             n'est pas de collecter des adresses, c'est qu'une vraie offre soit
             collée : le placer après « Débloquer » le mettait derrière
             l'obstacle qui le concurrence. */
          <section
            key="analyser-la-tienne"
            aria-label="Analyser ton offre"
            className="flex flex-col gap-3 border-t-4 border-marque pt-5"
          >
            <h2 className="text-h2 font-bold tracking-tight">Et la tienne, elle vaut combien&nbsp;?</h2>
            <p className="measure">
              Colle le message que la marque t&apos;a envoyé : tu obtiens le même résultat, sur ton offre à toi.
              C&apos;est gratuit et sans compte.
            </p>
            <Button asChild size="lg" className="mt-1 h-12 w-full text-base sm:w-fit">
              <Link href="/analyse">Analyser mon deal</Link>
            </Button>
          </section>
        }
      />
      <SiteFooter />
    </>
  );
}
