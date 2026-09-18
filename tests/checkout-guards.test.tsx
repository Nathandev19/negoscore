import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mission #071 — aucun bouton d'achat avant de savoir qui regarde, et une garde
// serveur qui ne dépend pas de l'affichage.

type Consent = { user_id: string; plan: string; checkout_configuration_id: string | null; accepted_at: string };

const db = vi.hoisted(() => ({
  credits: null as null | { plan: string; balance: number; period_end: string | null },
  consents: [] as Consent[],
}));
const whop = vi.hoisted(() => ({ created: 0 }));
const user = vi.hoisted(() => ({ current: { id: "u1", email: "nina@exemple.test" } as { id: string; email: string } | null }));

vi.mock("@/lib/auth/request-user", () => ({ getRequestUser: async () => user.current }));
vi.mock("@/lib/supabase/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/server")>()),
  selectRows: async (table: string, query: string) => {
    if (table === "credits") return db.credits ? [db.credits] : [];
    if (table === "checkout_consents") {
      const plan = query.match(/plan=eq\.([^&]+)/)?.[1];
      const since = decodeURIComponent(query.match(/accepted_at=gt\.([^&]+)/)?.[1] ?? "");
      return db.consents
        .filter((c) => c.plan === plan && c.checkout_configuration_id && c.accepted_at > since)
        .sort((a, b) => b.accepted_at.localeCompare(a.accepted_at))
        .slice(0, 1);
    }
    return [];
  },
  insertRow: async (table: string, row: Record<string, unknown>) => {
    if (table === "checkout_consents") db.consents.push(row as unknown as Consent);
    return row;
  },
}));
vi.mock("@/lib/whop/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/whop/api")>()),
  createCheckoutUrl: async () => {
    whop.created += 1;
    const id = `ch_${whop.created}`;
    return { url: `https://whop.com/checkout/${id}/`, checkoutConfigurationId: id };
  },
}));

const { POST, DUPLICATE_CHECKOUT_WINDOW_MS } = await import("@/app/api/checkout/route");

function buy(plan: "pack" | "pro") {
  const form = new FormData();
  form.set("plan", plan);
  form.set("consent", "on");
  return POST(new Request("http://localhost:3000/api/checkout", { method: "POST", body: form }));
}

const inAMonth = () => new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();

beforeEach(() => {
  db.credits = { plan: "free", balance: 0, period_end: null };
  db.consents = [];
  whop.created = 0;
  user.current = { id: "u1", email: "nina@exemple.test" };
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

describe("B — garde serveur, indépendante de l'affichage", () => {
  it("B1 — compte déjà Pro qui relance une souscription Pro : refusé, sans créer de paiement", async () => {
    db.credits = { plan: "pro", balance: 0, period_end: inAMonth() };
    const response = await buy("pro");
    expect(response.headers.get("location")).toBe("/tarifs?erreur=deja_pro");
    expect(whop.created).toBe(0);
    expect(db.consents).toEqual([]);
  });

  it("B2 — compte Pro qui prend un Pack Deal : accepté, c'est la recharge proposée par /tarifs", async () => {
    db.credits = { plan: "pro", balance: 0, period_end: inAMonth() };
    const response = await buy("pack");
    expect(response.headers.get("location")).toBe("https://whop.com/checkout/ch_1/");
    expect(whop.created).toBe(1);
  });

  it("B2 — le même achat relancé coup sur coup : la même page de paiement, jamais une seconde", async () => {
    const first = await buy("pro");
    const second = await buy("pro");
    expect(first.headers.get("location")).toBe("https://whop.com/checkout/ch_1/");
    expect(second.headers.get("location")).toBe("https://whop.com/checkout/ch_1/");
    expect(whop.created).toBe(1);
    // Un seul consentement pour ce paiement.
    expect(db.consents).toHaveLength(1);
  });

  it("B2 — passé la fenêtre de 2 minutes, un nouvel essai ouvre une nouvelle page (paiement abandonné puis repris)", async () => {
    await buy("pack");
    db.consents[0].accepted_at = new Date(Date.now() - DUPLICATE_CHECKOUT_WINDOW_MS - 1000).toISOString();
    const retry = await buy("pack");
    expect(retry.headers.get("location")).toBe("https://whop.com/checkout/ch_2/");
    expect(whop.created).toBe(2);
  });

  it("B2 — deux formules différentes coup sur coup : deux paiements distincts, pas de mélange", async () => {
    await buy("pack");
    const pro = await buy("pro");
    expect(pro.headers.get("location")).toBe("https://whop.com/checkout/ch_2/");
  });
});

describe("A — /tarifs avant de savoir qui regarde", () => {
  it("rendu serveur : prix et formules visibles, aucun contrôle d'achat, une attente inerte à la place", async () => {
    const { OffersList } = await import("@/components/offers/offers-list");
    const { PLANS } = await import("@/lib/billing/plans");
    const html = renderToStaticMarkup(<OffersList />);
    // Contenus non personnalisés : là, et donc indexables.
    for (const plan of PLANS) {
      expect(html).toContain(plan.name);
      // « 4,99 € » : le montant, sans dépendre de l'espace insécable.
      expect(html).toContain(plan.price.replace(/[\s  ]*€$/, ""));
    }
    // Rien d'achetable, rien qui affirme un état du compte.
    expect(html).not.toContain('type="checkbox"');
    expect(html).not.toContain("Prendre ");
    expect(html).not.toContain("Se connecter pour payer");
    expect(html).not.toContain("/api/checkout");
    // L'attente : une par formule payante, masquée aux lecteurs d'écran, avec une annonce unique.
    expect(html.match(/data-pending-purchase/g)).toHaveLength(2);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Lecture de ton compte avant d&#x27;afficher les boutons de paiement.");
  });
});
