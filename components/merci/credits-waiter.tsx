"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

// Le paiement est confirmé par le webhook, pas par ce retour de navigateur :
// on relit le solde toutes les 2 secondes pendant 30 secondes au maximum.
const INTERVAL_MS = 2000;
const TIMEOUT_MS = 30_000;

type Credits = { plan: "free" | "pack" | "pro"; balance: number; period_end: string | null };
type State = { status: "waiting" | "credited" | "timeout"; credits: Credits | null };

function describe(credits: Credits): string {
  if (credits.plan === "pro") {
    const until = credits.period_end ? new Date(credits.period_end).toLocaleDateString("fr-FR") : null;
    return until ? `Abonnement Pro actif jusqu'au ${until}.` : "Abonnement Pro actif.";
  }
  const count = credits.balance;
  return `${count} analyse${count > 1 ? "s" : ""} disponible${count > 1 ? "s" : ""}.`;
}

export function CreditsWaiter({ initial }: { initial: Credits | null }) {
  const [state, setState] = useState<State>({ status: "waiting", credits: initial });

  useEffect(() => {
    let stopped = false;
    const startedAt = Date.now();
    const before = initial;

    async function poll() {
      if (stopped) return;
      try {
        const response = await fetch("/api/credits", { cache: "no-store" });
        if (response.ok) {
          const credits = (await response.json()) as Credits;
          const credited =
            credits.plan === "pro" || credits.balance > (before?.balance ?? 0) || (before === null && credits.balance > 0);
          if (credited) {
            setState({ status: "credited", credits });
            return;
          }
          setState((current) => ({ ...current, credits }));
        }
      } catch {
        // on réessaiera au tour suivant
      }
      if (Date.now() - startedAt >= TIMEOUT_MS) {
        setState((current) => ({ status: "timeout", credits: current.credits }));
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
        <p className="text-lg font-medium" role="status">
          C&apos;est bon, ton compte est crédité. {describe(state.credits)}
        </p>
        <Button asChild size="lg" className="h-12 text-base">
          <Link href="/analyse">Analyser un deal</Link>
        </Button>
      </div>
    );
  }

  if (state.status === "timeout") {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-lg font-medium" role="status">
          Ton paiement est bien reçu. Les crédits arrivent, rafraîchis cette page dans une minute.
        </p>
        <Button asChild variant="outline" size="lg" className="h-12 text-base">
          <Link href="/merci">Rafraîchir</Link>
        </Button>
      </div>
    );
  }

  return (
    <p className="text-lg font-medium" role="status" aria-live="polite">
      On confirme ton paiement… Reste sur cette page quelques secondes.
    </p>
  );
}
