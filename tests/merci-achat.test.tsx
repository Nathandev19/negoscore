import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mission #090 — la page « Merci » confirme CE QUI VIENT D'ÊTRE ACHETÉ, jamais
// l'état du compte à la place. Constat de production : un Pack Deal acheté par
// une abonnée Pro affichait « ton compte est crédité. Abonnement Pro actif
// jusqu'au 16/10/2026 », sans un mot des 3 analyses.

const db = vi.hoisted(() => ({ rows: new Map<string, unknown[]>(), writes: [] as Array<{ table: string; row: Record<string, unknown> }>, balance: 2 }));

vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/server")>();
  return {
    ...actual,
    selectRows: async (table: string) => db.rows.get(table) ?? [],
    insertIfAbsent: async (table: string, row: Record<string, unknown>) => {
      if (!db.writes.some((w) => w.table === table && w.row.event_id === row.event_id)) db.writes.push({ table, row });
    },
    insertRow: async (table: string, row: Record<string, unknown>) => {
      db.writes.push({ table, row });
      return { id: "x" };
    },
    updateRows: async (table: string, _filter: string, row: Record<string, unknown>) => {
      db.writes.push({ table, row });
      return [];
    },
    adjustInteger: async (_t: string, _f: string, _c: string, delta: number) => {
      db.balance += delta;
      return db.balance;
    },
    rpc: async (_name: string, args: Record<string, unknown>) => {
      db.writes.push({ table: "credit", row: args });
      db.balance += Number(args.p_amount);
      return true;
    },
  };
});

const { CreditsWaiter, accountText, boughtFromCredits, purchaseText, whatToShow } = await import("@/components/merci/credits-waiter");
const { applyWhopEvent, periodAfterActivation } = await import("@/lib/billing/whop-events");
const { recentPurchases } = await import("@/lib/billing/purchases");

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/[\s  ]+/g, " ").trim();
const USER = "11111111-1111-4111-8111-111111111111";
const PACK = { event_id: "evt_1", plan: "pack" as const, analyses_added: 3, period_end: null, paid_at: "2026-09-22T10:00:00.000Z" };
const PRO = { event_id: "evt_2", plan: "pro" as const, analyses_added: 0, period_end: "2026-10-22T10:00:00.000Z", paid_at: "2026-09-22T10:00:00.000Z" };
const render = (account: { plan: "free" | "pack" | "pro"; balance: number; period_end: string | null } | null, bought: Parameters<typeof CreditsWaiter>[0]["bought"]) =>
  text(renderToStaticMarkup(<CreditsWaiter initial={account} bought={bought} />));

beforeEach(() => {
  db.rows = new Map();
  db.writes = [];
  db.balance = 2;
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("A1, A4 — les trois cas d'achat", () => {
  it("Pack Deal seul : le produit, les analyses ajoutées et ce qu'il reste", () => {
    const html = render({ plan: "pack", balance: 3, period_end: null }, { purchase: PACK, duplicates: 1, analysesAdded: 3 });
    expect(html).toContain("C'est bon, ton achat est enregistré : Pack Deal. 3 négociations ajoutées, il t'en reste 3.");
    expect(html).toContain("Ton compte : 3 négociations disponibles.");
  });

  it("Pro seul : la date de fin de période", () => {
    const html = render({ plan: "pro", balance: 0, period_end: PRO.period_end }, { purchase: PRO, duplicates: 1, analysesAdded: 0 });
    expect(html).toContain("ton achat est enregistré : abonnement Pro. Ton abonnement Pro est actif jusqu'au 22/10/2026.");
  });

  it("le défaut constaté : un Pack acheté par une abonnée Pro confirme le PACK, l'abonnement n'arrive qu'après", () => {
    const html = render({ plan: "pro", balance: 5, period_end: "2026-10-16T00:00:00.000Z" }, { purchase: PACK, duplicates: 1, analysesAdded: 3 });
    expect(html).toContain("C'est bon, ton achat est enregistré : Pack Deal. 3 négociations ajoutées, il t'en reste 5.");
    // L'état du compte reste, mais après la confirmation et séparé d'elle.
    const confirmation = html.indexOf("ton achat est enregistré");
    const account = html.indexOf("Ton compte : abonnement Pro actif jusqu'au 16/10/2026 · 5 négociations disponibles.");
    expect(account).toBeGreaterThan(confirmation);
    // Ce que disait la page avant : l'abonnement présenté comme la confirmation.
    expect(html).not.toContain("ton compte est crédité");
  });
});

describe("A2, A3 — ce que la page dit quand elle ne sait pas encore", () => {
  it("webhook pas encore arrivé : enregistrement en cours, aucune confirmation", () => {
    const html = render({ plan: "pro", balance: 5, period_end: "2026-10-16T00:00:00.000Z" }, { purchase: null, duplicates: 0, analysesAdded: 0 });
    expect(html).toBe("On enregistre ton paiement… Reste sur cette page quelques secondes.");
    expect(whatToShow({ purchase: null, duplicates: 0, analysesAdded: 0 }, false)).toBe("waiting");
    expect(whatToShow({ purchase: null, duplicates: 0, analysesAdded: 0 }, true)).toBe("late");
  });

  it("achat illisible : rien n'est affirmé sur le produit, l'état du compte est dit comme tel", () => {
    const html = render({ plan: "pack", balance: 5, period_end: null }, "unknown");
    expect(html).toContain("Le détail de cet achat n'est pas lisible pour le moment.");
    expect(html).toContain("Ton compte : 5 négociations disponibles.");
    expect(html).not.toContain("négociations ajoutées");
    expect(whatToShow("unknown", false)).toBe("unknown");
  });

  it("l'achat vient du webhook, jamais d'une déduction sur le solde", () => {
    // Un solde, même élevé, ne confirme aucun achat : sans le champ « purchase »
    // venu du webhook, la page ne sait pas.
    expect(boughtFromCredits({})).toBe("unknown");
    expect(boughtFromCredits({ purchase: null })).toEqual({ purchase: null, duplicates: 0, analysesAdded: 0 });
    expect(boughtFromCredits({ purchase: PACK, duplicates: 2, analyses_added: 6 })).toEqual({ purchase: PACK, duplicates: 2, analysesAdded: 6 });
    expect(purchaseText(PACK, { plan: "pack", balance: 5, period_end: null })).toBe("3 négociations ajoutées, il t'en reste 5.");
    expect(accountText({ plan: "free", balance: 1, period_end: null })).toBe("Ton compte : 1 négociation disponible.");
  });
});

describe("B3 — deux paiements du même produit à quelques minutes d'intervalle", () => {
  it("la page le dit, dit ce qui a été honoré, et comment se faire rembourser", () => {
    const html = render({ plan: "pack", balance: 8, period_end: null }, { purchase: PACK, duplicates: 2, analysesAdded: 6 });
    expect(html).toContain("2 paiements de Pack Deal sont arrivés à quelques minutes d'intervalle.");
    expect(html).toContain("Chacun a été honoré : 6 négociations ont été ajoutées en tout.");
    expect(html).toContain("on te rembourse le paiement en trop");
    expect(html).toContain("contact@negoscore.fr");
  });

  it("un seul paiement : aucun avertissement", () => {
    expect(render({ plan: "pack", balance: 5, period_end: null }, { purchase: PACK, duplicates: 1, analysesAdded: 3 })).not.toContain("intervalle");
  });

  it("le regroupement : même produit, quelques minutes d'écart", async () => {
    const at = (minutes: number) => new Date(Date.parse("2026-09-22T10:00:00.000Z") + minutes * 60_000).toISOString();
    db.rows.set("purchases", [
      { ...PACK, event_id: "e3", paid_at: at(0) },
      { ...PACK, event_id: "e2", paid_at: at(-4) },
      { ...PACK, event_id: "e1", paid_at: at(-90) },
    ]);
    const recent = await recentPurchases(USER, new Date(at(1)));
    expect(recent).not.toBe("unavailable");
    if (recent === "unavailable") return;
    expect(recent.duplicates).toBe(2);
    expect(recent.analysesAdded).toBe(6);
  });
});

describe("B1, B2 — deux Pack Deal réellement payés : les deux créditent", () => {
  const packPayment = (id: string) => ({
    id,
    type: "payment.succeeded",
    data: { plan: { id: "plan_pack_test" }, metadata: { user_id: USER }, total: 4.99, currency: "eur" },
  });

  beforeEach(() => {
    vi.stubEnv("WHOP_PLAN_PACK", "plan_pack_test");
    db.rows.set("profiles", [{ id: USER, email: "nina@exemple.test" }]);
    db.rows.set("credits", [{ user_id: USER, plan: "pack", balance: 2, period_end: null, cancelled_at: null }]);
  });

  it("deux paiements distincts : +3 analyses chacun, et deux achats enregistrés", async () => {
    const first = await applyWhopEvent(packPayment("evt_a"));
    const second = await applyWhopEvent(packPayment("evt_b"));
    expect([first.handled, second.handled]).toEqual([true, true]);
    const credits = db.writes.filter((w) => w.table === "credit");
    expect(credits.map((w) => [w.row.p_event_id, w.row.p_amount])).toEqual([
      ["evt_a", 3],
      ["evt_b", 3],
    ]);
    expect(db.balance).toBe(8);
    const purchases = db.writes.filter((w) => w.table === "purchases");
    expect(purchases.map((w) => w.row.event_id)).toEqual(["evt_a", "evt_b"]);
    expect(purchases.every((w) => w.row.analyses_added === 3 && w.row.user_id === USER)).toBe(true);
  });

  it("le même paiement rejoué : un seul achat enregistré", async () => {
    await applyWhopEvent(packPayment("evt_a"));
    await applyWhopEvent(packPayment("evt_a"));
    expect(db.writes.filter((w) => w.table === "purchases")).toHaveLength(1);
  });
});

describe("A — la période Pro se prolonge, elle ne s'écrase plus", () => {
  const NOW = new Date("2026-09-22T12:00:00.000Z");
  const membership = (id: string, renewalEnd: string) => ({
    id: "evt_" + id,
    type: "membership.activated",
    data: { id, plan: { id: "plan_pro_test" }, metadata: { user_id: USER }, renewal_period_end: renewalEnd },
  });
  const creditsRow = (over: Record<string, unknown>) => [{ user_id: USER, plan: "pro", balance: 0, period_end: null, cancelled_at: null, membership_id: null, ...over }];
  const written = () => db.writes.filter((w) => w.table === "credits").at(-1)?.row as Record<string, unknown>;

  // Mission #119 — l'horloge est FIGÉE ici. `periodAfterActivation` recevait
  // NOW en argument, mais `applyWhopEvent` lisait l'heure réelle : le report
  // dépendait donc du jour où la suite tournait, et l'assertion du 3e test est
  // passée au rouge toute seule le 28/09. Un test ne doit pas avoir de date de
  // péremption.
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: NOW });
    vi.stubEnv("WHOP_PLAN_PRO", "plan_pro_test");
    db.rows.set("profiles", [{ id: USER, email: "nina@exemple.test" }]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("A3 — aucun abonnement actif : la date annoncée par Whop", async () => {
    db.rows.set("credits", creditsRow({ plan: "free" }));
    await applyWhopEvent(membership("mem_1", "2026-10-22T12:00:00.000Z"));
    expect(written()).toMatchObject({ plan: "pro", period_end: "2026-10-22T12:00:00.000Z", membership_id: "mem_1" });
  });

  it("A3 — renouvellement mensuel du MÊME abonnement : la date de Whop, sans rien ajouter", async () => {
    db.rows.set("credits", creditsRow({ period_end: "2026-10-16T12:00:00.000Z", membership_id: "mem_1" }));
    await applyWhopEvent(membership("mem_1", "2026-11-16T12:00:00.000Z"));
    expect(written()).toMatchObject({ period_end: "2026-11-16T12:00:00.000Z" });
  });

  it("A3, A1 — second abonnement DISTINCT pendant qu'un autre court : les deux mois s'ajoutent", async () => {
    // Période en cours jusqu'au 16/10 ; un mois payé aujourd'hui (fin annoncée
    // au 22/10) ajoute 30 jours : accès jusqu'au 15/11, pas jusqu'au 22/10.
    db.rows.set("credits", creditsRow({ period_end: "2026-10-16T12:00:00.000Z", membership_id: "mem_1" }));
    const { periodEnd, kind } = periodAfterActivation(
      { period_end: "2026-10-16T12:00:00.000Z", membership_id: "mem_1" },
      "mem_2",
      "2026-10-22T12:00:00.000Z",
      NOW,
    );
    expect(kind).toBe("extended");
    expect(periodEnd).toBe("2026-11-15T12:00:00.000Z");
    await applyWhopEvent(membership("mem_2", "2026-10-22T12:00:00.000Z"));
    // Horloge figée : la date écrite est exactement celle que la fonction pure
    // annonce, au lieu d'un « après le 10/11 » qui se périmait.
    expect(written().period_end).toBe("2026-11-15T12:00:00.000Z");
    expect(written()).toMatchObject({ membership_id: "mem_2" });
  });

  it("A2 — abonnement en place inconnu (activé avant la migration) : la date la plus lointaine, et c'est journalisé", () => {
    const older = periodAfterActivation({ period_end: "2026-11-16T12:00:00.000Z", membership_id: null }, "mem_2", "2026-10-22T12:00:00.000Z", NOW);
    expect(older).toEqual({ periodEnd: "2026-11-16T12:00:00.000Z", kind: "indistinct" });
    const newer = periodAfterActivation({ period_end: "2026-10-01T12:00:00.000Z", membership_id: null }, null, "2026-10-22T12:00:00.000Z", NOW);
    expect(newer).toEqual({ periodEnd: "2026-10-22T12:00:00.000Z", kind: "indistinct" });
  });

  it("l'achat enregistré porte la période réellement accordée", async () => {
    db.rows.set("credits", creditsRow({ period_end: "2026-10-16T12:00:00.000Z", membership_id: "mem_1" }));
    await applyWhopEvent(membership("mem_2", "2026-10-22T12:00:00.000Z"));
    const purchase = db.writes.find((w) => w.table === "purchases")?.row as Record<string, unknown>;
    expect(purchase.plan).toBe("pro");
    expect(purchase.period_end).toBe(written().period_end);
  });
});

describe("A4 — une résiliation ne raccourcit pas une période déjà payée", () => {
  it("un abonnement résilié alors qu'un second avait prolongé : la période la plus lointaine reste", async () => {
    vi.stubEnv("WHOP_PLAN_PRO", "plan_pro_test");
    db.rows.set("profiles", [{ id: USER, email: "nina@exemple.test" }]);
    db.rows.set("credits", [{ user_id: USER, plan: "pro", balance: 0, period_end: "2026-11-15T12:00:00.000Z", cancelled_at: null, membership_id: "mem_2" }]);
    await applyWhopEvent({
      id: "evt_cancel",
      type: "membership.deactivated",
      data: { id: "mem_1", plan: { id: "plan_pro_test" }, metadata: { user_id: USER }, status: "canceled", renewal_period_end: "2026-10-22T12:00:00.000Z" },
    });
    const row = db.writes.filter((w) => w.table === "credits").at(-1)?.row as Record<string, unknown>;
    expect(row.period_end).toBe("2026-11-15T12:00:00.000Z");
    expect(row.cancelled_at).toEqual(expect.any(String));
  });
});
