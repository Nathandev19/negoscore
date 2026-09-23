import { beforeEach, describe, expect, it, vi } from "vitest";

// Mission #099, points 1 et 2 (audits A1 et A5) — aucune analyse ne reste
// visible sans avoir été décomptée, et un cron arrêté finit par se dire.
//
// La base est simulée avec ses contraintes : clé primaire sur analysis_id,
// filtres de mise à jour appliqués comme PostgREST le ferait — c'est là que se
// joue « un seul règlement par ligne ».

type Row = Record<string, unknown>;

const db = vi.hoisted(() => ({
  tables: new Map<string, Row[]>(),
  logs: [] as Array<{ level: "log" | "warn" | "error"; event: string; row: Row }>,
  free: new Map<string, number>(),
}));

const matches = (row: Row, filter: string): boolean =>
  filter
    .split("&")
    .filter((part) => part.includes("="))
    .every((part) => {
      const cut = part.indexOf("=");
      const column = part.slice(0, cut);
      const value = decodeURIComponent(part.slice(cut + 1));
      const actual = row[column];
      if (value === "is.null") return actual === null || actual === undefined;
      if (value.startsWith("eq.")) return String(actual) === value.slice(3);
      if (value.startsWith("gte.")) return String(actual) >= value.slice(4);
      if (value.startsWith("lte.")) return String(actual) <= value.slice(4);
      return true;
    });

const key = (row: Row) => row.analysis_id ?? row.job ?? row.user_id ?? JSON.stringify(row);

vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/server")>();
  return {
    ...actual,
    selectRows: async (table: string, query: string) =>
      (db.tables.get(table) ?? []).filter((row) => matches(row, query)).map((row) => ({ ...row })),
    insertIfAbsent: async (table: string, row: Row) => {
      const rows = db.tables.get(table) ?? [];
      if (!rows.some((existing) => key(existing) === key(row))) rows.push({ ...row });
      db.tables.set(table, rows);
    },
    upsertRow: async (table: string, row: Row) => {
      const rows = db.tables.get(table) ?? [];
      const at = rows.findIndex((existing) => key(existing) === key(row));
      if (at < 0) rows.push({ ...row });
      else rows[at] = { ...rows[at], ...row };
      db.tables.set(table, rows);
    },
    updateRows: async (table: string, filter: string, patch: Row) => {
      const updated: Row[] = [];
      for (const row of db.tables.get(table) ?? []) {
        if (!matches(row, filter)) continue;
        Object.assign(row, patch);
        updated.push(row);
      }
      return updated;
    },
    deleteRows: async (table: string, filter: string) => {
      db.tables.set(table, (db.tables.get(table) ?? []).filter((row) => !matches(row, filter)));
    },
    adjustInteger: async (table: string, filter: string, column: string, delta: number, guard: (current: number) => boolean) => {
      const row = (db.tables.get(table) ?? []).find((candidate) => matches(candidate, filter));
      if (!row || !guard(Number(row[column]))) return null;
      const next = Number(row[column]) + delta;
      row[column] = next;
      return next;
    },
    // free_usage_consume : une gratuité, une seule fois par sujet.
    rpc: async (_name: string, args: Record<string, unknown>) => {
      const subject = String(args.p_subject_hash);
      const used = db.free.get(subject) ?? 0;
      if (used >= Number(args.p_limit)) return false;
      db.free.set(subject, used + 1);
      return true;
    },
  };
});

const { recordPendingDebit, openDebits, DEBIT_GRACE_HOURS } = await import("@/lib/analysis/pending-debit");
const { recoverPendingDebits } = await import("@/lib/analysis/debit-recovery");
const { hoursLate, markSuccess, reportLateness, PURGE_JOB, LATE_AFTER_HOURS } = await import("@/lib/privacy/job-runs");

const USER = "11111111-1111-4111-8111-111111111111";
const ANALYSIS = "22222222-2222-4222-8222-222222222222";
const DEAL = "33333333-3333-4333-8333-333333333333";
const NOW = "2026-09-23T10:00:00.000Z";
const at = (hours: number) => new Date(Date.parse(NOW) + hours * 3_600_000);

function capture(level: "log" | "warn" | "error") {
  vi.spyOn(console, level).mockImplementation((line: unknown) => {
    try {
      const row = JSON.parse(String(line)) as Row;
      db.logs.push({ level, event: String(row.event), row });
    } catch {
      db.logs.push({ level, event: String(line), row: {} });
    }
  });
}

const logged = (event: string) => db.logs.filter((entry) => entry.event === event);
const deals = () => db.tables.get("deals") ?? [];
const debits = () => db.tables.get("pending_debits") ?? [];

beforeEach(() => {
  db.tables = new Map<string, Row[]>();
  db.logs = [];
  db.free = new Map<string, number>();
  db.tables.set("deals", [{ id: DEAL, user_id: USER }]);
  db.tables.set("credits", [{ user_id: USER, plan: "pack", balance: 0 }]);
  vi.stubEnv("IP_HASH_SALT", "sel-de-test");
  vi.useFakeTimers();
  vi.setSystemTime(at(0));
  capture("log");
  capture("warn");
  capture("error");
});

const pending = (over: Row = {}) =>
  recordPendingDebit({ analysis_id: ANALYSIS, deal_id: DEAL, user_id: USER, anon_token: null, plan: "pack", ...over });

describe("A1 — une analyse ne reste pas visible sans décompte", () => {
  it("1. l'abandon a échoué : l'analyse est enregistrée comme non décomptée", async () => {
    // Ce que fait la route quand abandon() n'a pas pu supprimer l'analyse.
    console.error(JSON.stringify({ event: "analyse_non_decomptee", analysis_id: ANALYSIS, user_id: USER, plan: "pack" }));
    await pending();

    expect(logged("analyse_non_decomptee")[0].row).toMatchObject({ analysis_id: ANALYSIS, user_id: USER });
    expect(await openDebits()).toHaveLength(1);
    // Une seconde tentative ne crée pas de doublon : analysis_id est la clé.
    await pending();
    expect(debits()).toHaveLength(1);
  });

  it("2. le rattrapage retente le décompte, et l'analyse reste", async () => {
    await pending();
    // Le solde est revenu entre-temps.
    (db.tables.get("credits") ?? [])[0].balance = 2;

    const report = await recoverPendingDebits();

    expect(report).toMatchObject({ decomptes: 1, supprimees: 0 });
    expect((db.tables.get("credits") ?? [])[0].balance).toBe(1);
    expect(deals()).toHaveLength(1);
    expect(debits()[0]).toMatchObject({ resolution: "decompte", attempts: 1 });
    // Réglée : un second passage ne débite pas une seconde fois.
    await recoverPendingDebits();
    expect((db.tables.get("credits") ?? [])[0].balance).toBe(1);
  });

  it("3. solde insuffisant : l'analyse est supprimée, et c'est journalisé", async () => {
    await pending();

    const report = await recoverPendingDebits();

    expect(report).toMatchObject({ decomptes: 0, supprimees: 1 });
    // Le deal part, l'analyse avec lui (cascade).
    expect(deals()).toHaveLength(0);
    expect(debits()[0]).toMatchObject({ resolution: "supprimee" });
    expect(logged("analyse_supprimee_faute_de_decompte")[0].row).toMatchObject({ analysis_id: ANALYSIS, plan: "pack" });
    // Aucune analyse non décomptée ne survit au passage suivant du cron.
    expect(DEBIT_GRACE_HOURS).toBe(24);
    expect(await openDebits()).toEqual([]);
  });

  it("3 bis. analyse gratuite : la gratuité est décomptée, l'analyse reste", async () => {
    await pending({ user_id: null, anon_token: "jeton-anon", plan: "free" });

    expect(await recoverPendingDebits()).toMatchObject({ decomptes: 1, supprimees: 0 });
    expect(deals()).toHaveLength(1);
  });
});

describe("A5 — un cron arrêté finit par se dire", () => {
  it("4. plus de 48 h sans passage : le passage suivant journalise le retard", async () => {
    await markSuccess(PURGE_JOB, at(-72));

    const late = await reportLateness(PURGE_JOB, at(0));

    expect(late).toBe(72);
    expect(logged("purge_en_retard")[0].row).toMatchObject({ job: PURGE_JOB, heures: 72 });
  });

  it("4 bis. à l'heure, ou premier passage : rien n'est signalé", async () => {
    expect(hoursLate(at(-24), at(0))).toBeNull();
    expect(hoursLate(null, at(0))).toBeNull();
    expect(LATE_AFTER_HOURS).toBe(48);

    await markSuccess(PURGE_JOB, at(-24));
    expect(await reportLateness(PURGE_JOB, at(0))).toBeNull();
    expect(logged("purge_en_retard")).toEqual([]);
  });
});
