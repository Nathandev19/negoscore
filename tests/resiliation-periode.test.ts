import { beforeEach, describe, expect, it, vi } from "vitest";

// Mission #113, E — résilier ne raccourcit jamais une période déjà payée.
//
// Whop ne connaît que la fin de l'abonnement qu'on résilie. Quand la période en
// place a été EMPILÉE — second abonnement distinct (#090 bis), ou paiement
// rattrapé faute d'activation (#092) — elle va plus loin, et elle est payée.
// La route posait la date de Whop telle quelle : le compte perdait la
// différence. Le webhook, lui, gardait déjà la plus lointaine.

const state = vi.hoisted(() => ({
  credits: { plan: "pro", balance: 0, period_end: "", cancelled_at: null as string | null },
  whopEnd: null as string | null,
  updates: [] as Array<{ filter: string; patch: Record<string, unknown> }>,
}));

vi.mock("@/lib/auth/request-user", async () => (await import("./helpers/request-session")).requestSessionMock(() => ({ id: "u1", email: "nina@exemple.test" })));
vi.mock("@/lib/supabase/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/server")>()),
  selectRows: async () => [state.credits],
  updateRows: async (_table: string, filter: string, patch: Record<string, unknown>) => {
    state.updates.push({ filter, patch });
    return [patch];
  },
}));
vi.mock("@/lib/billing/subscription", () => ({ findMembershipId: async () => "mem_1" }));
vi.mock("@/lib/whop/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/whop/api")>()),
  cancelMembershipAtPeriodEnd: async () => ({ id: "mem_1", status: "canceled", cancel_at_period_end: true, renewal_period_end: state.whopEnd }),
}));
vi.mock("@/lib/email/send", () => ({ sendEmail: async () => undefined }));

const { POST } = await import("@/app/api/resilier/route");

const DANS_UN_MOIS = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
const DANS_DEUX_MOIS = new Date(Date.now() + 60 * 24 * 3600 * 1000).toISOString();

const resilier = () => POST(new Request("http://localhost:3000/api/resilier", { method: "POST" }));
const periodEnd = () => state.updates.at(-1)?.patch.period_end;

beforeEach(() => {
  state.updates = [];
  state.credits = { plan: "pro", balance: 0, period_end: DANS_DEUX_MOIS, cancelled_at: null };
  state.whopEnd = DANS_UN_MOIS;
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("résiliation : la fin d'accès la plus lointaine des deux", () => {
  it("période empilée sur deux mois, abonnement Whop à un mois : les deux mois sont gardés", async () => {
    const response = await resilier();
    expect(response.headers.get("location")).toBe("/resilier?etat=resilie");
    expect(periodEnd()).toBe(DANS_DEUX_MOIS);
    expect(periodEnd()).not.toBe(DANS_UN_MOIS);
    expect(state.updates.at(-1)?.patch.cancelled_at).toEqual(expect.any(String));
  });

  it("cas normal, une seule période : la date de Whop est posée, comme avant", async () => {
    state.credits.period_end = DANS_UN_MOIS;
    state.whopEnd = DANS_DEUX_MOIS;
    await resilier();
    expect(periodEnd()).toBe(DANS_DEUX_MOIS);
  });

  it("Whop ne renvoie aucune date : la période en place est conservée", async () => {
    state.whopEnd = null;
    await resilier();
    expect(periodEnd()).toBe(DANS_DEUX_MOIS);
  });

  it("aucune période n'est ramenée avant l'instant présent", async () => {
    state.whopEnd = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    await resilier();
    expect(new Date(String(periodEnd())).getTime()).toBeGreaterThan(Date.now());
  });

  it("un abonnement déjà résilié n'est pas rappelé au prestataire", async () => {
    state.credits.cancelled_at = new Date().toISOString();
    const response = await resilier();
    expect(response.headers.get("location")).toBe("/resilier?etat=deja");
    expect(state.updates).toEqual([]);
  });
});
