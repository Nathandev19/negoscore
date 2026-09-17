"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { PlanCheckoutForm } from "@/components/offers/plan-checkout-form";
import { Button } from "@/components/ui/button";
import { hasSessionHint } from "@/lib/auth/session-hint";
import { isCancelled, isProActive, periodEndsAt, type PlanState } from "@/lib/billing/plan-access";
import { FEATURED_PLAN, PLANS } from "@/lib/billing/plans";
import { cn } from "@/lib/utils";

const DATE = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" });
const LOGIN_HREF = `/connexion?next=${encodeURIComponent("/tarifs")}`;

// Le cookie indicateur ne change qu'avec un chargement complet de page.
const subscribe = () => () => undefined;

// Liste des formules (mission #045) : la page /tarifs est statique, et ce
// composant choisit les boutons dans le navigateur.
//   - Rendu serveur et avant hydratation : l'état de la majorité des visiteurs,
//     « Se connecter pour payer ».
//   - Indicateur de session présent (ns_session) : boutons de paiement. C'est un
//     choix d'AFFICHAGE seulement : /api/checkout vérifie la session auprès de
//     Supabase, renvoie vers la connexion si elle n'est plus valide, et refuse
//     un second abonnement Pro.
//   - Compte lu par /api/credits (session vérifiée côté serveur) : présentation
//     d'un abonné Pro en cours (Pack affiché comme recharge, Pro comme formule en
//     cours) ; session invalide : retour à l'état non connecté.
export function OffersList() {
  const hinted = useSyncExternalStore(subscribe, () => hasSessionHint(document.cookie), () => false);
  // undefined : pas encore lu ; null : pas de session valide.
  const [credits, setCredits] = useState<PlanState | null | undefined>(undefined);

  useEffect(() => {
    if (!hinted) return;
    let stale = false;
    fetch("/api/credits", { cache: "no-store" })
      .then(async (response) => (response.ok ? ((await response.json()) as PlanState) : null))
      .catch(() => undefined)
      .then((value) => {
        if (!stale && value !== undefined) setCredits(value);
      });
    return () => {
      stale = true;
    };
  }, [hinted]);

  const signedIn = hinted && credits !== null;
  const proActive = isProActive(credits ?? null);
  const proCancelled = proActive && isCancelled(credits ?? null);
  const proEndsAt = periodEndsAt(credits ?? null);
  const proEndsAtLabel = proEndsAt ? DATE.format(proEndsAt) : null;

  return (
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
          ? ["Utilisables quand ton quota mensuel est atteint", "Sans date d'expiration", "Conservées si tu résilies ton abonnement"]
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
                      ? `Ta formule en cours. Elle prend fin le ${proEndsAtLabel}.`
                      : "Ta formule en cours. Elle prend fin à la fin de la période."
                    : proEndsAtLabel
                      ? `Ta formule en cours, jusqu'au ${proEndsAtLabel}.`
                      : "Ta formule en cours."}
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
            ) : signedIn ? (
              <PlanCheckoutForm plan={plan.id} label={asRecharge ? "Recharger" : `Prendre ${plan.name}`} primary={featured} />
            ) : featured ? (
              <Button asChild size="lg" className="h-12 w-full text-base">
                <Link href={LOGIN_HREF}>Se connecter pour payer</Link>
              </Button>
            ) : (
              <Link href={LOGIN_HREF} className="link flex min-h-11 w-fit items-center font-semibold">
                Se connecter pour payer
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}
