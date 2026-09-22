import { beforeEach, describe, expect, it, vi } from "vitest";

// Mission #094 — un remboursement révoque ce qu'il a payé.
//
// Constaté en production : deux abonnements Pro remboursés le 16/09 laissaient
// l'accès ouvert jusqu'au 16/10. La base est simulée avec ses contraintes —
// clé primaire sur event_id, filtres de mise à jour appliqués comme PostgREST
// le ferait — parce que c'est là que se joue « une seule révocation ».

type Row = Record<string, unknown>;

const db = vi.hoisted(() => ({
  tables: new Map<string, Row[]>(),
  logs: [] as Array<{ level: "log" | "warn" | "error"; event: string; row: Row }>,
}));

// Filtres PostgREST utilisés par le code : eq, is.null, gte, lte, ilike, et le
// chemin JSON qui retrouve un paiement dans la charge enregistrée.
const valueOf = (row: Row, column: string): unknown => {
  if (column === "payload->data->>id") {
    const payload = (row.payload ?? {}) as Row;
    return ((payload.data ?? {}) as Row).id;
  }
  return row[column];
};

const matches = (row: Row, filter: string): boolean =>
  filter
    .split("&")
    .filter((part) => part.includes("="))
    .every((part) => {
      const cut = part.indexOf("=");
      const column = part.slice(0, cut);
      const value = decodeURIComponent(part.slice(cut + 1));
      const actual = valueOf(row, column);
      if (value === "is.null") return actual === null || actual === undefined;
      if (value.startsWith("eq.")) return String(actual) === value.slice(3);
      if (value.startsWith("ilike.")) return String(actual).toLowerCase() === value.slice(6).toLowerCase();
      if (value.startsWith("gte.")) return String(actual) >= value.slice(4);
      if (value.startsWith("lte.")) return String(actual) <= value.slice(4);
      return true;
    });

const key = (row: Row) => row.event_id ?? row.user_id ?? JSON.stringify(row);

vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/server")>();
  return {
    ...actual,
    // Une lecture rend une COPIE, comme PostgREST : le code ne travaille
    // jamais sur la ligne vivante de la base.
    selectRows: async (table: string, query: string) =>
      (db.tables.get(table) ?? []).filter((row) => matches(row, query)).map((row) => ({ ...row })),
    insertIfAbsent: async (table: string, row: Row) => {
      const rows = db.tables.get(table) ?? [];
      if (!rows.some((existing) => key(existing) === key(row))) rows.push({ ...row });
      db.tables.set(table, rows);
    },
    insertRow: async (table: string, row: Row) => {
      const rows = db.tables.get(table) ?? [];
      rows.push({ ...row });
      db.tables.set(table, rows);
      return { id: "x" };
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
    // Ajustement conditionnel : la garde interdit de descendre sous zéro.
    adjustInteger: async (
      table: string,
      filter: string,
      column: string,
      delta: number,
      guard: (current: number) => boolean,
    ) => {
      const row = (db.tables.get(table) ?? []).find((candidate) => matches(candidate, filter));
      if (!row || !guard(Number(row[column]))) return null;
      const next = Number(row[column]) + delta;
      row[column] = next;
      return next;
    },
    rpc: async () => true,
  };
});

const { applyWhopEvent } = await import("@/lib/billing/whop-events");
const { recoverProPaymentsWithoutActivation } = await import("@/lib/billing/webhook-recovery");

const USER = "11111111-1111-4111-8111-111111111111";
const EMAIL = "nina@exemple.test";
const NOW = "2026-09-16T10:00:00.000Z";
const DAY = 24 * 3600 * 1000;
const at = (days: number) => new Date(Date.parse(NOW) + days * DAY);
const iso = (days: number) => at(days).toISOString();

const credits = () => (db.tables.get("credits") ?? [])[0];
const events = () => db.tables.get("whop_events") ?? [];
const logged = (event: string) => db.logs.filter((entry) => entry.event === event);

const payment = (over: Row = {}) => ({
  id: "pay_1",
  plan: { id: "plan_pro" },
  metadata: { user_id: USER },
  user: { email: EMAIL },
  total: 12.99,
  ...over,
});

const refund = (id: string, data: Row) => ({ id, type: "refund.created", data });

// Le webhook enregistre l'événement AVANT de l'appliquer, et ne le marque
// traité que si le traitement n'a pas demandé à être repris (mission #092).
async function receive(event: { id: string; type: string; data: Row }) {
  const rows = db.tables.get("whop_events") ?? [];
  if (!rows.some((row) => row.event_id === event.id)) {
    rows.push({
      event_id: event.id,
      type: event.type,
      payload: { data: event.data },
      credited_at: null,
      processed_at: null,
    });
  }
  db.tables.set("whop_events", rows);
  const outcome = await applyWhopEvent({ id: event.id, type: event.type, data: event.data });
  if (!outcome.pending) {
    const row = rows.find((candidate) => candidate.event_id === event.id);
    if (row) row.processed_at = new Date().toISOString();
  }
  return outcome;
}

function capture(level: "log" | "warn" | "error") {
  vi.spyOn(console, level).mockImplementation((line: unknown) => {
    const row = JSON.parse(String(line)) as Row;
    db.logs.push({ level, event: String(row.event), row });
  });
}

beforeEach(() => {
  db.tables = new Map<string, Row[]>();
  db.logs = [];
  db.tables.set("profiles", [{ id: USER, email: EMAIL }]);
  vi.stubEnv("WHOP_PLAN_PRO", "plan_pro");
  vi.stubEnv("WHOP_PLAN_PACK", "plan_pack");
  vi.useFakeTimers();
  vi.setSystemTime(at(0));
  capture("log");
  capture("warn");
  capture("error");
});

const seed = (over: Row = {}) => {
  db.tables.set("credits", [
    { user_id: USER, plan: "free", balance: 0, period_end: null, cancelled_at: null, membership_id: null, ...over },
  ]);
};

describe("étape 2 — la période remboursée est révoquée", () => {
  it("1. Pro acheté puis remboursé le jour même : la période s'arrête maintenant, le compte sort de Pro", async () => {
    seed({ plan: "pro", period_end: iso(30), membership_id: "mem_1" });

    const outcome = await receive(refund("evt_refund", { amount: 12.99, payment: payment() }));

    expect(outcome.handled).toBe(true);
    expect(credits()).toMatchObject({ plan: "free", period_end: iso(0), cancelled_at: null });
    // Le mois payé est retiré, et pas un jour de plus : le plancher est maintenant.
    expect(new Date(String(credits().period_end)).getTime()).toBe(at(0).getTime());
  });

  it("2. période prolongée par un second abonnement, remboursement du premier : il reste exactement la durée du second", async () => {
    // Deux mois payés, deux mois d'accès (#090 bis) : un mois remboursé en laisse un.
    seed({ plan: "pro", period_end: iso(60), membership_id: "mem_1" });

    await receive(refund("evt_refund", { amount: 12.99, payment: payment() }));

    expect(credits()).toMatchObject({ plan: "pro", period_end: iso(30) });
  });

  it("3. le retrait dépasserait maintenant : la période s'arrête maintenant, jamais avant", async () => {
    seed({ plan: "pro", period_end: iso(10), membership_id: "mem_1" });

    await receive(refund("evt_refund", { amount: 12.99, payment: payment() }));

    expect(credits()).toMatchObject({ plan: "free", period_end: iso(0) });
    expect(new Date(String(credits().period_end)).getTime()).toBeGreaterThanOrEqual(at(0).getTime());
  });

  it("3 bis. un pack encore garni survit à la fin de l'abonnement remboursé", async () => {
    seed({ plan: "pro", period_end: iso(10), balance: 2 });

    await receive(refund("evt_refund", { amount: 12.99, payment: payment() }));

    // Les négociations achetées séparément ne sont pas payées par ce paiement.
    expect(credits()).toMatchObject({ plan: "pack", balance: 2, period_end: iso(0) });
  });
});

describe("étape 3 — remboursement partiel", () => {
  it("4. montant inférieur au total : aucune révocation, et c'est journalisé", async () => {
    seed({ plan: "pro", period_end: iso(30), membership_id: "mem_1" });

    const outcome = await receive(refund("evt_refund", { amount: 5, payment: payment() }));

    expect(outcome.handled).toBe(true);
    expect(credits()).toMatchObject({ plan: "pro", period_end: iso(30) });
    expect(logged("whop_remboursement_partiel")[0].row).toMatchObject({
      event_id: "evt_refund",
      montant: 5,
      total: 12.99,
    });
  });
});

describe("étape 2 — le pack remboursé", () => {
  it("5. solde inférieur aux négociations accordées : solde à zéro, jamais négatif", async () => {
    seed({ plan: "pack", balance: 1 });

    await receive(refund("evt_refund", { amount: 4.99, payment: payment({ plan: { id: "plan_pack" }, total: 4.99 }) }));

    expect(credits()).toMatchObject({ plan: "free", balance: 0 });
  });
});

describe("étape 4 — rattachement et idempotence", () => {
  it("6. le même refund.created rejoué : une seule révocation", async () => {
    seed({ plan: "pro", period_end: iso(60), membership_id: "mem_1" });

    await receive(refund("evt_refund", { amount: 12.99, payment: payment() }));
    const after = String(credits().period_end);
    const outcome = await receive(refund("evt_refund", { amount: 12.99, payment: payment() }));

    expect(outcome.handled).toBe(true);
    expect(credits().period_end).toBe(after);
    expect(logged("whop_remboursement_deja_applique")).toHaveLength(1);
  });

  it("7. aucun compte rattachable : l'événement n'est pas marqué traité, et c'est journalisé", async () => {
    seed({ plan: "pro", period_end: iso(30) });
    const inconnu = payment({ metadata: {}, user: { email: "inconnue@exemple.test" } });

    const outcome = await receive(refund("evt_refund", { amount: 12.99, payment: inconnu }));

    expect(outcome).toMatchObject({ handled: false, pending: true });
    expect(events()[0].processed_at).toBeNull();
    expect(logged("whop_remboursement_non_rattache")[0].row).toMatchObject({
      event_id: "evt_refund",
      email: "inconnue@exemple.test",
    });
    // Rien n'a bougé sur un compte qui n'est pas celui du paiement.
    expect(credits()).toMatchObject({ plan: "pro", period_end: iso(30) });
  });

  it("8. remboursement d'un paiement qui n'avait rien accordé : aucun changement", async () => {
    seed();
    const avant = { ...credits() };

    const outcome = await receive(refund("evt_refund", { amount: 12.99, payment: payment() }));

    expect(outcome.handled).toBe(true);
    expect(credits()).toEqual(avant);
    expect(logged("whop_remboursement_sans_effet")[0].row).toMatchObject({ event_id: "evt_refund", plan: "pro" });
  });

  it("9. paiement Pro remboursé avant son activation : le rattrapage n'ouvre plus le mois payé", async () => {
    seed();
    // Le paiement est reçu, l'activation est attendue (#092).
    await receive({ id: "evt_pay", type: "payment.succeeded", data: payment() });
    // Whop rembourse sans imbriquer le paiement : on le relit dans nos événements.
    await receive(refund("evt_refund", { amount: 12.99, payment: "pay_1" }));

    vi.setSystemTime(new Date(at(0).getTime() + 20 * 60_000));
    expect(await recoverProPaymentsWithoutActivation(new Date())).toBe(0);
    expect(credits()).toMatchObject({ plan: "free", period_end: null });
  });
});
