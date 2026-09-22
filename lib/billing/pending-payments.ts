import { insertIfAbsent, isMissingRelation, selectRows, updateRows } from "@/lib/supabase/server";
import type { PlanKey } from "@/lib/whop/api";

// Mission #092 — les paiements encaissés dont la contrepartie n'est pas encore
// accordée (table pending_payments, migration 20260922000027).
//
// Deux motifs :
//   - « activation_attendue » : paiement Pro reçu, abonnement pas encore
//     activé par Whop. Au-delà de PRO_ACTIVATION_GRACE_MS sans période active,
//     le rattrapage ouvre le mois payé ;
//   - « compte_introuvable » : aucun compte derrière ce paiement. Le rattrapage
//     réessaie pendant ATTACHMENT_MAX_DAYS jours, puis abandonne, en le disant.

export type PendingReason = "activation_attendue" | "compte_introuvable";
export type PendingResolution = "rattrape" | "active" | "rattache" | "abandonne";

export type PendingPayment = {
  event_id: string;
  user_id: string | null;
  email: string | null;
  plan: PlanKey;
  amount: number | null;
  currency: string | null;
  paid_at: string;
  reason: PendingReason;
  resolved_at: string | null;
  resolution: PendingResolution | null;
  activation_event_id: string | null;
};

// Délai laissé à Whop pour activer l'abonnement avant que le rattrapage ouvre
// la période lui-même.
export const PRO_ACTIVATION_GRACE_MS = 15 * 60 * 1000;

// Au-delà, un paiement sans compte correspondant est abandonné (et dit).
export const ATTACHMENT_MAX_DAYS = 30;

// Une activation qui arrive après un rattrapage est reconnue comme étant celle
// de ce paiement-là si elle suit le paiement de moins de ce délai.
export const ACTIVATION_MATCH_MS = 7 * 24 * 60 * 60 * 1000;

const COLUMNS = "event_id,user_id,email,plan,amount,currency,paid_at,reason,resolved_at,resolution,activation_event_id";

// Table absente (migration 027 pas encore appliquée) : on le dit une fois et on
// laisse le chemin normal se poursuivre, plutôt que de faire échouer un webhook
// qui a peut-être déjà crédité.
function absent(caught: unknown, operation: string): boolean {
  if (!isMissingRelation(caught)) return false;
  console.warn(JSON.stringify({ event: "pending_payments_table_absente", operation }));
  return true;
}

// Une ligne par event_id : un rejeu du webhook n'en crée pas deux.
export async function recordPending(
  payment: Omit<PendingPayment, "resolved_at" | "resolution" | "activation_event_id"> & {
    // Paiement qui n'attend rien (abonnement déjà actif) : la ligne naît réglée,
    // pour la trace, et le rattrapage n'a pas à la reprendre.
    resolution?: PendingResolution;
    resolved_at?: string;
  },
): Promise<void> {
  try {
    await insertIfAbsent("pending_payments", payment);
  } catch (caught) {
    if (!absent(caught, "insertion")) throw caught;
  }
}

export async function openPending(reason: PendingReason, before: Date, limit = 50): Promise<PendingPayment[]> {
  try {
    return await selectRows<PendingPayment>(
      "pending_payments",
      `select=${COLUMNS}&reason=eq.${reason}&resolved_at=is.null&paid_at=lte.${encodeURIComponent(before.toISOString())}&order=paid_at.asc&limit=${limit}`,
    );
  } catch (caught) {
    if (!absent(caught, "lecture")) throw caught;
    return [];
  }
}

// RÈGLE COMMUNE (mission #092) : la contrepartie d'un paiement n'est accordée
// qu'une fois, et c'est la BASE qui le garantit. Le filtre « resolved_at is
// null » fait partie de la mise à jour : deux passes concurrentes ne peuvent
// pas la réussir toutes les deux, et seule celle qui a obtenu la ligne accorde.
// Renvoie false quand quelqu'un d'autre l'a déjà réglé.
export async function claimPending(eventId: string, resolution: PendingResolution): Promise<boolean> {
  try {
    const rows = await updateRows<{ event_id: string }>(
      "pending_payments",
      `event_id=eq.${encodeURIComponent(eventId)}&resolved_at=is.null`,
      { resolved_at: new Date().toISOString(), resolution, updated_at: new Date().toISOString() },
    );
    return rows.length > 0;
  } catch (caught) {
    if (!absent(caught, "règlement")) throw caught;
    return false;
  }
}

// Paiement Pro déjà honoré par le rattrapage, dont l'activation n'est pas encore
// arrivée : c'est lui que l'activation tardive vient confirmer.
export async function honoredProAwaitingActivation(userId: string, now: Date): Promise<PendingPayment | null> {
  const since = new Date(now.getTime() - ACTIVATION_MATCH_MS).toISOString();
  try {
    const rows = await selectRows<PendingPayment>(
      "pending_payments",
      `select=${COLUMNS}&user_id=eq.${userId}&plan=eq.pro&resolution=eq.rattrape&activation_event_id=is.null&paid_at=gte.${encodeURIComponent(since)}&order=paid_at.desc&limit=1`,
    );
    return rows[0] ?? null;
  } catch (caught) {
    if (!absent(caught, "lecture activation")) throw caught;
    return null;
  }
}

// L'activation reconnue comme étant celle de ce paiement déjà honoré. Le filtre
// « activation_event_id is null » est là aussi : une seule activation peut
// consommer un paiement rattrapé.
export async function attachActivation(eventId: string, activationEventId: string): Promise<boolean> {
  try {
    const rows = await updateRows<{ event_id: string }>(
      "pending_payments",
      `event_id=eq.${encodeURIComponent(eventId)}&activation_event_id=is.null`,
      { activation_event_id: activationEventId, updated_at: new Date().toISOString() },
    );
    return rows.length > 0;
  } catch (caught) {
    if (!absent(caught, "activation")) throw caught;
    return false;
  }
}

// Paiements Pro de ce compte encore en attente d'activation : l'activation
// normale les referme, pour que le rattrapage n'ouvre pas un mois de plus.
export async function closeAwaitingActivation(userId: string): Promise<void> {
  try {
    await updateRows("pending_payments", `user_id=eq.${userId}&reason=eq.activation_attendue&resolved_at=is.null`, {
      resolved_at: new Date().toISOString(),
      resolution: "active",
      updated_at: new Date().toISOString(),
    });
  } catch (caught) {
    if (!absent(caught, "clôture")) throw caught;
  }
}
