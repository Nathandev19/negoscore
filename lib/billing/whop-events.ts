import { sanitizeDistinctId } from "@/lib/analytics/distinct-id";
import { furthestPeriodEnd, isProActive } from "@/lib/billing/plan-access";
import { PACK_ANALYSES } from "@/lib/billing/plans";
import { recordPurchase } from "@/lib/billing/purchases";
import {
  attachActivation,
  claimPending,
  closeAwaitingActivation,
  honoredProAwaitingActivation,
  recordPending,
} from "@/lib/billing/pending-payments";
import { planKeyFromId, type PlanKey } from "@/lib/whop/api";
import { adjustInteger, insertIfAbsent, isMissingColumn, isMissingRelation, rpc, selectRows, updateRows } from "@/lib/supabase/server";
import { isUuid } from "@/lib/security/request";
import { parseAttribution, type Attribution } from "@/lib/analytics/first-party";

// Effets d'un événement Whop sur les crédits. Tout passe par la clé
// service_role : un utilisateur ne modifie jamais son solde.

export type WhopEvent = { id: string; type: string; data: Record<string, unknown> };
export type EventOutcome = {
  handled: boolean;
  reason: string;
  // Mission #092, B — paiement encaissé qu'on n'a pas su rattacher à un compte.
  // L'événement N'EST PAS marqué traité : le rattrapage quotidien réessaiera.
  pending?: boolean;
  userId?: string;
  userEmail?: string | null;
  analyticsId?: string | null;
  plan?: PlanKey;
  amount?: number | null;
  currency?: string | null;
  attribution?: Attribution;
};

type Credits = {
  user_id: string;
  plan: "free" | "pack" | "pro";
  balance: number;
  period_end: string | null;
  cancelled_at: string | null;
  // Abonnement Whop en cours sur ce compte (migration 026). null : inconnu.
  membership_id?: string | null;
};
type Profile = { id: string; email: string | null };

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

// Identifiant d'abonnement Whop, avant d'entrer dans un filtre PostgREST.
// Gabarit strict : aucun caractère réservé par les filtres (virgule,
// parenthèse, guillemet, espace, point). Le gabarit d'email qui vivait ici a
// disparu avec son seul usage, l'attribution par adresse (mission #112).
const MEMBERSHIP_ID = /^[A-Za-z0-9_-]{1,100}$/;

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

// RATTACHEMENT PAR IDENTIFIANT, JAMAIS PAR EMAIL (mission #112, A3).
//
// Ce qui existait avant : à défaut de l'identifiant posé en metadata au
// checkout, on cherchait un compte par l'ADRESSE DE L'ACHETEUR renvoyée par
// Whop. Deux façons de créditer le mauvais compte :
//   - l'adresse de paiement n'est pas l'adresse du compte. Testé en production
//     le 24/09 : un paiement Apple Pay part sous l'adresse du portefeuille, pas
//     sous celle avec laquelle on s'est inscrit ;
//   - si cette adresse appartient à un AUTRE compte Negoscore, c'est lui qui
//     était crédité, et personne ne le voyait passer.
//
// L'email reste utile pour AFFICHER et pour CONTACTER (il est enregistré sur la
// ligne d'attente, et il apparaît dans /admin). Il ne décide plus de qui est
// crédité.
//
// Ce que ce code ne fait pas, et n'a jamais fait : créer un compte. Il ne fait
// que LIRE la table profiles. La seule création de compte du produit est
// ensureAccount (lib/auth/account.ts), appelée à la connexion, avec une session
// Supabase Auth vérifiée.
async function resolveUser(
  data: Record<string, unknown>,
): Promise<{ id: string; email: string | null; how: "metadata" | "membership" } | null> {
  const metadata = record(data.metadata);
  const fromMetadata = text(metadata.user_id);
  // La valeur vient de la charge du webhook. Elle n'est posée dans un filtre
  // PostgREST qu'après contrôle de forme (mission #062, E2) : une valeur hors
  // gabarit ferait échouer la requête, et Postgres recopie alors la valeur
  // fautive dans le message d'erreur, qui est journalisé.
  if (fromMetadata && isUuid(fromMetadata)) {
    const rows = await selectRows<Profile>("profiles", `select=id,email&id=eq.${encodeURIComponent(fromMetadata)}&limit=1`);
    if (rows.length > 0) return { id: rows[0].id, email: rows[0].email, how: "metadata" };
  }
  return null;
}

// Second IDENTIFIANT, pour les événements d'abonnement : celui de l'abonnement
// Whop, que NOUS avons enregistré sur le compte à l'activation
// (credits.membership_id, migration 026). Ce n'est pas un repli par email :
// c'est un identifiant technique que nous avons nous-mêmes rattaché à un
// compte. Sans lui, un renouvellement dont Whop ne recopierait pas les
// metadata n'étendrait plus la période d'un abonné en règle.
async function resolveByMembership(membershipId: string | null): Promise<{ id: string; email: string | null; how: "membership" } | null> {
  if (!membershipId || !MEMBERSHIP_ID.test(membershipId)) return null;
  try {
    const rows = await selectRows<{ user_id: string }>(
      "credits",
      `select=user_id&membership_id=eq.${encodeURIComponent(membershipId)}&limit=1`,
    );
    if (rows.length === 0) return null;
    const [profile] = await selectRows<Profile>("profiles", `select=id,email&id=eq.${rows[0].user_id}&limit=1`);
    return profile ? { id: profile.id, email: profile.email, how: "membership" } : null;
  } catch (caught) {
    // Colonne membership_id absente (migration 026 non appliquée) : on ne sait
    // pas rattacher par ce chemin, et on ne devine pas.
    if (!isMissingColumn(caught)) throw caught;
    return null;
  }
}

async function credits(userId: string): Promise<Credits> {
  await insertIfAbsent("credits", { user_id: userId, balance: 0, plan: "free" });
  const [row] = await selectRows<Credits>(
    "credits",
    `select=user_id,plan,balance,period_end,cancelled_at,membership_id&user_id=eq.${userId}&limit=1`,
  ).catch(async (caught: unknown) => {
    // Colonne membership_id absente (migration 026 pas encore appliquée) :
    // on lit sans elle, et l'abonnement reste « inconnu » (aucune prolongation
    // à l'aveugle, voir periodAfterActivation).
    if (!isMissingColumn(caught)) throw caught;
    return selectRows<Credits>("credits", `select=user_id,plan,balance,period_end,cancelled_at&user_id=eq.${userId}&limit=1`);
  });
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

// Durée d'une période Pro, quand Whop n'annonce pas de date de fin et pour le
// rattrapage d'un paiement resté sans activation (mission #092, A).
export const PRO_PERIOD_MS = 30 * 24 * 3600 * 1000;

// Mission #092, A — période ouverte par le rattrapage d'un paiement Pro resté
// sans activation. Même règle que le chemin membership.activated du cas
// « aucun abonnement actif » : un mois à partir de maintenant. Quand une
// période court déjà, ce mois s'AJOUTE (il a été payé) : jamais d'écrasement.
export function proPeriodAfterRecovery(currentEnd: string | null, now: Date = new Date()): string {
  const end = currentEnd ? new Date(currentEnd).getTime() : 0;
  const base = Math.max(end, now.getTime());
  return new Date(base + PRO_PERIOD_MS).toISOString();
}

// Mission #090 bis — un abonnement activé PROLONGE la période en place quand
// il s'agit d'un abonnement DISTINCT : deux mois payés donnent deux mois
// d'accès. Le renouvellement mensuel du même abonnement, lui, pose simplement
// la date annoncée par Whop : la prolonger reviendrait à offrir un mois.
//
// Ce qui distingue les deux, dans la charge de Whop : l'identifiant de
// l'abonnement (data.id), comparé à celui enregistré sur le compte.
// Identifiant inconnu des deux côtés (abonnement activé avant la migration
// 026, ou charge sans id) : on ne peut pas trancher. On garde alors la date la
// plus lointaine — jamais moins que ce qui est déjà dû — et on le journalise.
export function periodAfterActivation(
  current: { period_end: string | null; membership_id?: string | null },
  membershipId: string | null,
  renewalEnd: string,
  now: Date = new Date(),
): { periodEnd: string; kind: "renewal" | "extended" | "new" | "indistinct" } {
  const end = current.period_end ? new Date(current.period_end).getTime() : 0;
  const active = end > now.getTime();
  const renewal = new Date(renewalEnd).getTime();
  if (!active) return { periodEnd: renewalEnd, kind: "new" };
  const known = membershipId !== null && (current.membership_id ?? null) !== null;
  if (known && membershipId === current.membership_id) return { periodEnd: renewalEnd, kind: "renewal" };
  if (!known) {
    return { periodEnd: new Date(Math.max(end, renewal)).toISOString(), kind: "indistinct" };
  }
  // Abonnement distinct : sa durée s'ajoute à la période en cours.
  const added = Math.max(0, renewal - now.getTime());
  return { periodEnd: new Date(end + added).toISOString(), kind: "extended" };
}

// Mission #094 — un remboursement doit révoquer ce que le paiement avait
// accordé. Encore faut-il retrouver CE paiement : la charge d'un
// « refund.created » peut porter le paiement en objet imbriqué
// (data.payment), en identifiant (data.payment_id), ou seulement en
// référence. On accepte les trois, puis, à défaut, on retrouve le paiement
// dans NOS propres événements : il y est enregistré en entier.
function refundedPaymentId(data: Record<string, unknown>): string | null {
  const nested = record(data.payment);
  return text(nested.id) ?? text(data.payment_id) ?? (typeof data.payment === "string" ? data.payment : null);
}

// Le paiement d'origine, tel que nous l'avons reçu et enregistré. null : nous
// ne l'avons jamais vu (paiement antérieur au webhook, ou charge sans
// identifiant), et le remboursement se contentera alors de ce qu'il porte.
async function storedPayment(paymentId: string | null): Promise<{ eventId: string; data: Record<string, unknown> } | null> {
  if (!paymentId) return null;
  try {
    const rows = await selectRows<{ event_id: string; payload: unknown }>(
      "whop_events",
      `select=event_id,payload&type=eq.payment.succeeded&payload->data->>id=eq.${encodeURIComponent(paymentId)}&limit=1`,
    );
    const row = rows[0];
    if (!row) return null;
    const payload = record(row.payload);
    return { eventId: row.event_id, data: record(payload.data) };
  } catch (caught) {
    console.warn(
      JSON.stringify({ event: "whop_paiement_rembourse_introuvable", detail: caught instanceof Error ? caught.message.slice(0, 200) : "inconnu" }),
    );
    return null;
  }
}

// RÈGLE COMMUNE (mission #092, tenue par la base) : l'effet d'un événement
// n'est appliqué qu'une fois. Le crédit passe par whop_event_credit, qui marque
// whop_events.credited_at ; une révocation marque la MÊME colonne, sur la ligne
// du remboursement, par une mise à jour filtrée « credited_at is null ». Deux
// passes concurrentes ne peuvent pas la réussir toutes les deux.
async function claimEventEffect(eventId: string): Promise<boolean> {
  const rows = await updateRows<{ event_id: string }>(
    "whop_events",
    `event_id=eq.${encodeURIComponent(eventId)}&credited_at=is.null`,
    { credited_at: new Date().toISOString() },
  );
  return rows.length > 0;
}

// Mission #094, étape 2 — symétrie exacte de la prolongation (#090 bis) : le
// remboursement d'un paiement retire la durée que CE paiement avait accordée,
// avec un plancher à maintenant. Jamais de période négative, jamais de date
// antérieure à l'instant présent : ce qui a déjà été consommé l'a été.
export function periodAfterRefund(currentEnd: string | null, grantedMs: number, now: Date = new Date()): string {
  const end = currentEnd ? new Date(currentEnd).getTime() : 0;
  return new Date(Math.max(now.getTime(), end - grantedMs)).toISOString();
}

function planOf(data: Record<string, unknown>): PlanKey | null {
  return planKeyFromId(text(record(data.plan).id));
}

export async function applyWhopEvent(event: WhopEvent): Promise<EventOutcome> {
  const { type, data } = event;

  if (type === "payment.failed") {
    return { handled: true, reason: "paiement échoué : aucun crédit" };
  }

  // Mission #094 — le remboursement suit son propre chemin : il doit retrouver
  // le paiement remboursé avant de savoir ce qu'il révoque.
  if (type === "refund.created") return applyRefund(event);

  const source = data;
  const plan = planOf(source);
  if (!plan) return { handled: false, reason: "plan hors formules Negoscore" };

  // Mission #112 — l'identifiant du compte d'abord ; pour un événement
  // d'abonnement, à défaut, l'identifiant de l'abonnement que nous avons
  // nous-mêmes enregistré. Jamais l'adresse de l'acheteur.
  const user =
    (await resolveUser(source)) ??
    (type === "membership.activated" || type === "membership.deactivated" ? await resolveByMembership(text(source.id)) : null);
  if (!user) {
    // Mission #092, B — de l'argent est encaissé et personne n'est crédité :
    // le paiement est mis en attente de rattachement, avec l'email de
    // l'acheteur, et l'événement reste à reprendre. Un événement qui n'est pas
    // un paiement (activation, résiliation) n'a rien à accorder : inchangé.
    if (type !== "payment.succeeded") return { handled: false, reason: "aucun compte rattaché à cet événement" };
    const email = text(record(source.user).email);
    console.warn(JSON.stringify({ event: "whop_paiement_non_rattache", event_id: event.id, email, plan }));
    await recordPending({
      event_id: event.id,
      user_id: null,
      email,
      plan,
      amount: typeof source.total === "number" ? source.total : null,
      currency: text(source.currency),
      paid_at: new Date().toISOString(),
      reason: "compte_introuvable",
    });
    return { handled: false, pending: true, reason: "aucun compte rattaché à ce paiement : en attente de rattachement" };
  }
  const current = await credits(user.id);
  // Identifiant anonyme posé au checkout : il relie l'achat au parcours mesuré.
  const analyticsId = sanitizeDistinctId(record(source.metadata).ph_distinct_id);
  const attribution = parseAttribution(source.metadata);

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
      amount: typeof source.total === "number" ? source.total : null,
      currency: text(source.currency),
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
      attribution,
    };
  }

  if (type === "payment.succeeded" && plan === "pro") {
    // L'abonnement est activé par membership.activated : ici on note seulement
    // le revenu. Mission #092, A — et on note qu'une activation est ATTENDUE :
    // si elle n'arrive pas, le rattrapage ouvrira le mois payé.
    const total = typeof source.total === "number" ? source.total : null;
    // Abonnement déjà actif ET connu : ce paiement est un renouvellement, ou
    // l'activation est arrivée avant lui. Rien à ouvrir — la ligne est gardée
    // pour la trace, déjà réglée, et le rattrapage ne la reprendra pas.
    const alreadyActive = isProActive(current) && (current.membership_id ?? null) !== null;
    await recordPending({
      event_id: event.id,
      user_id: user.id,
      email: user.email,
      plan,
      amount: total,
      currency: text(source.currency),
      paid_at: new Date().toISOString(),
      reason: "activation_attendue",
      ...(alreadyActive ? { resolution: "active" as const, resolved_at: new Date().toISOString() } : {}),
    });
    return {
      handled: true,
      reason: `paiement Pro enregistré (rattachement par ${user.how})`,
      userId: user.id,
      userEmail: user.email,
      analyticsId,
      plan,
      amount: total,
      currency: text(source.currency),
      attribution,
    };
  }

  if (type === "membership.activated" && plan === "pro") {
    const announced = text(data.renewal_period_end) ?? new Date(Date.now() + PRO_PERIOD_MS).toISOString();
    const membershipId = text(data.id);

    // Mission #092, A — ce paiement a déjà été honoré par le rattrapage, faute
    // d'activation à temps : l'activation qui arrive après coup n'accorde RIEN
    // de plus. Elle ne fait que confirmer l'abonnement et le mémoriser.
    const honored = await honoredProAwaitingActivation(user.id, new Date());
    if (honored && (await attachActivation(honored.event_id, event.id))) {
      if (membershipId) {
        await updateRows("credits", `user_id=eq.${user.id}`, {
          membership_id: membershipId,
          updated_at: new Date().toISOString(),
        }).catch((caught: unknown) => {
          if (!isMissingColumn(caught)) throw caught;
          return [];
        });
      }
      console.log(JSON.stringify({ event: "whop_activation_deja_rattrapee", event_id: event.id, paiement: honored.event_id }));
      return {
        handled: true,
        reason: `abonnement déjà ouvert par le rattrapage du paiement ${honored.event_id}`,
        userId: user.id,
        plan,
      };
    }
    // Activation normale : les paiements Pro qui l'attendaient sont réglés, le
    // rattrapage n'a plus rien à ouvrir pour eux.
    await closeAwaitingActivation(user.id);
    const { periodEnd, kind } = periodAfterActivation(current, membershipId, announced);
    if (kind === "indistinct") {
      console.warn(JSON.stringify({ event: "whop_abonnement_indistinct", has_membership_id: membershipId !== null }));
    }
    await updateRows("credits", `user_id=eq.${user.id}`, {
      plan: "pro",
      period_end: periodEnd,
      // Un réabonnement efface une résiliation antérieure.
      cancelled_at: null,
      ...(membershipId ? { membership_id: membershipId } : {}),
      updated_at: new Date().toISOString(),
    }).catch(async (caught: unknown) => {
      // Colonne membership_id absente : la période reste juste, l'abonnement
      // n'est simplement pas mémorisé.
      if (!isMissingColumn(caught)) throw caught;
      return updateRows("credits", `user_id=eq.${user.id}`, {
        plan: "pro",
        period_end: periodEnd,
        cancelled_at: null,
        updated_at: new Date().toISOString(),
      });
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
    return { handled: true, reason: `Pro actif jusqu'au ${periodEnd} (${kind})`, userId: user.id, plan, attribution };
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
      // Mission #090 bis — la résiliation d'UN abonnement ne raccourcit jamais
      // une période déjà payée : quand un second abonnement l'avait prolongée,
      // la date en place est plus lointaine que celle de l'abonnement résilié.
      // On garde la plus lointaine des deux.
      // Mission #113, E — la même règle que la résiliation manuelle, au même
      // endroit (lib/billing/plan-access.ts).
      const keptEnd = furthestPeriodEnd(current.period_end, renewalEnd) ?? renewalEnd;
      await updateRows("credits", `user_id=eq.${user.id}`, {
        plan: "pro",
        period_end: keptEnd,
        // La date de demande n'est jamais écrasée : c'est la première qui compte.
        ...(current.cancelled_at ? {} : { cancelled_at: new Date().toISOString() }),
        updated_at: new Date().toISOString(),
      });
      return {
        handled: true,
        reason: `résiliation enregistrée, accès Pro conservé jusqu'au ${keptEnd}`,
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

  return { handled: false, reason: `événement ignoré (${type})` };
}

// Mission #094 — un remboursement révoque ce que CE paiement avait accordé.
// Symétrie exacte de la prolongation de #090 bis : un mois ajouté par un
// paiement, un mois retiré par son remboursement. Ce qui a déjà été produit —
// analyses, négociations, tours — n'est jamais supprimé : le remboursement
// retire un droit d'usage à venir, pas un travail déjà livré.
async function applyRefund(event: WhopEvent): Promise<EventOutcome> {
  const data = event.data;
  const now = new Date();
  const paymentId = refundedPaymentId(data);

  // 1. Le paiement remboursé. La charge de Whop l'imbrique (data.payment) ;
  //    quand elle ne le fait pas, on le relit dans NOS propres événements, où
  //    il est enregistré en entier. C'est lui qui porte le plan et le compte.
  const nested = record(data.payment);
  const origin = planOf(nested) ? null : await storedPayment(paymentId);
  const payment = origin ? origin.data : nested;
  const plan = planOf(payment);

  if (!plan) {
    // Paiement d'un autre produit du même compte Whop : il n'a jamais rien
    // accordé ici, son remboursement n'a rien à révoquer.
    if (text(record(payment.plan).id)) {
      console.log(JSON.stringify({ event: "whop_remboursement_sans_effet", event_id: event.id, raison: "plan hors formules Negoscore", paiement: paymentId }));
      return { handled: true, reason: "remboursement d'un paiement hors formules Negoscore : rien à révoquer" };
    }
    // Paiement introuvable : on ne devine pas ce qu'il faut retirer, et on ne
    // condamne pas l'événement — il reste à reprendre.
    console.warn(JSON.stringify({ event: "whop_remboursement_non_rattache", event_id: event.id, raison: "paiement remboursé introuvable", paiement: paymentId }));
    return { handled: false, pending: true, reason: "remboursement : paiement remboursé introuvable" };
  }

  // 2. Le compte se retrouve par le MÊME chemin que le crédit initial :
  //    métadonnées du paiement, puis email de l'acheteur.
  const user = await resolveUser(payment);
  if (!user) {
    console.warn(
      JSON.stringify({
        event: "whop_remboursement_non_rattache",
        event_id: event.id,
        paiement: paymentId,
        email: text(record(payment.user).email),
        plan,
      }),
    );
    return { handled: false, pending: true, reason: "remboursement : aucun compte rattaché à ce paiement" };
  }

  // 3. Remboursement partiel : le montant rendu est inférieur au total payé.
  //    On ne révoque RIEN — retirer un mois entier pour un geste commercial
  //    serait faux — et on le journalise pour trancher sur pièces.
  const total = typeof payment.total === "number" ? payment.total : null;
  const amount = typeof data.amount === "number" ? data.amount : null;
  const cents = (value: number) => Math.round(value * 100);
  if (total !== null && amount !== null && cents(amount) < cents(total)) {
    console.warn(JSON.stringify({ event: "whop_remboursement_partiel", event_id: event.id, montant: amount, total, plan }));
    return { handled: true, reason: `remboursement partiel (${amount} sur ${total}) : aucune révocation`, userId: user.id, plan };
  }
  if (total === null || amount === null) {
    // Faute de montants comparables, on traite le remboursement comme intégral
    // — l'argent est rendu — mais on dit qu'on n'a pas pu le vérifier.
    console.warn(JSON.stringify({ event: "whop_remboursement_montant_inconnu", event_id: event.id, montant: amount, total }));
  }

  // 4. Une révocation par remboursement, jamais deux : la ligne de l'événement
  //    est marquée (credited_at) par une mise à jour filtrée, comme le crédit.
  if (!(await claimEventEffect(event.id))) {
    console.log(JSON.stringify({ event: "whop_remboursement_deja_applique", event_id: event.id }));
    return { handled: true, reason: "remboursement déjà révoqué", userId: user.id, plan };
  }

  const current = await credits(user.id);

  // Le paiement rendu ne financera plus l'activation qu'il attendait : sans
  // cela, le rattrapage de #092 ouvrirait un mois pour un paiement remboursé.
  if (origin) await claimPending(origin.eventId, "abandonne");

  if (plan === "pack") {
    const removed = Math.min(PACK_ANALYSES, current.balance);
    if (removed === 0) {
      console.log(JSON.stringify({ event: "whop_remboursement_sans_effet", event_id: event.id, plan, raison: "solde déjà nul" }));
      return { handled: true, reason: "remboursement : aucune analyse à retirer", userId: user.id, plan };
    }
    // Le solde ne descend jamais sous zéro : on ne retire que ce qui reste.
    const remaining = current.balance - removed;
    await addBalance(user.id, -removed);
    if (current.plan === "pack" && remaining === 0) {
      await updateRows("credits", `user_id=eq.${user.id}&plan=eq.pack`, { plan: "free", updated_at: now.toISOString() });
    }
    return { handled: true, reason: `remboursement : -${removed} analyses`, userId: user.id, plan };
  }

  // Ce paiement n'a jamais ouvert de période : rien à révoquer, et on le dit.
  if (!current.period_end && current.plan !== "pro") {
    console.log(JSON.stringify({ event: "whop_remboursement_sans_effet", event_id: event.id, plan, raison: "aucune période en cours" }));
    return { handled: true, reason: "remboursement Pro : aucune période à révoquer", userId: user.id, plan };
  }

  // La durée accordée par un paiement Pro est celle d'une période : la même
  // que celle ajoutée par l'activation ou par le rattrapage.
  const periodEnd = periodAfterRefund(current.period_end, PRO_PERIOD_MS, now);
  const stillPro = new Date(periodEnd).getTime() > now.getTime();
  const nextPlan = stillPro ? "pro" : current.balance > 0 ? "pack" : "free";
  await updateRows("credits", `user_id=eq.${user.id}`, {
    plan: nextPlan,
    period_end: periodEnd,
    // L'accès est clos maintenant : une résiliation en attente n'a plus d'objet.
    ...(stillPro ? {} : { cancelled_at: null }),
    updated_at: now.toISOString(),
  });
  return {
    handled: true,
    reason: stillPro
      ? `remboursement Pro : période ramenée au ${periodEnd}`
      : `remboursement Pro : accès clos, retour au plan ${nextPlan}`,
    userId: user.id,
    plan,
  };
}
