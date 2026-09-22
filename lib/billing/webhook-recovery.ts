import {
  ATTACHMENT_MAX_DAYS,
  claimPending,
  openPending,
  PRO_ACTIVATION_GRACE_MS,
} from "@/lib/billing/pending-payments";
import { recordPurchase } from "@/lib/billing/purchases";
import { applyWhopEvent, proPeriodAfterRecovery, type WhopEvent } from "@/lib/billing/whop-events";
import { isMissingColumn, isMissingRelation, selectRows, updateRows } from "@/lib/supabase/server";

// Rattrapage des paiements (mission #060).
//
// Un événement Whop est enregistré dès son arrivée, puis traité. Si le
// traitement est coupé au milieu — redémarrage, délai de la fonction — la
// ligne reste sans processed_at. Whop rejoue pendant environ 71 heures, mais
// au-delà plus rien ne revient : le paiement était encaissé et le compte
// jamais crédité.
//
// Cette passe reprend ces lignes-là, à chaque purge quotidienne. Elle est sans
// risque si elle tourne deux fois : le crédit passe par whop_event_credit, qui
// marque l'événement et ajoute le solde dans la même transaction, et une ligne
// déjà traitée (processed_at) n'est même pas relue.

// Événements laissés de côté après ce nombre de passes : ils ne sont pas
// traitables (plan inconnu, compte introuvable) et encombreraient chaque nuit.
const MAX_AGE_DAYS = 30;
const BATCH = 50;

type PendingRow = { event_id: string; type: string; payload: unknown };

export type RecoveryReport = { repris: number; traites: number; echecs: number; en_attente: number };

export type PendingReport = { pro_ouverts: number; abandons: number };

function toEvent(row: PendingRow): WhopEvent | null {
  const payload = typeof row.payload === "object" && row.payload !== null ? (row.payload as Record<string, unknown>) : null;
  if (!payload) return null;
  const data = typeof payload.data === "object" && payload.data !== null ? (payload.data as Record<string, unknown>) : {};
  return { id: row.event_id, type: row.type, data };
}

export async function recoverPendingWhopEvents(now: Date = new Date()): Promise<RecoveryReport> {
  const since = new Date(now.getTime() - MAX_AGE_DAYS * 24 * 3600 * 1000).toISOString();
  let rows: PendingRow[];
  try {
    rows = await selectRows<PendingRow>(
      "whop_events",
      `select=event_id,type,payload&processed_at=is.null&received_at=gte.${encodeURIComponent(since)}&order=received_at.asc&limit=${BATCH}`,
    );
  } catch (caught) {
    // La colonne received_at vient de la migration 013 : sans elle, on reprend
    // sans filtre de date plutôt que de ne rien reprendre.
    if (!isMissingColumn(caught)) throw caught;
    rows = await selectRows<PendingRow>(
      "whop_events",
      `select=event_id,type,payload&processed_at=is.null&limit=${BATCH}`,
    );
  }

  const report: RecoveryReport = { repris: rows.length, traites: 0, echecs: 0, en_attente: 0 };
  for (const row of rows) {
    const event = toEvent(row);
    if (!event) {
      report.echecs += 1;
      continue;
    }
    try {
      const outcome = await applyWhopEvent(event);
      // Mission #092, B — paiement toujours pas rattachable : l'événement reste
      // à reprendre, la passe suivante réessaiera (30 jours au plus).
      if (outcome.pending) {
        report.en_attente += 1;
        console.warn(JSON.stringify({ event: "whop_rattrapage_en_attente", type: row.type, reason: outcome.reason }));
        continue;
      }
      await updateRows("whop_events", `event_id=eq.${encodeURIComponent(row.event_id)}`, {
        processed_at: new Date().toISOString(),
      });
      report.traites += 1;
      console.log(JSON.stringify({ event: "whop_rattrapage", type: row.type, handled: outcome.handled, reason: outcome.reason }));
    } catch (caught) {
      // Laissé sans processed_at : la passe suivante réessaiera.
      report.echecs += 1;
      console.error(
        JSON.stringify({
          event: "whop_rattrapage_error",
          type: row.type,
          detail: caught instanceof Error ? caught.message.slice(0, 200) : "inconnu",
        }),
      );
    }
  }
  return report;
}

// ─── Mission #092 — les paiements encaissés sans contrepartie ────────────────

type CreditsRow = { plan: string; balance: number; period_end: string | null };

async function periodOf(userId: string): Promise<string | null> {
  const [row] = await selectRows<CreditsRow>("credits", `select=plan,balance,period_end&user_id=eq.${userId}&limit=1`);
  return row?.period_end ?? null;
}

// A — un paiement Pro de plus de 15 minutes qu'aucune activation n'est venue
// régler : Whop n'a jamais activé l'abonnement, ou l'a activé sur un plan que
// nous ne reconnaissons pas. Le mois payé est ouvert ici.
//
// Une ligne encore ouverte veut dire qu'aucune activation n'a été reçue pour ce
// paiement : ni au moment du paiement (abonnement déjà actif : la ligne naît
// réglée), ni après (membership.activated referme les lignes ouvertes du
// compte). Le mois s'AJOUTE à ce qui reste dû, il ne l'écrase jamais.
//
// Le règlement de la ligne (claimPending) est fait AVANT d'ouvrir la période :
// c'est la base qui décide qui accorde, et une seule passe peut l'obtenir.
export async function recoverProPaymentsWithoutActivation(now: Date = new Date()): Promise<number> {
  const rows = await openPending("activation_attendue", new Date(now.getTime() - PRO_ACTIVATION_GRACE_MS));
  let ouverts = 0;
  for (const pending of rows) {
    if (!pending.user_id) continue;
    try {
      if (!(await claimPending(pending.event_id, "rattrape"))) continue;
      const current = await periodOf(pending.user_id);
      const periodEnd = proPeriodAfterRecovery(current, now);
      await updateRows("credits", `user_id=eq.${pending.user_id}`, {
        plan: "pro",
        period_end: periodEnd,
        cancelled_at: null,
        updated_at: now.toISOString(),
      });
      await recordPurchase({
        event_id: pending.event_id,
        user_id: pending.user_id,
        plan: "pro",
        analyses_added: 0,
        period_end: periodEnd,
        paid_at: pending.paid_at,
      });
      ouverts += 1;
      console.warn(
        JSON.stringify({
          event: "whop_pro_active_sans_activation",
          event_id: pending.event_id,
          user_id: pending.user_id,
          period_end: periodEnd,
        }),
      );
    } catch (caught) {
      console.error(
        JSON.stringify({
          event: "whop_pro_rattrapage_error",
          event_id: pending.event_id,
          detail: caught instanceof Error ? caught.message.slice(0, 200) : "inconnu",
        }),
      );
    }
  }
  return ouverts;
}

// B — un paiement sans compte correspondant est réessayé par la passe
// principale (l'événement n'est pas marqué traité). Au-delà de 30 jours, on
// arrête d'espérer : la ligne est marquée abandonnée, et c'est dit.
export async function expireUnattachedPayments(now: Date = new Date()): Promise<number> {
  const rows = await openPending("compte_introuvable", new Date(now.getTime() - ATTACHMENT_MAX_DAYS * 24 * 3600 * 1000));
  let abandons = 0;
  for (const pending of rows) {
    if (!(await claimPending(pending.event_id, "abandonne"))) continue;
    abandons += 1;
    console.error(
      JSON.stringify({
        event: "whop_paiement_non_rattache_expire",
        event_id: pending.event_id,
        email: pending.email,
        plan: pending.plan,
        amount: pending.amount,
        paid_at: pending.paid_at,
      }),
    );
  }
  return abandons;
}

// Les deux passes de la mission #092, branchées sur le même cron quotidien que
// le rattrapage des événements. Table absente (migration 027 non appliquée) :
// rien n'est fait, et le reste de la purge continue.
export async function settleUnpaidCounterparts(now: Date = new Date()): Promise<PendingReport> {
  try {
    return { pro_ouverts: await recoverProPaymentsWithoutActivation(now), abandons: await expireUnattachedPayments(now) };
  } catch (caught) {
    if (isMissingRelation(caught)) return { pro_ouverts: 0, abandons: 0 };
    throw caught;
  }
}
