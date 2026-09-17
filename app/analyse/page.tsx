import type { Metadata } from "next";
import { DealInput } from "@/components/deal-input";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = {
  title: "Analyser un deal",
};

export default function AnalysePage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 pt-6 pb-16 sm:px-6 md:pt-16 md:pb-24">
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
