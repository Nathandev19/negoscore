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

// Mission #113, E — LA FIN D'ACCÈS LA PLUS LOINTAINE DES DEUX.
//
// Une résiliation ne raccourcit jamais une période déjà payée. Le cas se
// produit dès que la période en place a été EMPILÉE : un second abonnement
// distinct qui l'a prolongée (mission #090 bis), ou un paiement rattrapé faute
// d'activation, qui ajoute un mois (mission #092). Whop, lui, ne connaît que la
// fin de l'abonnement qu'on résilie — plus proche que ce qui est dû.
//
// Le webhook appliquait déjà cette règle ; la route de résiliation manuelle
// posait la date de Whop sans la comparer, et le compte perdait la différence.
// Un seul endroit décide désormais, pour les deux.
export function furthestPeriodEnd(a: string | null | undefined, b: string | null | undefined): string | null {
  const times = [a, b]
    .filter((value): value is string => typeof value === "string" && value !== "")
    .map((value) => ({ value, time: new Date(value).getTime() }))
    .filter((entry) => Number.isFinite(entry.time));
  if (times.length === 0) return null;
  return times.reduce((kept, entry) => (entry.time > kept.time ? entry : kept)).value;
}

// Résiliation déjà enregistrée : l'accès court jusqu'à la fin de la période.
export function isCancelled(credits: PlanState | null): boolean {
  return Boolean(credits?.cancelled_at);
}
