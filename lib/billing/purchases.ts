import { insertIfAbsent, isMissingRelation, selectRows } from "@/lib/supabase/server";

// Mission #090 — ce qui vient d'être acheté, écrit par le webhook au moment où
// il accorde la contrepartie, et lu par la page « Merci ». Le solde ne le dit
// pas : « 5 analyses » ne distingue pas un pack qui vient d'être payé d'un
// solde qui n'a pas bougé. Table purchases (migration 20260922000025).

export type Purchase = {
  event_id: string;
  plan: "pack" | "pro";
  analyses_added: number;
  period_end: string | null;
  paid_at: string;
};

// Un achat n'est enregistré qu'une fois par événement Whop : un rejeu du
// webhook ou le rattrapage quotidien ne créent pas de doublon. Table absente
// (migration pas encore appliquée) : le crédit, lui, a déjà été accordé ; on
// ne fait pas échouer le webhook pour autant, et la page reste prudente.
export async function recordPurchase(purchase: Purchase & { user_id: string }): Promise<void> {
  try {
    await insertIfAbsent("purchases", purchase);
  } catch (caught) {
    if (!isMissingRelation(caught)) throw caught;
    console.warn(JSON.stringify({ event: "purchases_table_absente" }));
  }
}

// Fenêtre pendant laquelle un achat est « celui qui vient d'être fait » : au
// retour de la page de paiement. Au-delà, la page ne confirme plus d'achat.
export const RECENT_PURCHASE_MS = 2 * 60 * 60 * 1000;

// Deux paiements du même produit à quelques minutes d'intervalle : un achat en
// double accidentel. La page le dit (mission #090, B3) plutôt que de le taire.
export const DUPLICATE_PURCHASE_MS = 15 * 60 * 1000;

export type RecentPurchases = {
  last: Purchase | null;
  // Achats du même produit que « last », dans les minutes qui l'entourent
  // (1 = aucun doublon), et le total d'analyses qu'ils ont ajoutées.
  duplicates: number;
  analysesAdded: number;
};

// "unavailable" : la table n'existe pas encore, ou la lecture a échoué. La page
// n'affirme alors aucun achat (mission #090, A2).
export async function recentPurchases(userId: string, now: Date = new Date()): Promise<RecentPurchases | "unavailable"> {
  const since = new Date(now.getTime() - RECENT_PURCHASE_MS).toISOString();
  let rows: Purchase[];
  try {
    rows = await selectRows<Purchase>(
      "purchases",
      `select=event_id,plan,analyses_added,period_end,paid_at&user_id=eq.${userId}&paid_at=gte.${encodeURIComponent(since)}&order=paid_at.desc&limit=10`,
    );
  } catch (caught) {
    console.warn(JSON.stringify({ event: "purchases_lecture_impossible", missing: isMissingRelation(caught) }));
    return "unavailable";
  }
  const last = rows[0] ?? null;
  if (!last) return { last: null, duplicates: 0, analysesAdded: 0 };
  const paidAt = new Date(last.paid_at).getTime();
  const group = rows.filter(
    (row) => row.plan === last.plan && Math.abs(new Date(row.paid_at).getTime() - paidAt) <= DUPLICATE_PURCHASE_MS,
  );
  return { last, duplicates: group.length, analysesAdded: group.reduce((sum, row) => sum + row.analyses_added, 0) };
}
