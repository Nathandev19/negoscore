import { PACK_ANALYSES } from "@/lib/billing/plans";
import { planKeyFromId, type PlanKey } from "@/lib/whop/api";
import { adjustInteger, insertIfAbsent, selectRows, updateRows } from "@/lib/supabase/server";

// Effets d'un événement Whop sur les crédits. Tout passe par la clé
// service_role : un utilisateur ne modifie jamais son solde.

export type WhopEvent = { id: string; type: string; data: Record<string, unknown> };
export type EventOutcome = {
  handled: boolean;
  reason: string;
  userId?: string;
  userEmail?: string | null;
  plan?: PlanKey;
  amount?: number | null;
  currency?: string | null;
};

type Credits = { user_id: string; plan: "free" | "pack" | "pro"; balance: number; period_end: string | null };
type Profile = { id: string; email: string | null };

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

// Rattachement : l'identifiant du compte posé en metadata au checkout, sinon
// l'email de l'acheteur renvoyé par Whop.
async function resolveUser(
  data: Record<string, unknown>,
): Promise<{ id: string; email: string | null; how: "metadata" | "email" } | null> {
  const metadata = record(data.metadata);
  const fromMetadata = text(metadata.user_id);
  if (fromMetadata) {
    const rows = await selectRows<Profile>("profiles", `select=id,email&id=eq.${encodeURIComponent(fromMetadata)}&limit=1`);
    if (rows.length > 0) return { id: rows[0].id, email: rows[0].email, how: "metadata" };
  }
  const email = text(record(data.user).email);
  if (email) {
    const rows = await selectRows<Profile>("profiles", `select=id,email&email=ilike.${encodeURIComponent(email)}&limit=1`);
    if (rows.length > 0) return { id: rows[0].id, email: rows[0].email, how: "email" };
  }
  return null;
}

async function credits(userId: string): Promise<Credits> {
  await insertIfAbsent("credits", { user_id: userId, balance: 0, plan: "free" });
  const [row] = await selectRows<Credits>("credits", `select=user_id,plan,balance,period_end&user_id=eq.${userId}&limit=1`);
  return row;
}

async function addBalance(userId: string, delta: number): Promise<number | null> {
  return adjustInteger("credits", `user_id=eq.${userId}`, "balance", delta, (balance) => balance + delta >= 0);
}

function planOf(data: Record<string, unknown>): PlanKey | null {
  return planKeyFromId(text(record(data.plan).id));
}

export async function applyWhopEvent(event: WhopEvent): Promise<EventOutcome> {
  const { type, data } = event;

  if (type === "payment.failed") {
    return { handled: true, reason: "paiement échoué : aucun crédit" };
  }

  const isRefund = type === "refund.created";
  // Pour un remboursement, le paiement remboursé porte le plan et le rattachement.
  const source = isRefund ? record(data.payment) : data;
  const plan = planOf(source);
  if (!plan) return { handled: false, reason: "plan hors offres Negoscore" };

  const user = await resolveUser(source);
  if (!user) return { handled: false, reason: "aucun compte rattaché à ce paiement" };
  const current = await credits(user.id);

  if (type === "payment.succeeded" && plan === "pack") {
    // Le pack s'ajoute au solde existant.
    await addBalance(user.id, PACK_ANALYSES);
    if (current.plan === "free") await updateRows("credits", `user_id=eq.${user.id}&plan=eq.free`, { plan: "pack" });
    const total = typeof source.total === "number" ? source.total : null;
    return {
      handled: true,
      reason: `+${PACK_ANALYSES} analyses (rattachement par ${user.how})`,
      userId: user.id,
      userEmail: user.email,
      plan,
      amount: total,
      currency: text(source.currency),
    };
  }

  if (type === "payment.succeeded" && plan === "pro") {
    // L'abonnement est activé par membership.activated : ici on note seulement le revenu.
    const total = typeof source.total === "number" ? source.total : null;
    return {
      handled: true,
      reason: `paiement Pro enregistré (rattachement par ${user.how})`,
      userId: user.id,
      userEmail: user.email,
      plan,
      amount: total,
      currency: text(source.currency),
    };
  }

  if (type === "membership.activated" && plan === "pro") {
    const periodEnd = text(data.renewal_period_end) ?? new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
    await updateRows("credits", `user_id=eq.${user.id}`, { plan: "pro", period_end: periodEnd, updated_at: new Date().toISOString() });
    return { handled: true, reason: `Pro actif jusqu'au ${periodEnd}`, userId: user.id, plan };
  }

  if (type === "membership.deactivated" && plan === "pro") {
    // Les crédits de pack restants ne sont jamais perdus.
    const nextPlan = current.balance > 0 ? "pack" : "free";
    await updateRows("credits", `user_id=eq.${user.id}`, {
      plan: nextPlan,
      period_end: null,
      updated_at: new Date().toISOString(),
    });
    return { handled: true, reason: `Pro désactivé, retour au plan ${nextPlan}`, userId: user.id, plan };
  }

  if (isRefund) {
    if (plan === "pack") {
      const removed = Math.min(PACK_ANALYSES, current.balance);
      if (removed > 0) await addBalance(user.id, -removed);
      const balance = current.balance - removed;
      if (current.plan === "pack" && balance === 0) {
        await updateRows("credits", `user_id=eq.${user.id}&plan=eq.pack`, { plan: "free" });
      }
      return { handled: true, reason: `remboursement : -${removed} analyses`, userId: user.id, plan };
    }
    const nextPlan = current.balance > 0 ? "pack" : "free";
    await updateRows("credits", `user_id=eq.${user.id}`, { plan: nextPlan, period_end: null, updated_at: new Date().toISOString() });
    return { handled: true, reason: `remboursement Pro : retour au plan ${nextPlan}`, userId: user.id, plan };
  }

  return { handled: false, reason: `événement ignoré (${type})` };
}
