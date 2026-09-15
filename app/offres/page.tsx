import type { Metadata } from "next";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { PLANS } from "@/lib/billing/plans";

export const metadata: Metadata = {
  title: "Offres",
};

export default function PlansPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 pt-6 pb-12 sm:px-6 sm:pt-12">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-black tracking-tight">Les offres</h1>
          <p className="text-neutral-700">Commence gratuitement. Passe à une offre quand tu reçois plus de deals.</p>
        </div>
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
              {plan.id === "free" ? null : (
                <Button type="button" disabled className="h-11 w-full">
                  Bientôt disponible
                </Button>
              )}
            </li>
          ))}
        </ul>
      </main>
      <SiteFooter />
    </>
  );
}
