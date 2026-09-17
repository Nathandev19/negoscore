import { applyWhopEvent, type WhopEvent } from "@/lib/billing/whop-events";
import { isMissingColumn, selectRows, updateRows } from "@/lib/supabase/server";

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

export type RecoveryReport = { repris: number; traites: number; echecs: number };

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

  const report: RecoveryReport = { repris: rows.length, traites: 0, echecs: 0 };
  for (const row of rows) {
    const event = toEvent(row);
    if (!event) {
      report.echecs += 1;
      continue;
    }
    try {
      const outcome = await applyWhopEvent(event);
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
