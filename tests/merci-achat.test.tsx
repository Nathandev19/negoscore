import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
const { applyWhopEvent } = await import("@/lib/billing/whop-events");
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
    expect(html).toContain("C'est bon, ton achat est enregistré : Pack Deal. 3 analyses ajoutées, il t'en reste 3.");
    expect(html).toContain("Ton compte : 3 analyses disponibles.");
  });

  it("Pro seul : la date de fin de période", () => {
    const html = render({ plan: "pro", balance: 0, period_end: PRO.period_end }, { purchase: PRO, duplicates: 1, analysesAdded: 0 });
    expect(html).toContain("ton achat est enregistré : abonnement Pro. Ton abonnement Pro est actif jusqu'au 22/10/2026.");
  });

  it("le défaut constaté : un Pack acheté par une abonnée Pro confirme le PACK, l'abonnement n'arrive qu'après", () => {
    const html = render({ plan: "pro", balance: 5, period_end: "2026-10-16T00:00:00.000Z" }, { purchase: PACK, duplicates: 1, analysesAdded: 3 });
    expect(html).toContain("C'est bon, ton achat est enregistré : Pack Deal. 3 analyses ajoutées, il t'en reste 5.");
    // L'état du compte reste, mais après la confirmation et séparé d'elle.
    const confirmation = html.indexOf("ton achat est enregistré");
    const account = html.indexOf("Ton compte : abonnement Pro actif jusqu'au 16/10/2026 · 5 analyses disponibles.");
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
    expect(html).toContain("Ton compte : 5 analyses disponibles.");
    expect(html).not.toContain("analyses ajoutées");
    expect(whatToShow("unknown", false)).toBe("unknown");
  });

  it("l'achat vient du webhook, jamais d'une déduction sur le solde", () => {
    // Un solde, même élevé, ne confirme aucun achat : sans le champ « purchase »
    // venu du webhook, la page ne sait pas.
    expect(boughtFromCredits({})).toBe("unknown");
    expect(boughtFromCredits({ purchase: null })).toEqual({ purchase: null, duplicates: 0, analysesAdded: 0 });
    expect(boughtFromCredits({ purchase: PACK, duplicates: 2, analyses_added: 6 })).toEqual({ purchase: PACK, duplicates: 2, analysesAdded: 6 });
    expect(purchaseText(PACK, { plan: "pack", balance: 5, period_end: null })).toBe("3 analyses ajoutées, il t'en reste 5.");
    expect(accountText({ plan: "free", balance: 1, period_end: null })).toBe("Ton compte : 1 analyse disponible.");
  });
});

describe("B3 — deux paiements du même produit à quelques minutes d'intervalle", () => {
  it("la page le dit, dit ce qui a été honoré, et comment se faire rembourser", () => {
    const html = render({ plan: "pack", balance: 8, period_end: null }, { purchase: PACK, duplicates: 2, analysesAdded: 6 });
    expect(html).toContain("2 paiements de Pack Deal sont arrivés à quelques minutes d'intervalle.");
    expect(html).toContain("Chacun a été honoré : 6 analyses ont été ajoutées en tout.");
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
