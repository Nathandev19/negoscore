import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Page introuvable",
  robots: { index: false, follow: false },
};

// Remplace la page 404 par défaut de Next.js, qui suit le thème sombre du
// système et sort du langage visuel du site.
export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main id="contenu" className="mx-auto flex w-full max-w-md flex-1 flex-col gap-8 px-4 pt-10 pb-16 sm:px-6 md:pt-16 md:pb-24">
        <div className="flex flex-col gap-3">
          <p className="figures text-6xl text-attenue">404</p>
          <h1 className="text-h1 font-extrabold">Page introuvable</h1>
          <p>Cette page n&apos;existe pas, ou tu n&apos;y as pas accès depuis ce navigateur.</p>
        </div>
        <Button asChild size="lg" className="h-12 text-base">
          <Link href="/analyse">Analyser un deal</Link>
        </Button>
      </main>
      <SiteFooter />
    </>
  );
}
