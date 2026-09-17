import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Compte supprimé",
  robots: { index: false, follow: false },
};

export default function AccountDeletedPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-4 pt-6 pb-12 sm:px-6 sm:pt-12">
        <h1 className="text-3xl font-black tracking-tight">Ton compte est supprimé</h1>
        <p className="text-neutral-700">
          Tes offres, leurs fichiers, tes analyses et tes crédits ont été supprimés. Un email de confirmation t&apos;a été
          envoyé.
        </p>
        <Button asChild variant="outline" className="h-11">
          <Link href="/">Retour à l&apos;accueil</Link>
        </Button>
      </main>
      <SiteFooter />
    </>
  );
}
