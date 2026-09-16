import type { Metadata } from "next";
import Link from "next/link";
import { PaywallView } from "@/components/analytics/paywall-view";
import { PlanCheckoutForm } from "@/components/offers/plan-checkout-form";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { getViewer } from "@/lib/auth/viewer";
import { isCancelled, isProActive, periodEndsAt, type PlanState } from "@/lib/billing/plan-access";
import { PLANS } from "@/lib/billing/plans";
import { selectRows } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Offres",
};

const ERRORS: Record<string, string> = {
  consentement: "Coche la case avant de continuer vers le paiement.",
  offre: "Cette offre n'existe pas.",
  indisponible: "Le paiement n'est pas disponible pour le moment. Réessaie dans quelques minutes.",
  deja_pro: "Ton abonnement Pro est déjà en cours : inutile de le reprendre.",
};

const DATE = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" });

export default async function PlansPage({ searchParams }: PageProps<"/offres">) {
  const params = await searchParams;
  const error = typeof params.erreur === "string" ? ERRORS[params.erreur] : null;
  const user = await getViewer();
  // Pour un abonné Pro en cours, le Pack n'est pas une offre concurrente :
  // c'est la recharge qui prend le relais quand le quota mensuel est atteint.
  const [credits] = user
    ? await selectRows<PlanState>("credits", `select=plan,balance,period_end,cancelled_at&user_id=eq.${user.id}&limit=1`)
    : [];
  const proActive = isProActive(credits ?? null);
  const proCancelled = proActive && isCancelled(credits ?? null);
  const proEndsAt = periodEndsAt(credits ?? null);
  const proEndsAtLabel = proEndsAt ? DATE.format(proEndsAt) : null;

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
          {PLANS.map((plan) => {
            // Même prix, même plan Whop, même parcours : seule la présentation change.
            const asRecharge = proActive && plan.id === "pack";
            // Abonnement en cours : on ne le revend pas, on dit où il en est.
            const isCurrentPro = proActive && plan.id === "pro";
            const name = asRecharge ? "Recharge" : plan.name;
            const summary = asRecharge ? "3 analyses supplémentaires" : plan.summary;
            const features = asRecharge
              ? [
                  "Utilisables quand ton quota mensuel est atteint",
                  "Sans date d'expiration",
                  "Conservées si tu résilies ton abonnement",
                ]
              : plan.features;
            return (
            <li key={plan.id} className="flex flex-col gap-4 rounded-xl border bg-white p-5">
              <div className="flex flex-col gap-1">
                <h2 className="text-lg font-bold">{name}</h2>
                <p className="text-3xl font-black tracking-tight">
                  {plan.price}
                  {plan.period ? <span className="text-base font-medium text-neutral-600"> {plan.period}</span> : null}
                </p>
                <p className="font-medium">{summary}</p>
              </div>
              <ul className="flex flex-1 list-disc flex-col gap-1 pl-5 text-sm text-neutral-700">
                {features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
              {isCurrentPro ? (
                <div className="flex flex-col gap-2">
                  <p className="rounded-xl border border-neutral-300 bg-neutral-50 p-3 text-sm font-medium">
                    {proCancelled
                      ? proEndsAtLabel
                        ? `Ton offre en cours. Elle prend fin le ${proEndsAtLabel}.`
                        : "Ton offre en cours. Elle prend fin à la fin de la période."
                      : proEndsAtLabel
                        ? `Ton offre en cours, jusqu'au ${proEndsAtLabel}.`
                        : "Ton offre en cours."}
                  </p>
                  {proCancelled ? null : (
                    <Link href="/resilier" className="text-center text-sm text-neutral-600 underline">
                      Résilier votre contrat
                    </Link>
                  )}
                </div>
              ) : plan.id === "free" ? (
                <Button asChild variant="outline" className="h-11 w-full">
                  <Link href="/analyse">Analyser un deal</Link>
                </Button>
              ) : user ? (
                <PlanCheckoutForm plan={plan.id} label={asRecharge ? "Recharger" : `Prendre ${plan.name}`} />
              ) : (
                <Button asChild className="h-11 w-full">
                  <Link href={`/connexion?next=${encodeURIComponent("/offres")}`}>Se connecter pour payer</Link>
                </Button>
              )}
            </li>
            );
          })}
        </ul>
        <p className="text-sm text-neutral-600">
          Paiement opéré par Whop. Voir les <Link href="/cgv" className="underline">conditions de vente</Link>.
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
