import { sanitizeDistinctId } from "@/lib/analytics/distinct-id";
import { isProActive } from "@/lib/billing/plan-access";
import { PACK_ANALYSES } from "@/lib/billing/plans";
import { recordPurchase } from "@/lib/billing/purchases";
import { planKeyFromId, type PlanKey } from "@/lib/whop/api";
import { adjustInteger, insertIfAbsent, isMissingRelation, rpc, selectRows, updateRows } from "@/lib/supabase/server";
import { isUuid } from "@/lib/security/request";

// Effets d'un événement Whop sur les crédits. Tout passe par la clé
// service_role : un utilisateur ne modifie jamais son solde.

export type WhopEvent = { id: string; type: string; data: Record<string, unknown> };
export type EventOutcome = {
  handled: boolean;
  reason: string;
  userId?: string;
  userEmail?: string | null;
  analyticsId?: string | null;
  plan?: PlanKey;
  amount?: number | null;
  currency?: string | null;
};

type Credits = {
  user_id: string;
  plan: "free" | "pack" | "pro";
  balance: number;
  period_end: string | null;
  cancelled_at: string | null;
};
type Profile = { id: string; email: string | null };

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

// Gabarit volontairement strict : aucun caractère réservé par les filtres
// PostgREST (virgule, parenthèse, guillemet, espace).
const PLAIN_EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+.[A-Za-z]{2,}$/;

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
  // Les deux valeurs viennent de la charge du webhook. Elles ne sont posées
  // dans un filtre PostgREST qu'après contrôle de forme (mission #062, E2) :
  // une valeur hors gabarit ferait échouer la requête, et Postgres recopie
  // alors la valeur fautive dans le message d'erreur, qui est journalisé.
  if (fromMetadata && isUuid(fromMetadata)) {
    const rows = await selectRows<Profile>("profiles", `select=id,email&id=eq.${encodeURIComponent(fromMetadata)}&limit=1`);
    if (rows.length > 0) return { id: rows[0].id, email: rows[0].email, how: "metadata" };
  }
  const email = text(record(data.user).email);
  if (email && PLAIN_EMAIL.test(email)) {
    const rows = await selectRows<Profile>("profiles", `select=id,email&email=ilike.${encodeURIComponent(email)}&limit=1`);
    if (rows.length > 0) return { id: rows[0].id, email: rows[0].email, how: "email" };
  }
  return null;
}

async function credits(userId: string): Promise<Credits> {
  await insertIfAbsent("credits", { user_id: userId, balance: 0, plan: "free" });
  const [row] = await selectRows<Credits>(
    "credits",
    `select=user_id,plan,balance,period_end,cancelled_at&user_id=eq.${userId}&limit=1`,
  );
  return row;
}

async function addBalance(userId: string, delta: number): Promise<number | null> {
  return adjustInteger("credits", `user_id=eq.${userId}`, "balance", delta, (balance) => balance + delta >= 0);
}

// Crédit d'un achat : accordé une fois et une seule par événement (mission
// #060). La fonction SQL marque l'événement et ajoute le solde dans la même
// transaction — un rejeu ne peut donc pas créditer deux fois, et un crédit
// échoué n'est jamais marqué comme fait. Tant que la migration 019 n'est pas
// appliquée, on retombe sur l'ajout simple d'avant.
async function creditOnce(eventId: string, userId: string, amount: number): Promise<void> {
  try {
    const credited = await rpc<boolean>("whop_event_credit", {
      p_event_id: eventId,
      p_user_id: userId,
      p_amount: amount,
    });
    if (credited === false) {
      console.log(JSON.stringify({ event: "whop_credit_deja_accorde" }));
    }
    return;
  } catch (caught) {
    if (!isMissingRelation(caught)) throw caught;
    console.warn(JSON.stringify({ event: "whop_credit_fonction_absente" }));
  }
  await addBalance(userId, amount);
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
  if (!plan) return { handled: false, reason: "plan hors formules Negoscore" };

  const user = await resolveUser(source);
  if (!user) return { handled: false, reason: "aucun compte rattaché à ce paiement" };
  const current = await credits(user.id);
  // Identifiant anonyme posé au checkout : il relie l'achat au parcours mesuré.
  const analyticsId = sanitizeDistinctId(record(source.metadata).ph_distinct_id);

  if (type === "payment.succeeded" && plan === "pack") {
    // Le pack s'ajoute au solde existant, UNE SEULE FOIS par événement, même
    // si Whop rejoue ou si le rattrapage quotidien repasse (mission #060).
    await creditOnce(event.id, user.id, PACK_ANALYSES);
    // Un abonnement encore actif n'est jamais déclassé par l'achat d'un pack.
    // Un Pro expiré, lui, redevient un compte Pack avec une période remise à zéro.
    if (current.plan === "free") {
      await updateRows("credits", `user_id=eq.${user.id}&plan=eq.free`, { plan: "pack" });
    } else if (current.plan === "pro" && !isProActive(current)) {
      await updateRows("credits", `user_id=eq.${user.id}`, {
        plan: "pack",
        period_end: null,
        cancelled_at: null,
        updated_at: new Date().toISOString(),
      });
    }
    // Mission #090 : ce qui vient d'être acheté, pour la page « Merci ».
    await recordPurchase({
      event_id: event.id,
      user_id: user.id,
      plan: "pack",
      analyses_added: PACK_ANALYSES,
      period_end: null,
      paid_at: new Date().toISOString(),
    });
    const total = typeof source.total === "number" ? source.total : null;
    return {
      handled: true,
      reason: `+${PACK_ANALYSES} analyses (rattachement par ${user.how})`,
      userId: user.id,
      userEmail: user.email,
      analyticsId,
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
      analyticsId,
      plan,
      amount: total,
      currency: text(source.currency),
    };
  }

  if (type === "membership.activated" && plan === "pro") {
    const periodEnd = text(data.renewal_period_end) ?? new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
    await updateRows("credits", `user_id=eq.${user.id}`, {
      plan: "pro",
      period_end: periodEnd,
      // Un réabonnement efface une résiliation antérieure.
      cancelled_at: null,
      updated_at: new Date().toISOString(),
    });
    // Mission #090 : l'abonnement activé est l'achat à confirmer (le paiement
    // Pro, lui, ne donne l'accès qu'une fois la souscription activée).
    await recordPurchase({
      event_id: event.id,
      user_id: user.id,
      plan: "pro",
      analyses_added: 0,
      period_end: periodEnd,
      paid_at: new Date().toISOString(),
    });
    return { handled: true, reason: `Pro actif jusqu'au ${periodEnd}`, userId: user.id, plan };
  }

  if (type === "membership.deactivated" && plan === "pro") {
    // Whop coupe l'abonnement dès la demande de résiliation, même quand on
    // demande la fin de période. On ne déclasse donc pas sur son signal : la
    // période payée court jusqu'à renewal_period_end, et reserveAnalysis
    // refuse déjà les analyses Pro une fois cette date passée.
    const status = text(data.status);
    const renewalEnd = text(data.renewal_period_end);
    const stillPaidFor = renewalEnd !== null && new Date(renewalEnd).getTime() > Date.now();

    if (status === "canceled" && stillPaidFor) {
      await updateRows("credits", `user_id=eq.${user.id}`, {
        plan: "pro",
        period_end: renewalEnd,
        // La date de demande n'est jamais écrasée : c'est la première qui compte.
        ...(current.cancelled_at ? {} : { cancelled_at: new Date().toISOString() }),
        updated_at: new Date().toISOString(),
      });
      return {
        handled: true,
        reason: `résiliation enregistrée, accès Pro conservé jusqu'au ${renewalEnd}`,
        userId: user.id,
        plan,
      };
    }

    // Période terminée, ou fin d'abonnement pour une autre raison : les
    // crédits de pack restants ne sont jamais perdus.
    const nextPlan = current.balance > 0 ? "pack" : "free";
    await updateRows("credits", `user_id=eq.${user.id}`, {
      plan: nextPlan,
      period_end: null,
      updated_at: new Date().toISOString(),
    });
    return {
      handled: true,
      reason: `Pro désactivé (statut ${status ?? "inconnu"}), retour au plan ${nextPlan}`,
      userId: user.id,
      plan,
    };
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
    // L'argent est rendu : l'accès s'arrête tout de suite, ce n'est pas une
    // résiliation en fin de période.
    const nextPlan = current.balance > 0 ? "pack" : "free";
    await updateRows("credits", `user_id=eq.${user.id}`, {
      plan: nextPlan,
      period_end: null,
      cancelled_at: null,
      updated_at: new Date().toISOString(),
    });
    return { handled: true, reason: `remboursement Pro : retour au plan ${nextPlan}`, userId: user.id, plan };
  }

  return { handled: false, reason: `événement ignoré (${type})` };
}
