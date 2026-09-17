import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mission #060 partie B — un paiement encaissé doit toujours finir par
// créditer. Base en mémoire, aucun réseau : la route réelle du webhook et le
// rattrapage quotidien sont appelés tels quels.

type EventRow = {
  event_id: string;
  type: string;
  payload: Record<string, unknown>;
  processed_at: string | null;
  credited_at: string | null;
  received_at: string;
};

const db = vi.hoisted(() => ({
  events: [] as EventRow[],
  credits: new Map<string, { plan: string; balance: number; period_end: string | null; cancelled_at: string | null }>(),
  profiles: [{ id: "11111111-1111-4111-8111-111111111111", email: "nina@exemple.fr" }],
  // Migration 019 appliquée ou non.
  creditFunction: true,
  // Faire échouer le traitement, pour simuler une coupure en plein milieu.
  failApply: false,
}));

vi.mock("@/lib/analytics/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/analytics/server")>()),
  captureServerEvent: async () => undefined,
}));
vi.mock("@/lib/email/send", () => ({ sendEmail: async () => ({ sent: true, attempts: 1 }) }));

vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/server")>();
  const eq = (query: string, key: string) => {
    const match = query.match(new RegExp(`(?:^|&)${key}=eq\\.([^&]+)`));
    return match ? decodeURIComponent(match[1]) : undefined;
  };
  return {
    ...actual,
    selectRows: async (table: string, query: string) => {
      if (table === "whop_events") {
        const id = eq(query, "event_id");
        if (id) return db.events.filter((e) => e.event_id === id);
        if (/processed_at=is\.null/.test(query)) return db.events.filter((e) => e.processed_at === null);
        return db.events;
      }
      if (table === "profiles") {
        const id = eq(query, "id");
        const email = query.match(/email=ilike\.([^&]+)/)?.[1];
        return db.profiles.filter((p) => (id ? p.id === id : true) && (email ? p.email === decodeURIComponent(email) : true));
      }
      if (table === "credits") {
        const owner = eq(query, "user_id") ?? "";
        const row = db.credits.get(owner);
        return row ? [{ user_id: owner, ...row }] : [];
      }
      return [];
    },
    insertRow: async (table: string, row: Record<string, unknown>) => {
      if (table === "whop_events") {
        if (db.events.some((e) => e.event_id === row.event_id)) {
          throw new actual.SupabaseRequestError("doublon", 409, "23505");
        }
        db.events.push({
          event_id: String(row.event_id),
          type: String(row.type),
          payload: row.payload as Record<string, unknown>,
          processed_at: null,
          credited_at: null,
          received_at: new Date().toISOString(),
        });
      }
      return { id: "1" };
    },
    insertIfAbsent: async (table: string, row: Record<string, unknown>) => {
      if (table === "credits" && !db.credits.has(String(row.user_id))) {
        db.credits.set(String(row.user_id), { plan: "free", balance: 0, period_end: null, cancelled_at: null });
      }
    },
    updateRows: async (table: string, filter: string, patch: Record<string, unknown>) => {
      if (table === "whop_events") {
        const id = eq(filter, "event_id");
        for (const row of db.events.filter((e) => e.event_id === id)) {
          if (typeof patch.processed_at === "string") row.processed_at = patch.processed_at;
        }
      }
      if (table === "credits") {
        const owner = eq(filter, "user_id") ?? "";
        const row = db.credits.get(owner);
        if (row && typeof patch.plan === "string") row.plan = patch.plan;
      }
      return [];
    },
    adjustInteger: async (table: string, filter: string, _column: string, delta: number) => {
      const owner = filter.replace("user_id=eq.", "");
      const row = db.credits.get(owner);
      if (!row) return null;
      row.balance += delta;
      return row.balance;
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn !== "whop_event_credit") return null;
      if (!db.creditFunction) throw new actual.SupabaseRequestError("fonction absente", 404, "PGRST202");
      // Marque et crédit dans la même transaction, comme la fonction SQL.
      const row = db.events.find((e) => e.event_id === String(args.p_event_id));
      if (!row || row.credited_at !== null) return false;
      row.credited_at = new Date().toISOString();
      const credits = db.credits.get(String(args.p_user_id));
      if (credits) credits.balance += Number(args.p_amount);
      return true;
    },
  };
});

vi.mock("@/lib/billing/whop-events", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/billing/whop-events")>();
  return {
    ...actual,
    applyWhopEvent: async (event: Parameters<typeof actual.applyWhopEvent>[0]) => {
      if (db.failApply) throw new Error("traitement interrompu");
      return actual.applyWhopEvent(event);
    },
  };
});

const SECRET = "secret-de-test";
vi.stubEnv("WHOP_WEBHOOK_SECRET", SECRET);
vi.stubEnv("WHOP_PLAN_PACK", "plan_pack");
vi.stubEnv("WHOP_PLAN_PRO", "plan_pro");

const { POST } = await import("@/app/api/whop/webhook/route");
const { recoverPendingWhopEvents } = await import("@/lib/billing/webhook-recovery");
const { PACK_ANALYSES } = await import("@/lib/billing/plans");

const USER = "11111111-1111-4111-8111-111111111111";

function payment(eventId: string) {
  return {
    id: eventId,
    type: "payment.succeeded",
    data: { plan: { id: "plan_pack" }, total: 4.99, currency: "eur", metadata: { user_id: USER } },
  };
}

// Signature Whop : le corps brut, horodaté, signé en HMAC-SHA256.
async function send(event: Record<string, unknown>): Promise<Response> {
  const body = JSON.stringify(event);
  const id = String(event.id);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac("sha256", SECRET).update(`${id}.${timestamp}.${body}`).digest("base64");
  return POST(
    new Request("https://www.negoscore.fr/api/whop/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "webhook-id": id,
        "webhook-timestamp": timestamp,
        "webhook-signature": `v1,${signature}`,
      },
      body,
    }),
  );
}

function balance(): number {
  return db.credits.get(USER)?.balance ?? 0;
}

beforeEach(() => {
  db.events = [];
  db.credits.clear();
  db.credits.set(USER, { plan: "free", balance: 0, period_end: null, cancelled_at: null });
  db.creditFunction = true;
  db.failApply = false;
});

describe("webhook de paiement", () => {
  it("un paiement crédite une fois", async () => {
    const response = await send(payment("evt_1"));
    expect(response.status).toBe(200);
    expect(balance()).toBe(PACK_ANALYSES);
    expect(db.events[0].processed_at).not.toBeNull();
  });

  it("un événement déjà traité et rejoué est ignoré : aucun crédit en double", async () => {
    await send(payment("evt_1"));
    const replay = await send(payment("evt_1"));
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ duplicate: true });
    expect(balance()).toBe(PACK_ANALYSES);
  });

  it("traitement échoué : code 500 pour que Whop rejoue, et rien n'est marqué traité", async () => {
    db.failApply = true;
    const response = await send(payment("evt_1"));
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ retry: true });
    expect(db.events[0].processed_at).toBeNull();
    expect(balance()).toBe(0);
  });

  it("événement enregistré mais non traité, puis rejoué par Whop : il est traité", async () => {
    db.failApply = true;
    await send(payment("evt_1"));
    expect(db.events).toHaveLength(1);
    expect(balance()).toBe(0);

    db.failApply = false;
    const retry = await send(payment("evt_1"));
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ received: true, handled: true });
    expect(balance()).toBe(PACK_ANALYSES);
    expect(db.events[0].processed_at).not.toBeNull();
  });
});

describe("rattrapage quotidien", () => {
  it("reprend un événement enregistré sans traitement et le crédite une seule fois", async () => {
    db.failApply = true;
    await send(payment("evt_1"));
    db.failApply = false;

    const first = await recoverPendingWhopEvents();
    expect(first).toMatchObject({ repris: 1, traites: 1, echecs: 0 });
    expect(balance()).toBe(PACK_ANALYSES);

    // Deuxième passage : plus rien à reprendre, et surtout aucun crédit de plus.
    const second = await recoverPendingWhopEvents();
    expect(second).toMatchObject({ repris: 0, traites: 0 });
    expect(balance()).toBe(PACK_ANALYSES);
  });

  it("deux passages de suite sur un événement non marqué : le crédit reste unique", async () => {
    // Cas limite : le crédit a été accordé mais le traitement s'est interrompu
    // avant d'écrire processed_at. La fonction SQL a déjà marqué credited_at.
    db.events.push({
      event_id: "evt_2",
      type: "payment.succeeded",
      payload: payment("evt_2"),
      processed_at: null,
      credited_at: new Date().toISOString(),
      received_at: new Date().toISOString(),
    });
    db.credits.set(USER, { plan: "pack", balance: PACK_ANALYSES, period_end: null, cancelled_at: null });

    await recoverPendingWhopEvents();
    await recoverPendingWhopEvents();
    expect(balance()).toBe(PACK_ANALYSES);
  });

  it("un événement déjà traité n'est jamais repris", async () => {
    await send(payment("evt_1"));
    const report = await recoverPendingWhopEvents();
    expect(report.repris).toBe(0);
    expect(balance()).toBe(PACK_ANALYSES);
  });

  it("sans la fonction SQL, le crédit passe encore, et une seule fois par passage", async () => {
    db.creditFunction = false;
    await send(payment("evt_1"));
    expect(balance()).toBe(PACK_ANALYSES);
    const replay = await send(payment("evt_1"));
    expect(await replay.json()).toMatchObject({ duplicate: true });
    expect(balance()).toBe(PACK_ANALYSES);
  });
});
