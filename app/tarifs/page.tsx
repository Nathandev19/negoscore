import type { Metadata } from "next";
import { publicPageMetadata, softwareApplicationJsonLd } from "@/lib/seo";
import { JsonLd } from "@/components/seo/json-ld";
import Link from "next/link";
import { Suspense } from "react";
import { FirstPartyView } from "@/components/analytics/first-party-view";
import { MERCHANT } from "@/lib/billing/merchant";
import { OffersError } from "@/components/offers/offers-error";
import { OffersList } from "@/components/offers/offers-list";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = publicPageMetadata("/tarifs");

// Page statique (mission #045) : préchargée, affichée sans rendu serveur au
// clic. Le compte connecté et ?erreur= sont lus dans le navigateur
// (OffersList, OffersError) ; le paiement reste vérifié par /api/checkout.
export default function PlansPage() {
  return (
    <>
      {/* Les formules vendues, avec leurs prix repris de la source unique. Ni
          note, ni avis, ni nombre d'utilisateurs : nous n'en avons pas. */}
      <JsonLd data={softwareApplicationJsonLd()} />
      <SiteHeader />
      <FirstPartyView event="pricing_view" />
      <main id="contenu" className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-4 pt-10 pb-16 sm:px-6 md:pt-16 md:pb-24">
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
        {/* Mission #122 — « Prix TTC » n'existait que dans la balise meta de
            cette page : Google le lisait, l'acheteur non. La page qui VEND est
            la seule où ces deux faits comptent — ce que couvre le prix, et
            sous quel nom le prélèvement apparaîtra. */}
        <p className="text-sm text-attenue">
          Les prix affichés incluent la taxe applicable, collectée et reversée par Whop selon ton pays. Le paiement
          apparaît sur ton relevé bancaire sous le libellé «&nbsp;{MERCHANT.statementDescriptor}&nbsp;». Voir les{" "}
          <Link href="/cgv" className="link">conditions de vente</Link>.
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
