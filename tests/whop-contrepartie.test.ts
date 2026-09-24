import { beforeEach, describe, expect, it, vi } from "vitest";

// Mission #092 — aucun paiement encaissé ne reste sans contrepartie.
//
//   A. paiement Pro jamais suivi d'une activation : le rattrapage ouvre le mois
//      payé, et l'activation qui arrive après coup n'ajoute rien ;
//   B. paiement sans compte correspondant : gardé en attente, réessayé pendant
//      30 jours, puis abandonné en le disant.
//
// La base est simulée avec ses contraintes : clé primaire sur event_id, et
// filtres de mise à jour appliqués comme PostgREST le ferait — c'est ce qui
// garantit qu'un crédit n'est accordé qu'une fois, quel que soit le chemin.

type Row = Record<string, unknown>;

const db = vi.hoisted(() => ({
  tables: new Map<string, Row[]>(),
  credited: new Set<string>(),
  balance: 0,
  logs: [] as Array<{ level: "log" | "warn" | "error"; event: string; row: Row }>,
}));

// Filtres PostgREST utilisés par le code : eq, is.null, gte, lte.
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
      if (value.startsWith("gte.")) return String(actual) >= value.slice(4);
      if (value.startsWith("lte.")) return String(actual) <= value.slice(4);
      return true;
    });

vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/server")>();
  return {
    ...actual,
    selectRows: async (table: string, query: string) => (db.tables.get(table) ?? []).filter((row) => matches(row, query)),
    insertIfAbsent: async (table: string, row: Row) => {
      const rows = db.tables.get(table) ?? [];
      // Clé primaire event_id : une seule ligne, même si on réessaie.
      if (!rows.some((existing) => existing.event_id === row.event_id)) rows.push({ ...row });
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
    // whop_event_credit : marque l'événement ET crédite dans la même
    // transaction. Deuxième appel sur le même event_id : false, rien ajouté.
    rpc: async (_name: string, args: Record<string, unknown>) => {
      const eventId = String(args.p_event_id);
      if (db.credited.has(eventId)) return false;
      db.credited.add(eventId);
      db.balance += Number(args.p_amount);
      return true;
    },
  };
});

const { applyWhopEvent } = await import("@/lib/billing/whop-events");
const { expireUnattachedPayments, recoverProPaymentsWithoutActivation, settleUnpaidCounterparts } = await import(
  "@/lib/billing/webhook-recovery"
);

const USER = "11111111-1111-4111-8111-111111111111";
const EMAIL = "nina@exemple.test";
const PAID_AT = "2026-09-22T10:00:00.000Z";
const at = (minutes: number) => new Date(Date.parse(PAID_AT) + minutes * 60_000);
const DAY = 24 * 60;

const pending = (eventId: string) => (db.tables.get("pending_payments") ?? []).find((row) => row.event_id === eventId);
const credits = () => (db.tables.get("credits") ?? [])[0];
const logged = (event: string) => db.logs.filter((entry) => entry.event === event);

const proPayment = (id: string, over: Row = {}) => ({
  id,
  type: "payment.succeeded",
  data: { plan: { id: "plan_pro" }, metadata: { user_id: USER }, total: 12.99, currency: "eur", ...over },
});
const activation = (id: string, membershipId: string, renewalEnd: string) => ({
  id,
  type: "membership.activated",
  data: { id: membershipId, plan: { id: "plan_pro" }, metadata: { user_id: USER }, renewal_period_end: renewalEnd },
});

function capture(level: "log" | "warn" | "error") {
  vi.spyOn(console, level).mockImplementation((line: unknown) => {
    const row = JSON.parse(String(line)) as Row;
    db.logs.push({ level, event: String(row.event), row });
  });
}

beforeEach(() => {
  db.tables = new Map<string, Row[]>();
  db.credited = new Set<string>();
  db.balance = 0;
  db.logs = [];
  db.tables.set("profiles", [{ id: USER, email: EMAIL }]);
  db.tables.set("credits", [{ user_id: USER, plan: "free", balance: 0, period_end: null, cancelled_at: null, membership_id: null }]);
  vi.stubEnv("WHOP_PLAN_PRO", "plan_pro");
  vi.stubEnv("WHOP_PLAN_PACK", "plan_pack");
  vi.useFakeTimers();
  vi.setSystemTime(at(0));
  capture("log");
  capture("warn");
  capture("error");
});

describe("A — paiement Pro resté sans activation", () => {
  it("1. vingt minutes plus tard : une période d'un mois est ouverte, et c'est journalisé", async () => {
    await applyWhopEvent(proPayment("evt_pay"));
    expect(pending("evt_pay")).toMatchObject({ reason: "activation_attendue", user_id: USER });
    expect(pending("evt_pay")?.resolved_at).toBeUndefined();

    const ouverts = await recoverProPaymentsWithoutActivation(at(20));
    expect(ouverts).toBe(1);
    const expected = new Date(at(20).getTime() + 30 * 24 * 3600 * 1000).toISOString();
    expect(credits()).toMatchObject({ plan: "pro", period_end: expected });
    expect(pending("evt_pay")).toMatchObject({ resolution: "rattrape" });
    expect(logged("whop_pro_active_sans_activation")[0].row).toMatchObject({
      event_id: "evt_pay",
      user_id: USER,
      period_end: expected,
    });
    // L'achat est enregistré : la page « Merci » peut le confirmer.
    expect((db.tables.get("purchases") ?? [])[0]).toMatchObject({ event_id: "evt_pay", plan: "pro", period_end: expected });
  });

  it("2. l'activation arrive après le rattrapage : aucune seconde période", async () => {
    await applyWhopEvent(proPayment("evt_pay"));
    await recoverProPaymentsWithoutActivation(at(20));
    const after = String(credits().period_end);

    vi.setSystemTime(at(25));
    const outcome = await applyWhopEvent(activation("evt_mem", "mem_1", new Date(at(25).getTime() + 30 * 24 * 3600 * 1000).toISOString()));
    expect(outcome.handled).toBe(true);
    expect(outcome.reason).toContain("déjà ouvert par le rattrapage");
    expect(credits().period_end).toBe(after);
    // L'abonnement est mémorisé pour les renouvellements suivants.
    expect(credits().membership_id).toBe("mem_1");
    expect(pending("evt_pay")).toMatchObject({ activation_event_id: "evt_mem" });
    // Un seul achat : la page « Merci » ne verra pas un double paiement.
    expect(db.tables.get("purchases") ?? []).toHaveLength(1);
  });

  it("3. activation normale dans les quinze minutes : aucun rattrapage", async () => {
    await applyWhopEvent(proPayment("evt_pay"));
    vi.setSystemTime(at(5));
    const renewalEnd = new Date(at(5).getTime() + 30 * 24 * 3600 * 1000).toISOString();
    await applyWhopEvent(activation("evt_mem", "mem_1", renewalEnd));
    expect(credits().period_end).toBe(renewalEnd);
    expect(pending("evt_pay")).toMatchObject({ resolution: "active" });

    const ouverts = await recoverProPaymentsWithoutActivation(at(20));
    expect(ouverts).toBe(0);
    expect(credits().period_end).toBe(renewalEnd);
    expect(logged("whop_pro_active_sans_activation")).toHaveLength(0);
  });

  it("4. rattrapage alors qu'une période court déjà : elle est prolongée, jamais écrasée", async () => {
    // Abonnement en cours jusqu'au 2 octobre, dont on ne connaît pas
    // l'identifiant (activé avant la migration 026). Un mois est payé, aucune
    // activation ne suit : ce mois s'AJOUTE, il ne remplace pas le reste dû.
    const running = new Date(at(0).getTime() + 10 * 24 * 3600 * 1000).toISOString();
    db.tables.set("credits", [{ user_id: USER, plan: "pro", balance: 0, period_end: running, cancelled_at: null, membership_id: null }]);
    await applyWhopEvent(proPayment("evt_pay"));

    expect(await recoverProPaymentsWithoutActivation(at(20))).toBe(1);
    expect(new Date(String(credits().period_end)).getTime()).toBe(Date.parse(running) + 30 * 24 * 3600 * 1000);
    expect(new Date(String(credits().period_end)).getTime()).toBeGreaterThan(Date.parse(running));
  });

  it("4 bis. renouvellement d'un abonnement connu et actif : rien n'est ouvert en plus", async () => {
    // Le paiement mensuel d'un abonnement déjà actif et identifié n'attend
    // aucune activation : la ligne naît réglée, le rattrapage n'y touche pas.
    const running = new Date(at(0).getTime() + 10 * 24 * 3600 * 1000).toISOString();
    db.tables.set("credits", [{ user_id: USER, plan: "pro", balance: 0, period_end: running, cancelled_at: null, membership_id: "mem_1" }]);
    await applyWhopEvent(proPayment("evt_pay"));
    expect(pending("evt_pay")).toMatchObject({ resolution: "active" });
    expect(await recoverProPaymentsWithoutActivation(at(20))).toBe(0);
    expect(credits().period_end).toBe(running);
  });
});

describe("B — paiement non rattachable à un compte", () => {
  const orphan = (id: string, plan: "pack" | "pro" = "pack") => ({
    id,
    type: "payment.succeeded",
    data: { plan: { id: plan === "pack" ? "plan_pack" : "plan_pro" }, user: { email: "inconnue@exemple.test" }, total: 4.99, currency: "eur" },
  });

  it("5. aucun compte correspondant : pas marqué traité, enregistré en attente, et journalisé", async () => {
    const outcome = await applyWhopEvent(orphan("evt_orphelin"));
    expect(outcome.handled).toBe(false);
    expect(outcome.pending).toBe(true);
    expect(pending("evt_orphelin")).toMatchObject({
      reason: "compte_introuvable",
      email: "inconnue@exemple.test",
      plan: "pack",
      amount: 4.99,
      user_id: null,
    });
    expect(logged("whop_paiement_non_rattache")[0].row).toMatchObject({
      event_id: "evt_orphelin",
      email: "inconnue@exemple.test",
      plan: "pack",
    });
    expect(db.balance).toBe(0);
  });

  // Mission #112 — CE COMPORTEMENT A CHANGÉ, volontairement.
  //
  // Avant : un compte créé plus tard avec la même adresse que celle du paiement
  // était crédité par le rattrapage. C'était une attribution PAR EMAIL, et
  // l'adresse de paiement n'est pas l'adresse du compte — avec Apple Pay, c'est
  // celle du portefeuille. Le crédit pouvait donc tomber sur le compte de
  // quelqu'un d'autre, sans que personne le voie passer.
  //
  // Désormais : sans identifiant de compte, rien n'est crédité, jamais. Le
  // paiement reste en attente, visible dans /admin, et se rattache à la main.
  // Ce cas ne peut plus naître du produit : un paiement n'ouvre plus quand la
  // session ne porte pas l'identifiant (app/api/checkout/route.ts).
  it("6. le compte est créé le lendemain avec le même email : TOUJOURS rien de crédité", async () => {
    await applyWhopEvent(orphan("evt_orphelin"));
    expect(db.balance).toBe(0);

    db.tables.set("profiles", [{ id: USER, email: "inconnue@exemple.test" }]);
    vi.setSystemTime(at(DAY));
    const outcome = await applyWhopEvent(orphan("evt_orphelin"));
    expect(outcome.handled).toBe(false);
    expect(outcome.pending).toBe(true);
    expect(db.balance).toBe(0);
    expect(db.credited.has("evt_orphelin")).toBe(false);
  });

  it("7. trente et un jours sans rattachement : abandonné, et dit", async () => {
    await applyWhopEvent(orphan("evt_orphelin"));
    expect(await expireUnattachedPayments(at(29 * DAY))).toBe(0);

    const abandons = await expireUnattachedPayments(at(31 * DAY));
    expect(abandons).toBe(1);
    expect(pending("evt_orphelin")).toMatchObject({ resolution: "abandonne" });
    expect(logged("whop_paiement_non_rattache_expire")[0].row).toMatchObject({
      event_id: "evt_orphelin",
      email: "inconnue@exemple.test",
      plan: "pack",
    });
    // Une seconde passe ne le compte pas une deuxième fois.
    expect(await expireUnattachedPayments(at(32 * DAY))).toBe(0);
  });
});

describe("RÈGLE COMMUNE — un crédit par event_id, garanti par la base", () => {
  it("8. le même paiement passant par deux chemins de rattrapage : une seule contrepartie", async () => {
    // Pro : deux passes simultanées ne peuvent pas ouvrir deux périodes.
    await applyWhopEvent(proPayment("evt_pay"));
    const [first, second] = await Promise.all([
      recoverProPaymentsWithoutActivation(at(20)),
      recoverProPaymentsWithoutActivation(at(20)),
    ]);
    expect(first + second).toBe(1);
    expect(db.tables.get("purchases") ?? []).toHaveLength(1);

    // Pack : le même événement rejoué par deux chemins ne crédite qu'une fois.
    const pack = {
      id: "evt_pack",
      type: "payment.succeeded",
      data: { plan: { id: "plan_pack" }, metadata: { user_id: USER }, total: 4.99, currency: "eur" },
    };
    await applyWhopEvent(pack);
    await applyWhopEvent(pack);
    expect(db.balance).toBe(3);
  });

  it("les deux passes tournent ensemble dans la purge quotidienne", async () => {
    await applyWhopEvent(proPayment("evt_pay"));
    const report = await settleUnpaidCounterparts(at(20));
    expect(report).toEqual({ pro_ouverts: 1, abandons: 0 });
  });
});

describe("B — le webhook lui-même", () => {
  it("5 bis. paiement orphelin : 200 à Whop, mais l'événement n'est PAS marqué traité", async () => {
    vi.stubEnv("WHOP_WEBHOOK_SECRET", "ws_secret_de_test");
    const { POST } = await import("@/app/api/whop/webhook/route");
    const { signWebhook } = await import("@/lib/whop/webhook");

    const send = async (id: string, data: Row) => {
      const body = JSON.stringify({ id, type: "payment.succeeded", data });
      const timestamp = String(Math.floor(at(0).getTime() / 1000));
      return POST(
        new Request("http://localhost:3000/api/whop/webhook", {
          method: "POST",
          headers: {
            "webhook-id": id,
            "webhook-timestamp": timestamp,
            "webhook-signature": signWebhook(body, id, timestamp, "ws_secret_de_test"),
          },
          body,
        }),
      );
    };

    const orphan = await send("evt_orphelin", { plan: { id: "plan_pack" }, user: { email: "inconnue@exemple.test" }, total: 4.99 });
    // Whop n'a rien à rejouer : c'est notre base qui manque d'un compte.
    expect(orphan.status).toBe(200);
    const stored = (db.tables.get("whop_events") ?? []).find((row) => row.event_id === "evt_orphelin");
    expect(stored?.processed_at).toBeUndefined();
    expect(pending("evt_orphelin")).toMatchObject({ reason: "compte_introuvable" });

    // Un paiement rattaché, lui, est bien marqué traité.
    const known = await send("evt_pack", { plan: { id: "plan_pack" }, metadata: { user_id: USER }, total: 4.99 });
    expect(known.status).toBe(200);
    expect((db.tables.get("whop_events") ?? []).find((row) => row.event_id === "evt_pack")?.processed_at).toEqual(expect.any(String));
  });

  it("6 bis. le rattrapage laisse l'événement à reprendre tant que le compte manque", async () => {
    db.tables.set("whop_events", [
      {
        event_id: "evt_orphelin",
        type: "payment.succeeded",
        payload: { id: "evt_orphelin", type: "payment.succeeded", data: { plan: { id: "plan_pack" }, user: { email: "inconnue@exemple.test" }, total: 4.99 } },
        processed_at: null,
        received_at: PAID_AT,
      },
    ]);
    const { recoverPendingWhopEvents } = await import("@/lib/billing/webhook-recovery");
    const report = await recoverPendingWhopEvents(at(DAY));
    expect(report.en_attente).toBe(1);
    expect(report.traites).toBe(0);
    expect((db.tables.get("whop_events") ?? [])[0].processed_at).toBeNull();
    expect(db.balance).toBe(0);
  });
});

// ─── Mission #112 — attribution par identifiant, jamais par email ────────────

describe("#112 — qui est crédité, et sur quelle preuve", () => {
  const AUTRE = "22222222-2222-4222-8222-222222222222";
  const pack = (id: string, data: Row) => ({ id, type: "payment.succeeded", data: { plan: { id: "plan_pack" }, total: 4.99, currency: "eur", ...data } });

  it("l'adresse de paiement diffère de celle du compte : c'est l'identifiant qui décide", async () => {
    // Le cas réel du 24/09 : compte jolareactsrtm@…, paiement Apple Pay sous
    // nathansuprm@…. L'adresse de l'acheteur n'est celle d'aucun compte connu.
    const outcome = await applyWhopEvent(
      pack("evt_applepay", { metadata: { user_id: USER }, user: { email: "portefeuille@exemple.test" } }),
    );
    expect(outcome.handled).toBe(true);
    expect(outcome.userId).toBe(USER);
    expect(outcome.reason).toContain("metadata");
    expect(db.balance).toBe(3);
  });

  it("l'adresse de paiement est celle d'un AUTRE compte : l'autre compte n'est pas crédité", async () => {
    db.tables.set("profiles", [
      { id: USER, email: EMAIL },
      { id: AUTRE, email: "voisin@exemple.test" },
    ]);
    const outcome = await applyWhopEvent(
      pack("evt_croise", { metadata: { user_id: USER }, user: { email: "voisin@exemple.test" } }),
    );
    expect(outcome.userId).toBe(USER);
    expect(outcome.userId).not.toBe(AUTRE);
    expect(db.balance).toBe(3);
  });

  it("aucun identifiant, mais une adresse qui correspond à un compte : RIEN n'est crédité", async () => {
    // Avant la mission #112, ce paiement créditait le compte trouvé par son
    // adresse. C'est exactement l'attribution qu'on a supprimée.
    const outcome = await applyWhopEvent(pack("evt_sans_id", { user: { email: EMAIL } }));
    expect(outcome.handled).toBe(false);
    expect(outcome.pending).toBe(true);
    expect(db.balance).toBe(0);
    expect(db.credited.size).toBe(0);
    // Le paiement est en attente, avec l'adresse gardée pour le rattachement
    // à la main — affichée, jamais décisive.
    expect(pending("evt_sans_id")).toMatchObject({ reason: "compte_introuvable", user_id: null, email: EMAIL });
  });

  it("aucun identifiant et une adresse inconnue : aucun compte n'est créé", async () => {
    const avant = (db.tables.get("profiles") ?? []).length;
    await applyWhopEvent(pack("evt_inconnu", { user: { email: "personne@exemple.test" } }));
    expect((db.tables.get("profiles") ?? []).length).toBe(avant);
    expect((db.tables.get("profiles") ?? []).some((row) => row.email === "personne@exemple.test")).toBe(false);
    expect(db.balance).toBe(0);
  });

  it("le rattrapage rejoue le même événement : toujours par identifiant, toujours rien", async () => {
    await applyWhopEvent(pack("evt_sans_id", { user: { email: EMAIL } }));
    // Trois passes de rattrapage plus tard, l'adresse n'a toujours rien décidé.
    for (const minutes of [DAY, 2 * DAY, 3 * DAY]) {
      vi.setSystemTime(at(minutes));
      const outcome = await applyWhopEvent(pack("evt_sans_id", { user: { email: EMAIL } }));
      expect(outcome.pending).toBe(true);
    }
    expect(db.balance).toBe(0);
    // La reprise à 30 jours l'abandonne, et le dit.
    expect(await expireUnattachedPayments(at(31 * DAY))).toBe(1);
    expect(pending("evt_sans_id")).toMatchObject({ resolution: "abandonne" });
    expect(logged("whop_paiement_non_rattache_expire")[0].row).toMatchObject({ event_id: "evt_sans_id", email: EMAIL });
  });

  it("un renouvellement sans metadata se rattache par l'abonnement enregistré, pas par l'adresse", async () => {
    // Activation initiale : l'abonnement est mémorisé sur le compte.
    await applyWhopEvent(activation("evt_act1", "mem_1", at(30 * DAY).toISOString()));
    expect(credits()).toMatchObject({ user_id: USER, membership_id: "mem_1" });

    // Renouvellement : Whop ne recopie pas les metadata, mais l'abonnement est
    // le même — et c'est un identifiant que NOUS avons posé.
    vi.setSystemTime(at(30 * DAY));
    const outcome = await applyWhopEvent({
      id: "evt_act2",
      type: "membership.activated",
      data: { id: "mem_1", plan: { id: "plan_pro" }, renewal_period_end: at(60 * DAY).toISOString(), user: { email: "portefeuille@exemple.test" } },
    });
    expect(outcome.handled).toBe(true);
    expect(outcome.userId).toBe(USER);
    expect(credits()).toMatchObject({ plan: "pro" });
  });

  it("un abonnement inconnu et sans metadata : rien n'est accordé", async () => {
    const outcome = await applyWhopEvent({
      id: "evt_act_inconnue",
      type: "membership.activated",
      data: { id: "mem_jamais_vu", plan: { id: "plan_pro" }, renewal_period_end: at(30 * DAY).toISOString(), user: { email: EMAIL } },
    });
    expect(outcome.handled).toBe(false);
    expect(credits()).toMatchObject({ plan: "free" });
  });
});
