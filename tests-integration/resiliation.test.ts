import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { configured, createUser, deleteUser, insert, service, type TestUser } from "./helpers";

// Résiliation en ligne. L'appel à Whop est remplacé par un espion : aucune
// résiliation réelle n'est déclenchée. La base, l'auth et la route sont réelles.
const whop = vi.hoisted(() => ({ cancel: vi.fn(), get: vi.fn() }));
vi.mock("@/lib/whop/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/whop/api")>();
  return { ...actual, cancelMembershipAtPeriodEnd: whop.cancel, getMembership: whop.get };
});

const mail = vi.hoisted(() => ({
  send: vi.fn(
    async (email: { to: string; subject: string; text: string }, context?: Record<string, unknown>) =>
      ({ sent: true, attempts: 1, to: email.to, context }) as const,
  ),
}));
vi.mock("@/lib/email/send", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email/send")>();
  return { ...actual, sendEmail: mail.send };
});

const { POST: resilier } = await import("@/app/api/resilier/route");
const { POST: checkout } = await import("@/app/api/checkout/route");

const PRO = process.env.WHOP_PLAN_PRO ?? "";
const ready = configured && Boolean(PRO);

const users: TestUser[] = [];
const events: string[] = [];

afterAll(async () => {
  for (const user of users) await deleteUser(user);
  for (const id of events) await service(`/rest/v1/whop_events?event_id=eq.${encodeURIComponent(id)}`, { method: "DELETE" });
});

beforeEach(() => {
  whop.cancel.mockReset();
  whop.get.mockReset();
  mail.send.mockClear();
});

async function user(plan: "free" | "pack" | "pro", balance = 0): Promise<TestUser> {
  const created = await createUser();
  users.push(created);
  await insert("profiles", { id: created.id, email: created.email });
  await insert("credits", {
    user_id: created.id,
    balance,
    plan,
    period_end: plan === "pro" ? new Date(Date.now() + 15 * 24 * 3600 * 1000).toISOString() : null,
  });
  return created;
}

// Abonnement rattaché : l'identifiant vient de l'événement membership.activated.
async function seedActivation(userId: string): Promise<string> {
  const membershipId = `mem_${randomUUID()}`;
  const eventId = `msg_test_${randomUUID()}`;
  events.push(eventId);
  await insert("whop_events", {
    event_id: eventId,
    type: "membership.activated",
    payload: {
      id: eventId,
      type: "membership.activated",
      data: {
        id: membershipId,
        status: "active",
        plan: { id: PRO },
        metadata: { user_id: userId },
        renewal_period_end: new Date(Date.now() + 15 * 24 * 3600 * 1000).toISOString(),
      },
    },
    processed_at: new Date().toISOString(),
  });
  return membershipId;
}

function cancelRequest(accessToken?: string) {
  return resilier(
    new Request("http://localhost:3000/api/resilier", {
      method: "POST",
      headers: accessToken ? { cookie: `sb_access_token=${accessToken}` } : {},
    }),
  );
}

function checkoutRequest(plan: string, accessToken: string) {
  const form = new URLSearchParams({ plan, consent: "on" });
  return checkout(
    new Request("http://localhost:3000/api/checkout", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: `sb_access_token=${accessToken}` },
      body: form.toString(),
    }),
  );
}

describe.skipIf(!ready)("second abonnement Pro", () => {
  it("un abonné Pro actif ne peut pas repayer un abonnement", async () => {
    const subscriber = await user("pro", 0);
    const response = await checkoutRequest("pro", subscriber.token);

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/offres?erreur=deja_pro");
    // Ni configuration de checkout, ni trace de consentement.
    const consents = await service(`/rest/v1/checkout_consents?user_id=eq.${subscriber.id}&select=id`);
    expect(consents.body).toEqual([]);
  });

  it("un abonné Pro actif peut toujours acheter une recharge", async () => {
    const subscriber = await user("pro", 0);
    const response = await checkoutRequest("pack", subscriber.token);

    // Le départ vers Whop dépend de l'API : seul compte ici le fait que la
    // demande n'est pas refusée pour cause d'abonnement en cours.
    expect(response.headers.get("location")).not.toBe("/offres?erreur=deja_pro");
    const consents = await service(`/rest/v1/checkout_consents?user_id=eq.${subscriber.id}&select=plan`);
    expect(consents.body).toEqual([{ plan: "pack" }]);
  });

  it("un Pro expiré peut reprendre un abonnement", async () => {
    const subscriber = await user("pro", 0);
    await service(`/rest/v1/credits?user_id=eq.${subscriber.id}`, {
      method: "PATCH",
      body: JSON.stringify({ period_end: "2026-09-01T05:37:47.007Z" }),
    });
    const response = await checkoutRequest("pro", subscriber.token);
    expect(response.headers.get("location")).not.toBe("/offres?erreur=deja_pro");
  });
});

describe.skipIf(!ready)("résiliation en ligne", () => {
  it("annule à la fin de la période et envoie la confirmation", async () => {
    const subscriber = await user("pro", 2);
    const membershipId = await seedActivation(subscriber.id);
    const endsAt = new Date(Date.now() + 15 * 24 * 3600 * 1000).toISOString();
    whop.cancel.mockResolvedValue({ id: membershipId, status: "canceling", cancel_at_period_end: true, renewal_period_end: endsAt });

    const response = await cancelRequest(subscriber.token);

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/resilier?etat=resilie");
    expect(whop.cancel).toHaveBeenCalledWith(membershipId);
    expect(mail.send).toHaveBeenCalledTimes(1);
    const [email] = mail.send.mock.calls[0];
    expect(email.to).toBe(subscriber.email);
    expect(email.text).toContain("Ta résiliation est enregistrée.");
    expect(email.text).toContain("Les crédits d'analyse achetés séparément restent acquis.");

    // L'accès reste ouvert : le plan ne bouge pas, la date de demande est posée.
    const credits = await service(
      `/rest/v1/credits?user_id=eq.${subscriber.id}&select=plan,balance,period_end,cancelled_at`,
    );
    const row = (credits.body as Array<{ plan: string; balance: number; period_end: string | null; cancelled_at: string | null }>)[0];
    expect(row.plan).toBe("pro");
    expect(row.balance).toBe(2);
    expect(row.cancelled_at).not.toBeNull();
    expect(new Date(row.period_end ?? 0).toISOString()).toBe(endsAt);
  });

  it("déjà résilié : aucun second appel au prestataire de paiement", async () => {
    const subscriber = await user("pro", 1);
    await seedActivation(subscriber.id);
    await service(`/rest/v1/credits?user_id=eq.${subscriber.id}`, {
      method: "PATCH",
      body: JSON.stringify({ cancelled_at: new Date().toISOString() }),
    });

    const response = await cancelRequest(subscriber.token);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/resilier?etat=deja");
    expect(whop.cancel).not.toHaveBeenCalled();
    expect(mail.send).not.toHaveBeenCalled();
  });

  it("abonnement Pro déjà expiré : plus rien à résilier", async () => {
    const subscriber = await user("pro", 0);
    await service(`/rest/v1/credits?user_id=eq.${subscriber.id}`, {
      method: "PATCH",
      body: JSON.stringify({ period_end: "2026-09-01T05:37:47.007Z" }),
    });

    const response = await cancelRequest(subscriber.token);
    expect(response.headers.get("location")).toBe("/resilier?etat=aucun");
    expect(whop.cancel).not.toHaveBeenCalled();
  });

  it("sans abonnement actif : message clair, aucun appel à Whop", async () => {
    const buyer = await user("pack", 3);
    const response = await cancelRequest(buyer.token);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/resilier?etat=aucun");
    expect(whop.cancel).not.toHaveBeenCalled();
    expect(mail.send).not.toHaveBeenCalled();
  });

  it("abonnement introuvable chez Whop : message clair, aucune annulation", async () => {
    const subscriber = await user("pro", 0);
    const response = await cancelRequest(subscriber.token);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/resilier?erreur=introuvable");
    expect(whop.cancel).not.toHaveBeenCalled();
  });

  it("refus de Whop : l'utilisateur est prévenu, aucun email de confirmation", async () => {
    const subscriber = await user("pro", 1);
    await seedActivation(subscriber.id);
    whop.cancel.mockResolvedValue(null);

    const response = await cancelRequest(subscriber.token);
    expect(response.headers.get("location")).toBe("/resilier?erreur=whop");
    expect(mail.send).not.toHaveBeenCalled();
  });

  it("visiteur non connecté : renvoyé vers la connexion", async () => {
    const response = await cancelRequest();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/connexion?next=%2Fresilier");
    expect(whop.cancel).not.toHaveBeenCalled();
  });
});
