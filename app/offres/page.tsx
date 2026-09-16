import type { Metadata } from "next";
import Link from "next/link";
import { PaywallView } from "@/components/analytics/paywall-view";
import { PlanCheckoutForm } from "@/components/offers/plan-checkout-form";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { getViewer } from "@/lib/auth/viewer";
import { PLANS } from "@/lib/billing/plans";

export const metadata: Metadata = {
  title: "Offres",
};

const ERRORS: Record<string, string> = {
  consentement: "Coche la case avant de continuer vers le paiement.",
  offre: "Cette offre n'existe pas.",
  indisponible: "Le paiement n'est pas disponible pour le moment. Réessaie dans quelques minutes.",
};

export default async function PlansPage({ searchParams }: PageProps<"/offres">) {
  const params = await searchParams;
  const error = typeof params.erreur === "string" ? ERRORS[params.erreur] : null;
  const user = await getViewer();

  return (
    <>
      <SiteHeader />
      <PaywallView />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 pt-6 pb-12 sm:px-6 sm:pt-12">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-black tracking-tight">Les offres</h1>
          <p className="text-neutral-700">Commence gratuitement. Passe à une offre quand tu reçois plus de deals.</p>
        </div>
        {error ? (
          <p role="alert" className="text-sm font-medium text-red-700">
            {error}
          </p>
        ) : null}
        <ul className="grid gap-4 md:grid-cols-3">
          {PLANS.map((plan) => (
            <li key={plan.id} className="flex flex-col gap-4 rounded-xl border bg-white p-5">
              <div className="flex flex-col gap-1">
                <h2 className="text-lg font-bold">{plan.name}</h2>
                <p className="text-3xl font-black tracking-tight">
                  {plan.price}
                  {plan.period ? <span className="text-base font-medium text-neutral-600"> {plan.period}</span> : null}
                </p>
                <p className="font-medium">{plan.summary}</p>
              </div>
              <ul className="flex flex-1 list-disc flex-col gap-1 pl-5 text-sm text-neutral-700">
                {plan.features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
              {plan.id === "free" ? (
                <Button asChild variant="outline" className="h-11 w-full">
                  <Link href="/analyse">Analyser un deal</Link>
                </Button>
              ) : user ? (
                <PlanCheckoutForm plan={plan.id} label={`Prendre ${plan.name}`} />
              ) : (
                <Button asChild className="h-11 w-full">
                  <Link href={`/connexion?next=${encodeURIComponent("/offres")}`}>Se connecter pour payer</Link>
                </Button>
              )}
            </li>
          ))}
        </ul>
        <p className="text-sm text-neutral-600">
          Paiement opéré par Whop. Voir les <Link href="/cgv" className="underline">conditions de vente</Link>.
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
