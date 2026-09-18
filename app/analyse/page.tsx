import type { Metadata } from "next";
import { publicPageMetadata } from "@/lib/seo";
import { DealInput } from "@/components/deal-input";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = publicPageMetadata("/analyse");

// Formulaire d'analyse envoyé sans JavaScript (mission #075) : l'action
// serveur attend l'analyse, comme la route /api/analyse. Même délai maximal.
export const maxDuration = 120;

export default function AnalysePage() {
  return (
    <>
      <SiteHeader />
      <main id="contenu" className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 pt-6 pb-16 sm:px-6 md:pt-16 md:pb-24">
        <div className="flex flex-col gap-2">
          <h1 className="text-h1 font-extrabold">Montre-nous l&apos;offre</h1>
          <p>
            Colle le message, envoie une capture d&apos;écran ou le PDF du brief.
          </p>
        </div>
        <DealInput />
      </main>
      <SiteFooter />
    </>
  );
}
