import { isMissingRelation, selectRows, upsertRow } from "@/lib/supabase/server";

// Mission #099, point 2 (audit A5) — savoir si une tâche récurrente est
// passée. Le silence d'un cron arrêté a exactement la même tête que le silence
// d'un cron qui fonctionne : seule la date de son dernier passage réussi
// permet de les distinguer (table system_runs, migration 20260923000029).

export const PURGE_JOB = "purge";
// Le cron passe une fois par jour. Deux passages manqués, c'est une panne.
export const LATE_AFTER_HOURS = 48;

function absent(caught: unknown, operation: string): boolean {
  if (!isMissingRelation(caught)) return false;
  console.warn(JSON.stringify({ event: "system_runs_table_absente", operation }));
  return true;
}

export async function lastSuccess(job: string): Promise<Date | null> {
  try {
    const [row] = await selectRows<{ last_success_at: string }>(
      "system_runs",
      `select=last_success_at&job=eq.${encodeURIComponent(job)}&limit=1`,
    );
    return row ? new Date(row.last_success_at) : null;
  } catch (caught) {
    if (!absent(caught, "lecture")) throw caught;
    return null;
  }
}

export async function markSuccess(job: string, now: Date = new Date()): Promise<void> {
  try {
    await upsertRow("system_runs", { job, last_success_at: now.toISOString(), updated_at: now.toISOString() }, "job");
  } catch (caught) {
    if (!absent(caught, "écriture")) throw caught;
  }
}

// Heures écoulées depuis le dernier passage réussi, quand c'est trop.
// null : à l'heure, ou premier passage (rien à comparer).
export function hoursLate(last: Date | null, now: Date = new Date()): number | null {
  if (last === null) return null;
  const hours = (now.getTime() - last.getTime()) / 3_600_000;
  return hours > LATE_AFTER_HOURS ? Math.floor(hours) : null;
}

// Le passage en cours dit si le précédent est trop vieux. C'est le seul moment
// où quelqu'un regarde : un cron arrêté ne peut pas se signaler lui-même, mais
// sa reprise, elle, doit dire depuis combien de temps il ne passait plus.
export async function reportLateness(job: string, now: Date = new Date()): Promise<number | null> {
  const late = hoursLate(await lastSuccess(job), now);
  if (late !== null) console.warn(JSON.stringify({ event: "purge_en_retard", job, heures: late }));
  return late;
}
