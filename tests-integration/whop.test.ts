import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { signWebhook } from "@/lib/whop/webhook";
import { configured, createUser, deleteUser, insert, service, type TestUser } from "./helpers";

// Webhooks Whop contre la vraie base : charges fabriquées et signées ici,
// jamais un achat réel. La mesure d'audience est neutralisée.

// L'email de confirmation est intercepté : aucun envoi réel pendant les tests.
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

const { POST: webhook } = await import("@/app/api/whop/webhook/route");

const SECRET = process.env.WHOP_WEBHOOK_SECRET ?? "";
const PACK = process.env.WHOP_PLAN_PACK ?? "";
const PRO = process.env.WHOP_PLAN_PRO ?? "";
const ready = configured && Boolean(SECRET && PACK && PRO);

const users: TestUser[] = [];
const events: string[] = [];

afterAll(async () => {
  for (const user of users) await deleteUser(user);
  for (const id of events) await service(`/rest/v1/whop_events?event_id=eq.${encodeURIComponent(id)}`, { method: "DELETE" });
});

async function user(plan: "free" | "pack" | "pro", balance = 0): Promise<TestUser> {
  const created = await createUser();
  users.push(created);
  await insert("profiles", { id: created.id, email: created.email });
  await insert("credits", { user_id: created.id, balance, plan });
  return created;
}

type CreditsRow = { plan: string; balance: number; period_end: string | null; cancelled_at: string | null };

async function credits(userId: string): Promise<CreditsRow> {
  const res = await service(`/rest/v1/credits?user_id=eq.${userId}&select=plan,balance,period_end,cancelled_at`);
  return (res.body as CreditsRow[])[0];
}

async function setCredits(userId: string, patch: Record<string, unknown>): Promise<void> {
  await service(`/rest/v1/credits?user_id=eq.${userId}`, { method: "PATCH", body: JSON.stringify(patch) });
}

// Charge utile réellement observée en production le 16/09/2026 : Whop coupe
// l'abonnement tout de suite (status "canceled", cancel_at_period_end "false")
// alors qu'on a demandé la fin de période.
function deactivation(renewalPeriodEnd: string | null, userId: string, status = "canceled") {
  return {
    id: `mem_${randomUUID()}`,
    status,
    cancel_at_period_end: "false",
    plan: { id: PRO },
    metadata: { user_id: userId },
    ...(renewalPeriodEnd ? { renewal_period_end: renewalPeriodEnd } : {}),
  };
}

function envelope(type: string, data: Record<string, unknown>, id = `msg_test_${randomUUID()}`) {
  events.push(id);
  return { id, type, api_version: "v1", api_version_date: "2026-08-14", timestamp: new Date().toISOString(), data };
}

function send(event: Record<string, unknown>, { secret = SECRET } = {}) {
  const raw = JSON.stringify(event);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = signWebhook(raw, String(event.id), timestamp, secret);
  return webhook(
    new Request("http://localhost:3000/api/whop/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "webhook-id": String(event.id),
        "webhook-timestamp": timestamp,
        "webhook-signature": signature,
      },
      body: raw,
    }),
  );
}

function payment(planId: string, metadata: Record<string, string> | null, email?: string) {
  return {
    id: `pay_${randomUUID()}`,
    total: 4.99,
    currency: "eur",
    plan: { id: planId },
    metadata,
    user: email ? { id: "user_whop", email } : null,
  };
}

describe.skipIf(!ready)("webhook Whop", () => {
  it("refuse une requête non signée ou mal signée, sans rien écrire", async () => {
    const event = envelope("payment.succeeded", payment(PACK, { user_id: randomUUID() }));
    const raw = JSON.stringify(event);

    const unsigned = await webhook(new Request("http://localhost:3000/api/whop/webhook", { method: "POST", body: raw }));
    expect(unsigned.status).toBe(401);

    const wrongSecret = await send(event, { secret: "ws_mauvais_secret" });
    expect(wrongSecret.status).toBe(401);

    const stored = await service(`/rest/v1/whop_events?event_id=eq.${encodeURIComponent(event.id)}&select=event_id`);
    expect(stored.body).toEqual([]);
  });

  it("rejoué dix fois, le même event_id ne crédite qu'une fois et n'envoie qu'un email", async () => {
    mail.send.mockClear();
    const buyer = await user("free");
    const event = envelope("payment.succeeded", payment(PACK, { user_id: buyer.id }));

    const first = await send(event);
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ received: true, handled: true });

    for (let i = 0; i < 9; i++) {
      const replay = await send(event);
      expect(replay.status).toBe(200);
      expect(await replay.json()).toMatchObject({ duplicate: true });
    }

    expect(await credits(buyer.id)).toMatchObject({ balance: 3, plan: "pack" });
    expect(mail.send).toHaveBeenCalledTimes(1);
    const rows = await service(
      `/rest/v1/whop_events?event_id=eq.${encodeURIComponent(event.id)}&select=event_id,processed_at`,
    );
    expect((rows.body as unknown[]).length).toBe(1);
    expect((rows.body as Array<{ processed_at: string | null }>)[0].processed_at).not.toBeNull();
  });

  // Mission #142 — le revenu était mesuré DEUX fois : dans product_events,
  // que lit le cockpit, et dans PostHog, que personne ne lisait. La seconde
  // est partie avec la bibliothèque. Ce test garde la première.
  it("le pack s'ajoute au solde existant", async () => {
    const buyer = await user("pack", 2);
    await send(envelope("payment.succeeded", payment(PACK, { user_id: buyer.id })));
    expect(await credits(buyer.id)).toMatchObject({ balance: 5, plan: "pack" });
  });

  it("pack acheté sur un Pro expiré : le compte redevient Pack", async () => {
    const buyer = await user("pro", 0);
    await setCredits(buyer.id, { period_end: "2026-09-01T05:37:47.007Z", cancelled_at: "2026-09-16T05:38:36.000Z" });

    await send(envelope("payment.succeeded", payment(PACK, { user_id: buyer.id })));
    expect(await credits(buyer.id)).toMatchObject({ plan: "pack", balance: 3, period_end: null, cancelled_at: null });
  });

  it("pack acheté sur un Pro actif : l'abonnement est préservé", async () => {
    const buyer = await user("pro", 1);
    const periodEnd = new Date(Date.now() + 10 * 24 * 3600 * 1000).toISOString();
    await setCredits(buyer.id, { period_end: periodEnd });

    await send(envelope("payment.succeeded", payment(PACK, { user_id: buyer.id })));
    const after = await credits(buyer.id);
    expect(after.plan).toBe("pro");
    expect(after.balance).toBe(4);
    expect(new Date(after.period_end ?? 0).toISOString()).toBe(periodEnd);
  });

  it("rattache par l'email quand les metadata manquent", async () => {
    const buyer = await user("free");
    await send(envelope("payment.succeeded", payment(PACK, null, buyer.email.toUpperCase())));
    expect(await credits(buyer.id)).toMatchObject({ balance: 3, plan: "pack" });
  });

  it("un remboursement retire les crédits sans passer sous zéro", async () => {
    const buyer = await user("pack", 2);
    const refund = (id: string) => ({ id, amount: 4.99, currency: "eur", payment: payment(PACK, { user_id: buyer.id }) });

    await send(envelope("refund.created", refund(`ref_${randomUUID()}`)));
    expect(await credits(buyer.id)).toMatchObject({ balance: 0, plan: "free" });

    await send(envelope("refund.created", refund(`ref_${randomUUID()}`)));
    expect(await credits(buyer.id)).toMatchObject({ balance: 0 });
  });

  it("Pro activé puis désactivé : les crédits pack restent acquis", async () => {
    const buyer = await user("pack", 2);
    const periodEnd = new Date(Date.now() + 20 * 24 * 3600 * 1000).toISOString();
    await send(
      envelope("membership.activated", {
        id: `mem_${randomUUID()}`,
        status: "active",
        plan: { id: PRO },
        metadata: { user_id: buyer.id },
        renewal_period_end: periodEnd,
      }),
    );
    const activated = await credits(buyer.id);
    expect(activated.plan).toBe("pro");
    expect(activated.balance).toBe(2);
    expect(new Date(activated.period_end ?? 0).toISOString()).toBe(periodEnd);

    await send(
      envelope("membership.deactivated", {
        id: `mem_${randomUUID()}`,
        status: "expired",
        plan: { id: PRO },
        metadata: { user_id: buyer.id },
      }),
    );
    expect(await credits(buyer.id)).toMatchObject({ plan: "pack", balance: 2, period_end: null });
  });

  it("résiliation Whop immédiate : l'accès Pro payé est conservé jusqu'à la fin de période", async () => {
    const subscriber = await user("pro", 2);
    const paidUntil = "2026-10-16T05:37:47.007Z";
    await setCredits(subscriber.id, { period_end: paidUntil, cancelled_at: null });

    const response = await send(envelope("membership.deactivated", deactivation(paidUntil, subscriber.id)));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ handled: true });

    const after = await credits(subscriber.id);
    expect(after.plan).toBe("pro");
    expect(new Date(after.period_end ?? 0).toISOString()).toBe(paidUntil);
    expect(after.cancelled_at).not.toBeNull();
    expect(after.balance).toBe(2);
  });

  it("n'écrase pas la date de résiliation déjà enregistrée", async () => {
    const subscriber = await user("pro", 0);
    const paidUntil = "2026-10-16T05:37:47.007Z";
    const firstRequest = "2026-09-16T05:38:36.000Z";
    await setCredits(subscriber.id, { period_end: paidUntil, cancelled_at: firstRequest });

    await send(envelope("membership.deactivated", deactivation(paidUntil, subscriber.id)));
    const after = await credits(subscriber.id);
    expect(new Date(after.cancelled_at ?? 0).toISOString()).toBe(firstRequest);
    expect(after.plan).toBe("pro");
  });

  it("période déjà terminée : déclassement immédiat", async () => {
    const subscriber = await user("pro", 1);
    const over = "2026-09-01T05:37:47.007Z";
    await setCredits(subscriber.id, { period_end: over });

    await send(envelope("membership.deactivated", deactivation(over, subscriber.id)));
    expect(await credits(subscriber.id)).toMatchObject({ plan: "pack", balance: 1, period_end: null });
  });

  it("statut autre que canceled : déclassement immédiat", async () => {
    const subscriber = await user("pro", 0);
    const paidUntil = "2026-10-16T05:37:47.007Z";
    await setCredits(subscriber.id, { period_end: paidUntil });

    await send(envelope("membership.deactivated", deactivation(paidUntil, subscriber.id, "expired")));
    expect(await credits(subscriber.id)).toMatchObject({ plan: "free", period_end: null });
  });

  it("remboursement après résiliation : accès coupé tout de suite, résiliation effacée", async () => {
    const subscriber = await user("pro", 0);
    await setCredits(subscriber.id, {
      period_end: "2026-10-16T05:37:47.007Z",
      cancelled_at: "2026-09-16T05:38:36.000Z",
    });

    await send(
      envelope("refund.created", {
        id: `ref_${randomUUID()}`,
        amount: 12.99,
        currency: "eur",
        payment: { ...payment(PRO, { user_id: subscriber.id }), total: 12.99 },
      }),
    );
    expect(await credits(subscriber.id)).toMatchObject({ plan: "free", period_end: null, cancelled_at: null });
  });

  it("réabonnement : la résiliation précédente est effacée", async () => {
    const subscriber = await user("pro", 0);
    await setCredits(subscriber.id, { cancelled_at: "2026-09-16T05:38:36.000Z" });
    const periodEnd = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();

    await send(
      envelope("membership.activated", {
        id: `mem_${randomUUID()}`,
        status: "active",
        plan: { id: PRO },
        metadata: { user_id: subscriber.id },
        renewal_period_end: periodEnd,
      }),
    );
    const after = await credits(subscriber.id);
    expect(after).toMatchObject({ plan: "pro", cancelled_at: null });
    expect(new Date(after.period_end ?? 0).toISOString()).toBe(periodEnd);
  });

  it("Pro désactivé sans crédit pack : retour au plan gratuit", async () => {
    const buyer = await user("pro", 0);
    await send(
      envelope("membership.deactivated", { id: `mem_${randomUUID()}`, plan: { id: PRO }, metadata: { user_id: buyer.id } }),
    );
    expect(await credits(buyer.id)).toMatchObject({ plan: "free", balance: 0 });
  });

  it("l'email de confirmation part une fois, avec le contenu attendu", async () => {
    mail.send.mockClear();
    const buyer = await user("free");
    await send(envelope("payment.succeeded", payment(PACK, { user_id: buyer.id })));

    expect(mail.send).toHaveBeenCalledTimes(1);
    const [email, context] = mail.send.mock.calls[0];
    expect(email.to).toBe(buyer.email);
    expect(email.subject).toBe("Confirmation de ton achat Negoscore");
    expect(email.text).toContain("Ton paiement est confirmé.");
    expect(email.text).toContain("Offre : Pack Deal");
    expect(email.text).toContain("Ce que tu as obtenu : 3 analyses ajoutées à ton compte");
    expect(email.text).toContain("Cet email constitue la confirmation de cet accord.");
    expect(context).toMatchObject({ kind: "purchase_confirmation" });
  });

  it("un échec d'envoi d'email ne bloque pas le crédit", async () => {
    mail.send.mockClear();
    mail.send.mockRejectedValueOnce(new Error("resend indisponible"));
    const buyer = await user("free");

    const response = await send(envelope("payment.succeeded", payment(PACK, { user_id: buyer.id })));
    expect(response.status).toBe(200);
    expect(mail.send).toHaveBeenCalledTimes(1);
    expect(await credits(buyer.id)).toMatchObject({ balance: 3, plan: "pack" });
  });

  it("une résiliation d'abonnement n'envoie aucun email d'achat", async () => {
    mail.send.mockClear();
    const buyer = await user("pro", 2);
    await send(
      envelope("membership.deactivated", { id: `mem_${randomUUID()}`, plan: { id: PRO }, metadata: { user_id: buyer.id } }),
    );
    expect(mail.send).not.toHaveBeenCalled();
    expect(await credits(buyer.id)).toMatchObject({ plan: "pack", balance: 2 });
  });

  it("paiement échoué et plan inconnu : aucun crédit", async () => {
    const buyer = await user("free");
    await send(envelope("payment.failed", payment(PACK, { user_id: buyer.id })));
    expect(await credits(buyer.id)).toMatchObject({ balance: 0, plan: "free" });

    const unknown = await send(envelope("payment.succeeded", payment("plan_inconnu", { user_id: buyer.id })));
    expect(await unknown.json()).toMatchObject({ handled: false });
    expect(await credits(buyer.id)).toMatchObject({ balance: 0, plan: "free" });
  });
});
