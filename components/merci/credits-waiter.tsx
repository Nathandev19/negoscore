"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { displayedPlan, periodEndsAt, type PlanState } from "@/lib/billing/plan-access";
import { clearCreditWait, creditWaitingSince, CREDIT_STUCK_MS } from "@/lib/billing/credit-wait";
import { SELLER } from "@/lib/legal/identity";

// Le paiement est confirmé par le webhook, pas par ce retour de navigateur :
// on relit le solde toutes les 2 secondes pendant 30 secondes au maximum.
const INTERVAL_MS = 2000;
const TIMEOUT_MS = 30_000;

type Credits = PlanState;
type State = { status: "waiting" | "credited" | "timeout"; credits: Credits | null };

function describe(credits: Credits): string {
  // Un abonnement dont la période est passée n'est plus annoncé comme actif.
  if (displayedPlan(credits) === "pro") {
    const until = periodEndsAt(credits)?.toLocaleDateString("fr-FR") ?? null;
    return until ? `Abonnement Pro actif jusqu'au ${until}.` : "Abonnement Pro actif.";
  }
  const count = credits.balance;
  return `${count} analyse${count > 1 ? "s" : ""} disponible${count > 1 ? "s" : ""}.`;
}

// Un compte déjà crédité l'est parfois avant même l'ouverture de la page :
// le webhook est plus rapide que le retour du navigateur. Dans ce cas il n'y
// a aucune augmentation à observer, seulement un solde à afficher.
export function isCredited(credits: Credits | null): boolean {
  return credits !== null && displayedPlan(credits) !== "free";
}

export function CreditsWaiter({ initial }: { initial: Credits | null }) {
  const [state, setState] = useState<State>({
    status: isCredited(initial) ? "credited" : "waiting",
    credits: initial,
  });
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    let stopped = false;
    const startedAt = Date.now();
    const since = isCredited(initial) ? Date.now() : creditWaitingSince();

    async function poll() {
      if (stopped) return;
      // Attente déjà longue à l'arrivée sur la page (l'utilisateur revient ou
      // rafraîchit) : le message le dira dès la fin du sondage.
      if (Date.now() - since >= CREDIT_STUCK_MS) setStuck(true);
      try {
        const response = await fetch("/api/credits", { cache: "no-store" });
        if (response.ok) {
          const credits = (await response.json()) as Credits;
          // Crédité : l'attente mémorisée n'a plus lieu d'être.
          if (isCredited(credits)) clearCreditWait();
          // On continue de relire jusqu'à 30 s pour afficher un solde qui
          // monte encore, sans jamais repasser en attente.
          setState((current) => ({
            status: isCredited(credits) ? "credited" : current.status === "credited" ? "credited" : "waiting",
            credits,
          }));
        }
      } catch {
        // on réessaiera au tour suivant
      }
      if (Date.now() - startedAt >= TIMEOUT_MS) {
        // Le message de temporisation ne s'affiche jamais sur un solde visible.
        setState((current) => ({
          status: current.status === "credited" || isCredited(current.credits) ? "credited" : "timeout",
          credits: current.credits,
        }));
        if (Date.now() - since >= CREDIT_STUCK_MS) setStuck(true);
        return;
      }
      window.setTimeout(poll, INTERVAL_MS);
    }

    void poll();
    return () => {
      stopped = true;
    };
  }, [initial]);

  if (state.status === "credited" && state.credits) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-lg font-semibold text-encre" role="status">
          C&apos;est bon, ton compte est crédité. {describe(state.credits)}
        </p>
        <Button asChild size="lg" className="h-12 text-base">
          <Link href="/analyse">Analyser un deal</Link>
        </Button>
      </div>
    );
  }

  if (state.status === "timeout") {
    // Passé quelques minutes, « les crédits arrivent » cesse d'être vrai : le
    // traitement du paiement a échoué quelque part (mission #060). On le dit,
    // et on donne la seule action utile. Le rattrapage quotidien repassera de
    // toute façon, mais personne n'attend une nuit sans savoir pourquoi.
    return stuck ? (
      <div className="flex flex-col gap-4">
        <p className="text-lg font-semibold text-encre" role="status">
          Tes crédits ne sont toujours pas arrivés, et ça ne devrait pas durer aussi longtemps. Ton paiement, lui, est
          bien passé : rien n&apos;est perdu.
        </p>
        <p>
          Écris-nous à{" "}
          <a href={`mailto:${SELLER.email}`} className="link">
            {SELLER.email}
          </a>{" "}
          en disant quand tu as payé. On ajoute tes analyses à la main, et on te répond.
        </p>
        <Button asChild size="lg" className="h-12 text-base">
          <Link href="/merci">Rafraîchir</Link>
        </Button>
      </div>
    ) : (
      <div className="flex flex-col gap-4">
        <p className="text-lg font-semibold text-encre" role="status">
          Ton paiement est bien reçu. Les crédits arrivent, rafraîchis cette page dans une minute.
        </p>
        <Button asChild size="lg" className="h-12 text-base">
          <Link href="/merci">Rafraîchir</Link>
        </Button>
      </div>
    );
  }

  return (
    <p className="text-lg font-semibold text-encre" role="status" aria-live="polite">
      On confirme ton paiement… Reste sur cette page quelques secondes.
    </p>
  );
}
