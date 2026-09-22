import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = {
  title: "Connexion momentanément indisponible",
  robots: { index: false, follow: false },
};

// Mission #089 — page de compte demandée pendant une panne de Supabase Auth.
// proxy.ts réécrit la requête vers cette page : l'adresse reste celle de la
// page demandée, et la recharger réessaie. Elle ne dit ni « connecte-toi » ni
// « tu n'es pas connectée » : on ne sait rien de la session.

export default function SessionUnavailablePage() {
  return (
    <>
      <SiteHeader />
      <main id="contenu" className="mx-auto flex w-full max-w-md flex-1 flex-col gap-8 px-4 pt-10 pb-16 sm:px-6 md:pt-16 md:pb-24">
        <div className="flex flex-col gap-3">
          <h1 className="text-h1 font-extrabold">Ton compte est momentanément injoignable</h1>
          <p>
            La vérification de ta connexion ne répond pas pour le moment. Tu n&apos;as rien à refaire : recharge la page dans
            un instant.
          </p>
        </div>
        <Link href="/" className="link flex min-h-11 w-fit items-center font-semibold">
          Retour à l&apos;accueil
        </Link>
      </main>
      <SiteFooter />
    </>
  );
}
