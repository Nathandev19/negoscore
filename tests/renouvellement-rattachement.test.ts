import { beforeEach, describe, expect, it, vi } from "vitest";

// Mission #114 — un renouvellement se rattache toujours, par identifiant.
//
// La #112 a supprimé l'attribution par email et posé deux chemins : les
// metadata du checkout, et l'abonnement que NOUS avons enregistré. Elle
// laissait un point ouvert : Whop recopie-t-il les metadata sur les
// payment.succeeded de renouvellement ? S'il ne le fait pas, un abonné en
// règle voyait son mois tomber en attente de rattachement, chaque mois.
//
// La documentation Whop tranche, sur les checkout configurations :
// « Payments and memberships created from a checkout session inherit its
// metadata. » L'ABONNEMENT porte donc le user_id, même si le paiement ne le
// porte pas. C'est le troisième chemin, et il est par identifiant.

type Row = Record<string, unknown>;

const db = vi.hoisted(() => ({
  tables: new Map<string, Row[]>(),
  credited: new Set<string>(),
  balance: 0,
  logs: [] as Array<{ event: string; row: Row }>,
  // Ce que l'API Whop répond quand on lui demande un abonnement.
  membership: "absent" as "absent" | "unavailable" | Record<string, unknown>,
  reads: [] as string[],
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
      if (value.startsWith("ilike.")) return String(actual).toLowerCase() === value.slice(6).toLowerCase();
      return true;
    });

vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/server")>();
  return {
    ...actual,
    selectRows: async (table: string, query: string) => (db.tables.get(table) ?? []).filter((row) => matches(row, query)),
    insertIfAbsent: async (table: string, row: Row) => {
      const rows = db.tables.get(table) ?? [];
      if (!rows.some((existing) => existing.event_id === row.event_id && existing.user_id === row.user_id)) rows.push({ ...row });
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
    adjustInteger: async (_t: string, _f: string, _c: string, delta: number) => {
      db.balance += delta;
      return db.balance;
    },
    rpc: async (_name: string, args: Record<string, unknown>) => {
      const eventId = String(args.p_event_id);
      if (db.credited.has(eventId)) return false;
      db.credited.add(eventId);
      db.balance += Number(args.p_amount);
      return true;
    },
  };
});

// L'API Whop, en trois états : abonnement lisible, absent, ou injoignable.
vi.mock("@/lib/whop/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/whop/api")>();
  return {
    ...actual,
    readMembership: async (id: string) => {
      db.reads.push(id);
      if (db.membership === "unavailable") return { kind: "unavailable", detail: "http_503" };
      if (db.membership === "absent") return { kind: "absent" };
      return { kind: "found", membership: { id, status: "active", cancel_at_period_end: false, renewal_period_end: null, metadata: db.membership } };
    },
  };
});

const { applyWhopEvent } = await import("@/lib/billing/whop-events");
const { membershipIdOf } = await import("@/lib/billing/whop-events");

const USER = "11111111-1111-4111-8111-111111111111";
const EMAIL = "nina@exemple.test";
const MEMBERSHIP = "mem_abonnement";

const pending = (eventId: string) => (db.tables.get("pending_payments") ?? []).find((row) => row.event_id === eventId);
const logged = (event: string) => db.logs.filter((entry) => entry.event === event);

// Un paiement de RENOUVELLEMENT, à la forme RÉELLE relevée en base : data.id
// est l'identifiant du PAIEMENT, l'abonnement est dans `membership`, qui est un
// objet, et `billing_reason` dit pourquoi Whop a encaissé.
const renewal = (id: string, data: Row = {}) => {
  const { membership_id: membershipId, ...rest } = data as { membership_id?: string };
  return {
    id,
    type: "payment.succeeded",
    data: {
      id: `pay_${id}`,
      plan: { id: "plan_pro" },
      total: 12.99,
      currency: "eur",
      billing_reason: "subscription_renewal",
      user: { email: "portefeuille@exemple.test" },
      ...(membershipId ? { membership: { id: membershipId, status: "completed", phone_number: null } } : {}),
      ...rest,
    },
  };
};

function capture(level: "log" | "warn" | "error") {
  vi.spyOn(console, level).mockImplementation((line: unknown) => {
    const row = JSON.parse(String(line)) as Row;
    db.logs.push({ event: String(row.event), row });
  });
}

beforeEach(() => {
  db.tables = new Map<string, Row[]>();
  db.credited = new Set<string>();
  db.balance = 0;
  db.logs = [];
  db.membership = "absent";
  db.reads = [];
  db.tables.set("profiles", [{ id: USER, email: EMAIL }]);
  db.tables.set("credits", [{ user_id: USER, plan: "pro", balance: 0, period_end: null, cancelled_at: null, membership_id: null }]);
  vi.stubEnv("WHOP_PLAN_PRO", "plan_pro");
  vi.stubEnv("WHOP_PLAN_PACK", "plan_pack");
  vi.stubEnv("WHOP_API_KEY", "cle-de-test");
  capture("log");
  capture("warn");
  capture("error");
});

describe("D1 — l'identifiant d'abonnement porté par une charge", () => {
  it("sur un événement d'abonnement, c'est data.id", () => {
    expect(membershipIdOf("membership.activated", { id: "mem_1" })).toBe("mem_1");
    expect(membershipIdOf("membership.deactivated", { id: "mem_2" })).toBe("mem_2");
  });

  // Forme réelle relevée en base sur cinq payment.succeeded : `membership` est
  // un OBJET, et son identifiant est dans `id`.
  it("sur un paiement, c'est data.membership.id — la forme observée — jamais data.id", () => {
    const reel = { id: "pay_1", membership: { id: "mem_YRj9pLI56IEhid", status: "completed", phone_number: null } };
    expect(membershipIdOf("payment.succeeded", reel)).toBe("mem_YRj9pLI56IEhid");
    expect(membershipIdOf("payment.succeeded", { id: "pay_1" })).toBeNull();
  });

  it("la forme observée passe AVANT les replis, même quand les deux existent", () => {
    const deux = { id: "pay_1", membership: { id: "mem_objet" }, membership_id: "mem_repli", subscription_id: "mem_autre" };
    expect(membershipIdOf("payment.succeeded", deux)).toBe("mem_objet");
  });

  it("les replis restent en place, pour une forme qu'on n'a pas encore vue", () => {
    expect(membershipIdOf("payment.succeeded", { id: "pay_1", membership: "mem_2" })).toBe("mem_2");
    expect(membershipIdOf("payment.succeeded", { id: "pay_1", membership_id: "mem_3" })).toBe("mem_3");
    expect(membershipIdOf("payment.succeeded", { id: "pay_1", subscription: { id: "mem_4" } })).toBe("mem_4");
    expect(membershipIdOf("payment.succeeded", { id: "pay_1", subscription_id: "mem_5" })).toBe("mem_5");
  });

  it("un objet membership SANS id ne rend rien d'absurde", () => {
    // La forme réelle d'un paiement qui n'est rattaché à aucun abonnement.
    expect(membershipIdOf("payment.succeeded", { id: "pay_1", membership: { status: "completed", phone_number: null } })).toBeNull();
    expect(membershipIdOf("payment.succeeded", { id: "pay_1", membership: {} })).toBeNull();
    expect(membershipIdOf("payment.succeeded", { id: "pay_1", membership: null })).toBeNull();
    expect(membershipIdOf("payment.succeeded", { id: "pay_1", membership: { id: null } })).toBeNull();
    expect(membershipIdOf("payment.succeeded", { id: "pay_1", membership: { id: "" } })).toBeNull();
    expect(membershipIdOf("payment.succeeded", { id: "pay_1", membership: { id: 42 } })).toBeNull();
    // Et le repli ne va pas chercher l'identifiant du paiement à la place.
    expect(membershipIdOf("payment.succeeded", { id: "pay_1", membership: {} })).not.toBe("pay_1");
  });

  it("une valeur hors gabarit n'entre jamais dans un filtre", () => {
    expect(membershipIdOf("payment.succeeded", { membership: { id: "mem,1" } })).toBeNull();
    expect(membershipIdOf("payment.succeeded", { membership: { id: "mem 1" } })).toBeNull();
    expect(membershipIdOf("payment.succeeded", { membership_id: "mem,1" })).toBeNull();
  });
});

describe("A1 — les trois chemins, dans l'ordre", () => {
  it("chemin 1 — renouvellement avec metadata : inchangé, aucune lecture de l'API", async () => {
    const outcome = await applyWhopEvent(renewal("evt_1", { metadata: { user_id: USER } }));
    expect(outcome.handled).toBe(true);
    expect(outcome.userId).toBe(USER);
    expect(logged("whop_rattachement")[0].row.how).toBe("metadata");
    expect(db.reads).toEqual([]);
  });

  it("chemin 2 — sans metadata mais abonnement connu de nous : aucune lecture de l'API", async () => {
    (db.tables.get("credits") ?? [])[0].membership_id = MEMBERSHIP;
    const outcome = await applyWhopEvent(renewal("evt_2", { membership_id: MEMBERSHIP }));
    expect(outcome.handled).toBe(true);
    expect(outcome.userId).toBe(USER);
    expect(logged("whop_rattachement")[0].row.how).toBe("membership");
    expect(db.reads).toEqual([]);
  });

  it("chemin 3 — abonnement inconnu de nous, lu chez Whop, portant un user_id valide", async () => {
    db.membership = { user_id: USER, plan: "pro" };
    const outcome = await applyWhopEvent(renewal("evt_3", { membership_id: MEMBERSHIP }));
    expect(outcome.handled).toBe(true);
    expect(outcome.userId).toBe(USER);
    expect(logged("whop_rattachement")[0].row.how).toBe("abonnement_whop");
    expect(db.reads).toEqual([MEMBERSHIP]);
    expect(pending("evt_3")).toMatchObject({ reason: "activation_attendue", user_id: USER });
  });

  it("l'ordre est strict : les metadata gagnent sur l'abonnement, même si les deux existent", async () => {
    const AUTRE = "22222222-2222-4222-8222-222222222222";
    db.tables.set("profiles", [
      { id: USER, email: EMAIL },
      { id: AUTRE, email: "voisin@exemple.test" },
    ]);
    db.membership = { user_id: AUTRE };
    const outcome = await applyWhopEvent(renewal("evt_ordre", { metadata: { user_id: USER }, membership_id: MEMBERSHIP }));
    expect(outcome.userId).toBe(USER);
    expect(db.reads).toEqual([]);
  });
});

describe("A4 et A5 — ce qui ne se devine pas", () => {
  it("l'API Whop est indisponible : attente, événement NON marqué traité, et la raison est dite", async () => {
    db.membership = "unavailable";
    const outcome = await applyWhopEvent(renewal("evt_ko", { membership_id: MEMBERSHIP }));
    expect(outcome.handled).toBe(false);
    expect(outcome.pending).toBe(true);
    expect(db.balance).toBe(0);
    expect(db.credited.size).toBe(0);
    expect(logged("whop_paiement_non_rattache")[0].row.raison).toBe("abonnement_illisible");
    expect(logged("whop_abonnement_illisible")[0].row.detail).toBe("http_503");
    expect(pending("evt_ko")).toMatchObject({ reason: "compte_introuvable", user_id: null });
  });

  it("l'abonnement ne porte aucun user_id : attente", async () => {
    db.membership = { plan: "pro" };
    const outcome = await applyWhopEvent(renewal("evt_sans", { membership_id: MEMBERSHIP }));
    expect(outcome.pending).toBe(true);
    expect(db.balance).toBe(0);
    expect(logged("whop_paiement_non_rattache")[0].row.raison).toBe("aucun_identifiant");
  });

  it("le user_id de l'abonnement ne correspond à aucun profil : attente, aucun compte créé", async () => {
    db.membership = { user_id: "33333333-3333-4333-8333-333333333333" };
    const avant = (db.tables.get("profiles") ?? []).length;
    const outcome = await applyWhopEvent(renewal("evt_fantome", { membership_id: MEMBERSHIP }));
    expect(outcome.pending).toBe(true);
    expect((db.tables.get("profiles") ?? []).length).toBe(avant);
    expect(db.balance).toBe(0);
  });

  it("A3 — le troisième chemin n'écrit rien d'autre que le rattachement", async () => {
    db.membership = { user_id: USER };
    const avant = (db.tables.get("profiles") ?? []).length;
    await applyWhopEvent(renewal("evt_ecriture", { membership_id: MEMBERSHIP }));
    expect((db.tables.get("profiles") ?? []).length).toBe(avant);
  });
});

describe("A6 — la trace dit par quel chemin, et pour quelle raison de facturation", () => {
  it("rattaché : le chemin ET billing_reason sont dans la même ligne", async () => {
    await applyWhopEvent(renewal("evt_trace", { metadata: { user_id: USER } }));
    expect(logged("whop_rattachement")[0].row).toMatchObject({
      event_id: "evt_trace",
      type: "payment.succeeded",
      billing_reason: "subscription_renewal",
      how: "metadata",
    });
  });

  it("les trois chemins portent tous billing_reason", async () => {
    await applyWhopEvent(renewal("evt_t1", { metadata: { user_id: USER } }));
    (db.tables.get("credits") ?? [])[0].membership_id = MEMBERSHIP;
    await applyWhopEvent(renewal("evt_t2", { membership_id: MEMBERSHIP }));
    (db.tables.get("credits") ?? [])[0].membership_id = null;
    db.membership = { user_id: USER };
    await applyWhopEvent(renewal("evt_t3", { membership_id: MEMBERSHIP }));
    const traces = logged("whop_rattachement");
    expect(traces.map((entry) => entry.row.how)).toEqual(["metadata", "membership", "abonnement_whop"]);
    for (const trace of traces) expect(trace.row.billing_reason).toBe("subscription_renewal");
  });

  it("non rattaché : billing_reason est là aussi, avec la raison de l'échec", async () => {
    db.membership = "unavailable";
    await applyWhopEvent(renewal("evt_ko_trace", { membership_id: MEMBERSHIP }));
    expect(logged("whop_paiement_non_rattache")[0].row).toMatchObject({
      billing_reason: "subscription_renewal",
      raison: "abonnement_illisible",
    });
  });

  it("une charge sans billing_reason ne casse pas la trace", async () => {
    await applyWhopEvent({
      id: "evt_sans_raison",
      type: "payment.succeeded",
      data: { id: "pay_x", plan: { id: "plan_pack" }, total: 4.99, currency: "eur", metadata: { user_id: USER } },
    });
    expect(logged("whop_rattachement")[0].row.billing_reason).toBeNull();
  });

  it("les valeurs réelles relevées en base passent telles quelles", async () => {
    for (const [index, reason] of ["one_time", "subscription_create"].entries()) {
      db.logs = [];
      await applyWhopEvent({
        id: `evt_reason_${index}`,
        type: "payment.succeeded",
        data: { id: "pay_y", plan: { id: "plan_pack" }, total: 4.99, currency: "eur", billing_reason: reason, metadata: { user_id: USER } },
      });
      expect(logged("whop_rattachement")[0].row.billing_reason, reason).toBe(reason);
    }
  });
});

describe("l'email ne rattache toujours rien", () => {
  it("une adresse correcte et connue, sans aucun identifiant : attente, JAMAIS de crédit", async () => {
    const outcome = await applyWhopEvent({
      id: "evt_email",
      type: "payment.succeeded",
      data: { id: "pay_email", plan: { id: "plan_pack" }, total: 4.99, currency: "eur", user: { email: EMAIL } },
    });
    expect(outcome.handled).toBe(false);
    expect(outcome.pending).toBe(true);
    expect(db.balance).toBe(0);
    expect(db.credited.size).toBe(0);
    // L'adresse est gardée pour le rattachement à la main, jamais pour décider.
    expect(pending("evt_email")).toMatchObject({ user_id: null, email: EMAIL });
  });

  it("une adresse connue ET un abonnement lisible sans user_id : toujours rien", async () => {
    db.membership = { plan: "pro" };
    const outcome = await applyWhopEvent(renewal("evt_email2", { membership_id: MEMBERSHIP, user: { email: EMAIL } }));
    expect(outcome.pending).toBe(true);
    expect(db.balance).toBe(0);
  });
});
