"use client";

import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";

// Erreur inattendue au rendu d'une page : même langage visuel que le reste du
// site, une seule action (réessayer), et aucun détail technique affiché.
export default function ErrorPage({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <>
      <SiteHeader />
      <main id="contenu" className="mx-auto flex w-full max-w-md flex-1 flex-col gap-8 px-4 pt-10 pb-16 sm:px-6 md:pt-16 md:pb-24">
        <div className="flex flex-col gap-3">
          <h1 className="text-h1 font-extrabold">Cette page n&apos;a pas pu s&apos;afficher</h1>
          <p>Réessaie dans un instant. Si ça continue, reviens à l&apos;accueil.</p>
        </div>
        <div className="flex flex-col gap-2">
          <Button type="button" size="lg" className="h-12 text-base" onClick={() => retry()}>
            Réessayer
          </Button>
          <Link href="/" className="link flex min-h-11 w-fit items-center font-semibold">
            Retour à l&apos;accueil
          </Link>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
