// Ce qu'un compte a réellement, vu de l'utilisateur. `period_end` fait foi :
// un abonnement dont la période est terminée n'est plus un abonnement, même
// si la ligne porte encore le plan "pro". Aucune dépendance à l'état Whop.

export type PlanState = {
  plan: "free" | "pack" | "pro";
  balance: number;
  period_end: string | null;
  cancelled_at?: string | null;
};

export function periodEndsAt(credits: Pick<PlanState, "period_end"> | null): Date | null {
  if (!credits?.period_end) return null;
  const date = new Date(credits.period_end);
  return Number.isNaN(date.getTime()) ? null : date;
}

// Abonnement Pro encore en cours : plan "pro" et période non échue.
export function isProActive(credits: PlanState | null, now: Date = new Date()): boolean {
  if (credits?.plan !== "pro") return false;
  const endsAt = periodEndsAt(credits);
  return endsAt !== null && endsAt.getTime() > now.getTime();
}

// Plan à afficher : un Pro expiré retombe sur ses crédits restants, et un
// compte qui a des crédits n'est jamais présenté comme gratuit.
export function displayedPlan(credits: PlanState | null, now: Date = new Date()): "free" | "pack" | "pro" {
  if (!credits) return "free";
  if (isProActive(credits, now)) return "pro";
  return credits.balance > 0 ? "pack" : "free";
}

// Résiliation déjà enregistrée : l'accès court jusqu'à la fin de la période.
export function isCancelled(credits: PlanState | null): boolean {
  return Boolean(credits?.cancelled_at);
}
