"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { displayedPlan, periodEndsAt, type PlanState } from "@/lib/billing/plan-access";
import { clearCreditWait, creditWaitingSince, CREDIT_STUCK_MS } from "@/lib/billing/credit-wait";
import type { Purchase } from "@/lib/billing/purchases";
import { PLAN_LABEL } from "@/lib/billing/plans";
import { SELLER } from "@/lib/legal/identity";

// Le paiement est confirmé par le webhook, pas par ce retour de navigateur :
// on relit toutes les 2 secondes pendant 30 secondes au maximum.
const INTERVAL_MS = 2000;
const TIMEOUT_MS = 30_000;

// Mission #090 — ce que la page confirme, c'est L'ACHAT (le produit payé et ce
// qu'il donne), pas l'état du compte. Avant, une abonnée Pro qui achetait un
// Pack Deal lisait « ton compte est crédité. Abonnement Pro actif jusqu'au… » :
// pas un mot de ses 3 analyses, de quoi croire son paiement perdu et payer
// deux fois. L'achat vient du webhook (table purchases), jamais d'une déduction
// à partir du solde.
export type Account = PlanState;
export type Bought = { purchase: Purchase | null; duplicates: number; analysesAdded: number } | "unknown";

type State = { account: Account | null; bought: Bought; late: boolean };

// Ce que l'achat a donné, en une phrase.
export function purchaseText(purchase: Purchase, account: Account | null): string {
  if (purchase.plan === "pro") {
    const until = purchase.period_end ? new Date(purchase.period_end).toLocaleDateString("fr-FR") : null;
    return until ? `Ton abonnement Pro est actif jusqu'au ${until}.` : "Ton abonnement Pro est actif.";
  }
  const added = `${purchase.analyses_added} analyse${purchase.analyses_added > 1 ? "s" : ""} ajoutée${purchase.analyses_added > 1 ? "s" : ""}`;
  const balance = account ? `, il t'en reste ${account.balance}` : "";
  return `${added}${balance}.`;
}

// L'état du compte, dit à part : ce n'est pas la confirmation de l'achat.
export function accountText(account: Account): string {
  const parts: string[] = [];
  if (displayedPlan(account) === "pro") {
    const until = periodEndsAt(account)?.toLocaleDateString("fr-FR") ?? null;
    parts.push(until ? `abonnement Pro actif jusqu'au ${until}` : "abonnement Pro actif");
  }
  parts.push(`${account.balance} analyse${account.balance > 1 ? "s" : ""} disponible${account.balance > 1 ? "s" : ""}`);
  return `Ton compte : ${parts.join(" · ")}.`;
}

// Ce que la page montre, en une valeur : « confirmed » seulement quand le
// webhook a enregistré l'achat (mission #090, A3 : jamais avant).
export type Shown = "confirmed" | "unknown" | "waiting" | "late";

export function whatToShow(bought: Bought, late: boolean): Shown {
  if (bought !== "unknown" && bought.purchase !== null) return "confirmed";
  if (bought === "unknown") return "unknown";
  return late ? "late" : "waiting";
}

// Achat lu dans la réponse de /api/credits. Champ absent : on ne sait pas.
export function boughtFromCredits(body: { purchase?: Purchase | null; duplicates?: number; analyses_added?: number }): Bought {
  if (body.purchase === undefined) return "unknown";
  return { purchase: body.purchase, duplicates: body.duplicates ?? 0, analysesAdded: body.analyses_added ?? 0 };
}

export function CreditsWaiter({ initial, bought }: { initial: Account | null; bought: Bought }) {
  const [state, setState] = useState<State>({ account: initial, bought, late: false });
  const [stuck, setStuck] = useState(false);
  const shown = whatToShow(state.bought, state.late);

  useEffect(() => {
    let stopped = false;
    const startedAt = Date.now();
    const known = bought !== "unknown" && bought.purchase !== null;
    const since = known ? Date.now() : creditWaitingSince();

    async function poll() {
      if (stopped) return;
      if (Date.now() - since >= CREDIT_STUCK_MS) setStuck(true);
      try {
        const response = await fetch("/api/credits", { cache: "no-store" });
        if (response.ok) {
          const body = (await response.json()) as PlanState & { purchase?: Purchase | null; duplicates?: number; analyses_added?: number };
          const next = boughtFromCredits(body);
          if (next !== "unknown" && next.purchase) clearCreditWait();
          setState((current) => ({ ...current, account: body, bought: next }));
          if (next !== "unknown" && next.purchase) return;
        }
      } catch {
        // on réessaiera au tour suivant
      }
      if (Date.now() - startedAt >= TIMEOUT_MS) {
        setState((current) => ({ ...current, late: true }));
        if (Date.now() - since >= CREDIT_STUCK_MS) setStuck(true);
        return;
      }
      window.setTimeout(poll, INTERVAL_MS);
    }

    void poll();
    return () => {
      stopped = true;
    };
  }, [bought]);

  // A1 — l'achat d'abord, l'état du compte ensuite et à part.
  if (shown === "confirmed" && state.bought !== "unknown" && state.bought.purchase) {
    const { purchase, duplicates, analysesAdded } = state.bought;
    return (
      <div className="flex flex-col gap-4">
        <p className="text-lg font-semibold text-encre" role="status">
          C&apos;est bon, ton achat est enregistré : {PLAN_LABEL[purchase.plan]}. {purchaseText(purchase, state.account)}
        </p>
        {/* B3 — deux paiements du même produit à quelques minutes d'intervalle :
            dit, jamais corrigé d'office à sa place. */}
        {duplicates > 1 ? (
          <p className="alert-bad flex flex-col gap-1 py-2 text-small">
            <span className="font-semibold">
              {duplicates} paiements de {PLAN_LABEL[purchase.plan]} sont arrivés à quelques minutes d&apos;intervalle.
            </span>
            <span>
              {purchase.plan === "pack"
                ? `Chacun a été honoré : ${analysesAdded} analyses ont été ajoutées en tout.`
                : "Chacun a été honoré."}{" "}
              Si tu n&apos;as pas voulu payer deux fois, écris-nous à{" "}
              <a href={`mailto:${SELLER.email}`} className="link">
                {SELLER.email}
              </a>{" "}
              : on te rembourse le paiement en trop.
            </span>
          </p>
        ) : null}
        {state.account ? <p className="text-small text-attenue">{accountText(state.account)}</p> : null}
        <Button asChild size="lg" className="h-12 text-base">
          <Link href="/analyse">Analyser un deal</Link>
        </Button>
      </div>
    );
  }

  // A2 — l'achat n'est pas lisible : on n'affirme rien sur ce qui a été acheté.
  if (shown === "unknown") {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-lg font-semibold text-encre" role="status">
          Ton paiement est bien reçu. Le détail de cet achat n&apos;est pas lisible pour le moment.
        </p>
        {state.account ? <p className="text-small text-attenue">{accountText(state.account)}</p> : null}
        <p className="text-small">
          Si quelque chose manque, écris-nous à{" "}
          <a href={`mailto:${SELLER.email}`} className="link">
            {SELLER.email}
          </a>
          .
        </p>
        <Button asChild size="lg" className="h-12 text-base">
          <Link href="/analyse">Analyser un deal</Link>
        </Button>
      </div>
    );
  }

  // A3 — le webhook peut arriver après ce retour de navigateur : tant qu'il
  // n'est pas là, la page dit que l'enregistrement est en cours. Elle n'a
  // jamais dit « ton compte est crédité » avant que ce soit vrai.
  if (shown === "late") {
    return stuck ? (
      <div className="flex flex-col gap-4">
        <p className="text-lg font-semibold text-encre" role="status">
          Ton achat n&apos;est toujours pas enregistré, et ça ne devrait pas durer aussi longtemps. Ton paiement, lui, est
          bien passé : rien n&apos;est perdu.
        </p>
        <p>
          Écris-nous à{" "}
          <a href={`mailto:${SELLER.email}`} className="link">
            {SELLER.email}
          </a>{" "}
          en disant quand tu as payé. On ajoute ton achat à la main, et on te répond.
        </p>
        {state.account ? <p className="text-small text-attenue">{accountText(state.account)}</p> : null}
        <Button asChild size="lg" className="h-12 text-base">
          <Link href="/merci">Rafraîchir</Link>
        </Button>
      </div>
    ) : (
      <div className="flex flex-col gap-4">
        <p className="text-lg font-semibold text-encre" role="status">
          Ton paiement est bien reçu. Son enregistrement prend un peu plus de temps que d&apos;habitude : rafraîchis cette
          page dans une minute.
        </p>
        {state.account ? <p className="text-small text-attenue">{accountText(state.account)}</p> : null}
        <Button asChild size="lg" className="h-12 text-base">
          <Link href="/merci">Rafraîchir</Link>
        </Button>
      </div>
    );
  }

  return (
    <p className="text-lg font-semibold text-encre" role="status" aria-live="polite">
      On enregistre ton paiement… Reste sur cette page quelques secondes.
    </p>
  );
}
