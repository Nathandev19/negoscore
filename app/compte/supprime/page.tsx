import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = {
  title: "Compte supprimé",
  robots: { index: false, follow: false },
};

export default function AccountDeletedPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-8 px-4 pt-10 pb-16 sm:px-6 md:pt-16 md:pb-24">
        <h1 className="text-h1 font-extrabold">Ton compte est supprimé</h1>
        <p>
          Tes offres, leurs fichiers, tes analyses et tes crédits ont été supprimés. Un email de confirmation t&apos;a été
          envoyé.
        </p>
        <Link href="/" className="link flex min-h-11 w-fit items-center font-semibold">
          Retour à l&apos;accueil
        </Link>
      </main>
      <SiteFooter />
    </>
  );
}
