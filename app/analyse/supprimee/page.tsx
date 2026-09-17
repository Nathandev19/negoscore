import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Analyse supprimée",
  robots: { index: false, follow: false },
};

export default function AnalysisDeletedPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-4 pt-6 pb-12 sm:px-6 sm:pt-12">
        <h1 className="text-h1 font-extrabold tracking-tight">Analyse supprimée</h1>
        <p>L&apos;analyse, le texte de l&apos;offre et le fichier déposé ont été supprimés.</p>
        <Button asChild className="h-12 text-base">
          <Link href="/analyse">Analyser un autre deal</Link>
        </Button>
      </main>
      <SiteFooter />
    </>
  );
}
