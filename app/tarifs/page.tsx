import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PaywallView } from "@/components/analytics/paywall-view";
import { OffersError } from "@/components/offers/offers-error";
import { OffersList } from "@/components/offers/offers-list";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = {
  title: "Tarifs",
};

// Page statique (mission #045) : préchargée, affichée sans rendu serveur au
// clic. Le compte connecté et ?erreur= sont lus dans le navigateur
// (OffersList, OffersError) ; le paiement reste vérifié par /api/checkout.
export default function PlansPage() {
  return (
    <>
      <SiteHeader />
      <PaywallView />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-4 pt-10 pb-16 sm:px-6 md:pt-16 md:pb-24">
        <div className="flex flex-col gap-2">
          <h1 className="text-h1 font-extrabold">Tarifs</h1>
          <p>Commence gratuitement. Passe à une formule quand tu reçois plus de deals.</p>
        </div>
        <Suspense fallback={null}>
          <OffersError />
        </Suspense>
        {/* Formules séparées par des filets, pas trois cartes identiques : une seule
            mise en avant, avec le seul bouton plein de la page. */}
        <OffersList />
        <p className="text-sm text-attenue">
          Paiement opéré par Whop. Voir les <Link href="/cgv" className="link">conditions de vente</Link>.
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
