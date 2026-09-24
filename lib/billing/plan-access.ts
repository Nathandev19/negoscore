// Ce qu'un compte a réellement, vu de l'utilisateur. `period_end` fait foi :
// un abonnement dont la période est terminée n'est plus un abonnement, même
// si la ligne porte encore le plan "pro". Aucune dépendance à l'état Whop.

export type PlanState = {
  plan: "free" | "pack" | "pro";
  balance: number;
  period_end: string | null;
  cancelled_at?: string | null;
  // Mission #111 — d'où vient l'accès, tel que /api/credits le calcule
  // (lib/billing/access.ts). Absent des lectures purement serveur, qui
  // interrogent la table directement.
  access_source?: "free" | "pack" | "subscription" | "admin_grant";
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

// Mission #111 — CE QUE LE COMPTE POSSÈDE DÉJÀ, pour ne pas le lui revendre.
//
// Deux questions, posées au même endroit pour que la page Tarifs et tout autre
// écran y répondent pareil.

// Un accès Pro en cours : abonnement payé et encore actif, OU accès offert par
// l'administrateur. Les deux donnent exactement le même droit d'analyser
// (lib/billing/entitlement.ts), et aucun des deux ne se rachète. L'accès
// offert n'a pas de period_end : le lire avec isProActive seul le rendait
// invisible, et la page proposait « Prendre Pro » à quelqu'un qui l'avait déjà.
export function hasProAccess(account: PlanState | null, now: Date = new Date()): boolean {
  if (!account) return false;
  return isProActive(account, now) || account.access_source === "admin_grant";
}

// Des négociations déjà payées, en réserve sur le compte. Le solde fait foi :
// c'est lui qui est décompté à chaque analyse.
export function hasReserve(account: PlanState | null): boolean {
  return (account?.balance ?? 0) > 0;
}

// Accès Pro OFFERT, par opposition à un abonnement payé : il n'y a rien à
// résilier chez le prestataire de paiement, et rien à racheter non plus.
export function isGrantedPro(account: PlanState | null, now: Date = new Date()): boolean {
  return !isProActive(account, now) && account?.access_source === "admin_grant";
}

// Mission #111 — CE QUE LA PAGE TARIFS PROPOSE, pour une formule donnée.
//
// Décision pure, sortie du composant pour qu'elle se teste seule et qu'aucun
// état ne puisse en produire un autre par accident. Les quatre états de compte
// de la mission #071 sont repris tels quels : tant que le compte n'est pas lu,
// AUCUNE action n'est proposée — jamais de bascule visible d'un libellé à
// l'autre devant quelqu'un qui regarde.
export type AccountView = "inconnu" | "visiteur" | "illisible" | PlanState;

export type OfferAction =
  // Compte pas encore lu : une attente inerte, rien de cliquable.
  | "attente"
  // Pas de session : « Se connecter pour payer ».
  | "connexion"
  // Compte illisible (réseau) : on le dit, sans bouton.
  | "illisible"
  // Formule qu'on ne possède pas : « Prendre … ».
  | "acheter"
  // Négociations déjà en réserve, ou abonnement en cours : « Recharger ».
  | "recharger"
  // Formule Pro en cours, payée ou offerte : elle ne se rachète pas.
  | "formule_en_cours";

export function offerAction(planId: "free" | "pack" | "pro", account: AccountView, now: Date = new Date()): OfferAction | null {
  // La formule gratuite ne s'achète pas : son emplacement porte un lien.
  if (planId === "free") return null;
  const known = typeof account === "object" ? account : null;
  if (planId === "pro" && hasProAccess(known, now)) return "formule_en_cours";
  if (account === "inconnu") return "attente";
  if (account === "illisible") return "illisible";
  if (!known) return "connexion";
  return planId === "pack" && (hasProAccess(known, now) || hasReserve(known)) ? "recharger" : "acheter";
}

// Résiliation déjà enregistrée : l'accès court jusqu'à la fin de la période.
export function isCancelled(credits: PlanState | null): boolean {
  return Boolean(credits?.cancelled_at);
}
