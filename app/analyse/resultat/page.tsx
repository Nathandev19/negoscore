import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Résultat de l'analyse",
};

export default function ResultPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-10 px-4 pt-2 pb-12 sm:px-6 sm:pt-8">
        <div className="flex flex-col gap-4 py-12">
          <h1 className="text-3xl font-black tracking-tight">Aucune analyse à afficher</h1>
          <p className="text-neutral-700">Lance une analyse pour voir le résultat ici.</p>
          <Button asChild size="lg" className="h-12 text-base">
            <Link href="/analyse">Analyser mon deal</Link>
          </Button>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
