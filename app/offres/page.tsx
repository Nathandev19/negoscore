import type { Metadata } from "next";
import Link from "next/link";
import { PaywallView } from "@/components/analytics/paywall-view";
import { PlanCheckoutForm } from "@/components/offers/plan-checkout-form";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { getViewer } from "@/lib/auth/viewer";
import { isCancelled, isProActive, periodEndsAt, type PlanState } from "@/lib/billing/plan-access";
import { FEATURED_PLAN, PLANS } from "@/lib/billing/plans";
import { selectRows } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

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
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-4 pt-10 pb-16 sm:px-6 md:pt-16 md:pb-24">
        <div className="flex flex-col gap-2">
          <h1 className="text-h1 font-extrabold">Les offres</h1>
          <p>Commence gratuitement. Passe à une offre quand tu reçois plus de deals.</p>
        </div>
        {error ? (
          <p role="alert" className="alert-bad py-1 text-sm">
            {error}
          </p>
        ) : null}
        {/* Offres séparées par des filets, pas trois cartes identiques : une seule
            mise en avant, avec le seul bouton plein de la page. */}
        <ul className="flex flex-col">
          {PLANS.map((plan) => {
            // Même prix, même plan Whop, même parcours : seule la présentation change.
            const asRecharge = proActive && plan.id === "pack";
            // Abonnement en cours : on ne le revend pas, on dit où il en est.
            const isCurrentPro = proActive && plan.id === "pro";
            const featured = plan.id === FEATURED_PLAN;
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
            <li
              key={plan.id}
              className={cn(
                "grid gap-x-10 gap-y-4 border-t py-8 last:border-b md:grid-cols-[15rem_1fr_16rem] md:items-start",
                featured ? "border-encre md:py-10 [&+li]:border-t-encre" : "border-filet",
              )}
            >
              <div className="flex flex-col gap-1">
                <h2 className={cn("font-bold", featured ? "text-h2" : "text-h3")}>{name}</h2>
                <p className={cn("figures tracking-tight text-encre", featured ? "text-5xl" : "text-3xl")}>
                  {plan.price}
                  {plan.period ? <span className="font-sans text-base font-medium text-attenue"> {plan.period}</span> : null}
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <p className="font-semibold text-encre">{summary}</p>
                <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
                  {features.map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>
              </div>
              {isCurrentPro ? (
                <div className="flex flex-col gap-1">
                  <p className="alert-bad py-1 text-sm">
                    {proCancelled
                      ? proEndsAtLabel
                        ? `Ton offre en cours. Elle prend fin le ${proEndsAtLabel}.`
                        : "Ton offre en cours. Elle prend fin à la fin de la période."
                      : proEndsAtLabel
                        ? `Ton offre en cours, jusqu'au ${proEndsAtLabel}.`
                        : "Ton offre en cours."}
                  </p>
                  {proCancelled ? null : (
                    <Link href="/resilier" className="link flex min-h-11 w-fit items-center text-sm">
                      Résilier votre contrat
                    </Link>
                  )}
                </div>
              ) : plan.id === "free" ? (
                <Link href="/analyse" className="link flex min-h-11 w-fit items-center font-semibold">
                  Analyser un deal
                </Link>
              ) : user ? (
                <PlanCheckoutForm
                  plan={plan.id}
                  label={asRecharge ? "Recharger" : `Prendre ${plan.name}`}
                  primary={featured}
                />
              ) : featured ? (
                <Button asChild size="lg" className="h-12 w-full text-base">
                  <Link href={`/connexion?next=${encodeURIComponent("/offres")}`}>Se connecter pour payer</Link>
                </Button>
              ) : (
                <Link
                  href={`/connexion?next=${encodeURIComponent("/offres")}`}
                  className="link flex min-h-11 w-fit items-center font-semibold"
                >
                  Se connecter pour payer
                </Link>
              )}
            </li>
            );
          })}
        </ul>
        <p className="text-sm text-attenue">
          Paiement opéré par Whop. Voir les <Link href="/cgv" className="link">conditions de vente</Link>.
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
