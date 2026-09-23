import { displayedPlan, isCancelled, periodEndsAt, type PlanState } from "@/lib/billing/plan-access";
import { accessSource, type AdminGrant, type AccessSource } from "@/lib/billing/access";

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
  accessSource: AccessSource;
};

export function accountSummary(credits: PlanState | null, now: Date = new Date(), grant: AdminGrant | null = null): AccountSummary {
  const source = accessSource(credits, grant, now);
  const plan = source === "subscription" || source === "admin_grant" ? "pro" : displayedPlan(credits, now);
  const paid = source === "subscription";
  const cancelled = paid && isCancelled(credits);
  return {
    plan,
    planLabel: source === "subscription" ? "Pro" : source === "admin_grant" ? "Pro — accès offert" : PLAN_LABEL[plan],
    balance: credits?.balance ?? 0,
    periodEnd: paid ? periodEndsAt(credits) : grant?.expires_at ? new Date(grant.expires_at) : null,
    accessEndsAt: cancelled ? periodEndsAt(credits) : null,
    canCancel: paid && !cancelled,
    accessSource: source,
  };
}
