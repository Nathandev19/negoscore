import { displayedPlan, isCancelled, periodEndsAt, type PlanState } from "@/lib/billing/plan-access";

// État du compte tel que l'utilisateur doit le lire. Le plan affiché est le
// plan effectif : un Pro dont la période est passée n'est plus présenté Pro.

export const PLAN_LABEL = { free: "Gratuit", pack: "Pack Deal", pro: "Pro" } as const;

export type AccountSummary = {
  plan: keyof typeof PLAN_LABEL;
  planLabel: string;
  balance: number;
  // Fin de la période en cours, seulement pour un abonnement actif.
  periodEnd: Date | null;
  // Résiliation enregistrée sur un abonnement encore actif : fin de l'accès.
  accessEndsAt: Date | null;
  // Lien vers /resilier : abonnement actif et pas encore résilié.
  canCancel: boolean;
};

export function accountSummary(credits: PlanState | null, now: Date = new Date()): AccountSummary {
  const plan = displayedPlan(credits, now);
  const active = plan === "pro";
  const cancelled = active && isCancelled(credits);
  return {
    plan,
    planLabel: PLAN_LABEL[plan],
    balance: credits?.balance ?? 0,
    periodEnd: active ? periodEndsAt(credits) : null,
    accessEndsAt: cancelled ? periodEndsAt(credits) : null,
    canCancel: active && !cancelled,
  };
}
