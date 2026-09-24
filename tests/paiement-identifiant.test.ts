import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mission #112 — un paiement qu'on ne sait pas attribuer ne doit pas avoir lieu.
//
// Le défaut, signalé sur un autre produit du même prestataire : quand la
// création de session de paiement échoue, le code retombe sur une page de
// paiement STATIQUE, sans l'identifiant du compte. La personne paie, et le
// webhook n'a plus que l'adresse de l'acheteur pour deviner qui créditer.
// Avec Apple Pay, cette adresse n'est pas celle du compte : le client paie,
// son compte reste gratuit, et rien ne le lui dit.

const db = vi.hoisted(() => ({
  credits: null as null | { plan: string; balance: number; period_end: string | null },
  consents: [] as Array<Record<string, unknown>>,
  events: [] as Array<Record<string, unknown>>,
}));
const whop = vi.hoisted(() => ({ session: "ok" as "ok" | "echec" }));
const user = vi.hoisted(() => ({ current: { id: "u1", email: "compte@exemple.test" } as { id: string; email: string } | null }));

vi.mock("@/lib/auth/request-user", async () => (await import("./helpers/request-session")).requestSessionMock(() => user.current));
vi.mock("@/lib/supabase/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/server")>()),
  selectRows: async (table: string) => (table === "credits" && db.credits ? [db.credits] : []),
  insertRow: async (table: string, row: Record<string, unknown>) => {
    if (table === "checkout_consents") db.consents.push(row);
    return row;
  },
}));
vi.mock("@/lib/analytics/first-party", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/analytics/first-party")>()),
  recordProductEvent: async (input: Record<string, unknown>) => {
    db.events.push(input);
  },
}));
vi.mock("@/lib/whop/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/whop/api")>()),
  // Échec de création : exactement ce que rend createCheckoutUrl quand la clé
  // API manque, que Whop répond en erreur, ou que le réseau tombe.
  createCheckoutUrl: async () =>
    whop.session === "ok" ? { url: "https://whop.com/checkout/ch_1/", checkoutConfigurationId: "ch_1" } : null,
}));

const { POST } = await import("@/app/api/checkout/route");

const achat = (plan: string) =>
  new Request("http://localhost:3000/api/checkout", {
    method: "POST",
    body: new URLSearchParams({ plan, consent: "on" }),
  });

beforeEach(() => {
  db.credits = null;
  db.consents = [];
  db.events = [];
  whop.session = "ok";
  user.current = { id: "u1", email: "compte@exemple.test" };
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("A1 — la session de paiement porte l'identifiant, ou le paiement n'a pas lieu", () => {
  it("session créée normalement : le paiement s'ouvre, le consentement est enregistré", async () => {
    const response = await POST(achat("pack"));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://whop.com/checkout/ch_1/");
    expect(db.consents).toHaveLength(1);
    expect(db.consents[0]).toMatchObject({ user_id: "u1", plan: "pack", checkout_configuration_id: "ch_1" });
    expect(db.events[0]).toMatchObject({ event: "checkout_started", userId: "u1", metadata: { plan: "pack", attached: true } });
  });

  it("l'identifiant du compte est bien celui qui part chez Whop", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const api = await import("@/lib/whop/api");
    vi.spyOn(api, "createCheckoutUrl").mockImplementation(async (options) => {
      calls.push(options.metadata);
      return { url: "https://whop.com/checkout/ch_2/", checkoutConfigurationId: "ch_2" };
    });
    await POST(achat("pro"));
    expect(calls[0]).toMatchObject({ user_id: "u1", plan: "pro" });
    vi.restoreAllMocks();
  });

  it("création de session en échec : AUCUN paiement, une erreur claire, rien d'enregistré", async () => {
    whop.session = "echec";
    const response = await POST(achat("pack"));
    expect(response.status).toBe(303);
    const location = String(response.headers.get("location"));
    // Ni whop.com, ni aucune page de paiement : on reste sur /tarifs.
    expect(location).toBe("/tarifs?erreur=session&formule=pack");
    expect(location).not.toContain("whop.com");
    // Aucune vente n'a lieu : pas de consentement, pas d'événement de départ.
    expect(db.consents).toEqual([]);
    expect(db.events).toEqual([]);
  });

  it("le message montré dit quoi faire, et ne culpabilise pas", () => {
    const errors = source("components/offers/offers-error.tsx");
    expect(errors).toContain("session:");
    expect(errors).toContain("Rien n'a été débité");
    expect(errors).toContain("réessaie");
  });

  it("aucun lien de paiement de secours n'existe plus dans le code", () => {
    const api = source("lib/whop/api.ts");
    const route = source("app/api/checkout/route.ts");
    expect(api).not.toContain("export function fallbackCheckoutUrl");
    expect(route).not.toContain("fallbackCheckoutUrl");
    // Le seul lien renvoyé vient d'une configuration créée avec l'identifiant.
    expect(route).toContain("return redirect(checkout.url)");
  });

  it("D7 — sans compte connecté, on ne peut pas atteindre le paiement", async () => {
    user.current = null;
    const response = await POST(achat("pack"));
    expect(response.headers.get("location")).toBe("/connexion?next=%2Ftarifs");
    expect(db.consents).toEqual([]);
  });
});

describe("A3 — le webhook attribue par identifiant, jamais par email", () => {
  it("l'attribution ne lit plus la table des comptes par adresse", () => {
    const events = source("lib/billing/whop-events.ts");
    expect(events).not.toContain("email=ilike.");
    expect(events).toContain("isUuid(fromMetadata)");
  });

  it("A2 — aucun code du webhook ne crée de compte", () => {
    // Commentaires retirés : on vérifie du CODE, pas de la prose.
    const events = source("lib/billing/whop-events.ts")
      .split(/\r?\n/)
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
    for (const creation of ["ensureAccount", 'insertIfAbsent("profiles"', 'insertRow("profiles"']) {
      expect(events, creation).not.toContain(creation);
    }
    // La seule table que le webhook alimente sans lire d'abord est credits, et
    // seulement pour un compte qui existe déjà.
    expect(events).toContain('insertIfAbsent("credits"');
    // La seule création de compte du produit passe par une session vérifiée.
    expect(source("lib/auth/account.ts")).toContain('insertIfAbsent("profiles"');
    expect(source("lib/auth/sign-in.ts")).toContain("ensureAccount");
  });
});
