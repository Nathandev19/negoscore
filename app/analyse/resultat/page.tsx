import type { Metadata } from "next";
import { StoredAnalysis } from "@/components/result/stored-analysis";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = {
  title: "Résultat de l'analyse",
};

export default function ResultPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-10 px-4 pt-2 pb-12 sm:px-6 sm:pt-8">
        <StoredAnalysis />
      </main>
      <SiteFooter />
    </>
  );
}
