import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { newStoragePath } from "@/lib/storage/documents";
import { configured, createUser, deleteUser, insert, seedAnalysedDeal, service, SERVICE, URL_BASE, type TestUser } from "./helpers";

// Suppression de compte, de bout en bout : base, stockage et auth réels.
// L'envoi d'email est remplacé par un espion.
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

const { POST: supprimer } = await import("@/app/api/compte/supprimer/route");
const { getRequestUser } = await import("@/lib/auth/request-user");

const users: TestUser[] = [];
const events: string[] = [];
const consents: string[] = [];

afterAll(async () => {
  for (const user of users) await deleteUser(user);
  for (const id of events) await service(`/rest/v1/whop_events?event_id=eq.${encodeURIComponent(id)}`, { method: "DELETE" });
  for (const id of consents) await service(`/rest/v1/checkout_consents?id=eq.${id}`, { method: "DELETE" });
});

// Accolades : une fonction renvoyée par beforeEach serait appelée comme nettoyage.
beforeEach(() => {
  mail.send.mockClear();
});

async function account(plan: "free" | "pack" | "pro", balance: number, options: { cancelled?: boolean } = {}): Promise<TestUser> {
  const created = await createUser();
  users.push(created);
  await insert("profiles", { id: created.id, email: created.email });
  await insert("credits", {
    user_id: created.id,
    balance,
    plan,
    period_end: plan === "pro" ? new Date(Date.now() + 15 * 24 * 3600 * 1000).toISOString() : null,
    cancelled_at: options.cancelled ? new Date().toISOString() : null,
  });
  return created;
}

function deleteRequest(accessToken: string, confirmation = "SUPPRIMER") {
  return supprimer(
    new Request("http://localhost:3000/api/compte/supprimer", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: `sb_access_token=${accessToken}` },
      body: new URLSearchParams({ confirmation }).toString(),
    }),
  );
}

// Fichier PNG réellement déposé dans le bucket privé, rattaché à un deal du compte.
async function seedDocument(userId: string): Promise<string> {
  const deal = await insert("deals", { user_id: userId, source_type: "image", status: "analysed" });
  const path = newStoragePath("image/png");
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const uploaded = await fetch(`${URL_BASE}/storage/v1/object/deal-documents/${path}`, {
    method: "POST",
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "image/png" },
    body: png,
  });
  expect(uploaded.status, "dépôt du fichier de test").toBe(200);
  await insert("deal_documents", { deal_id: deal.id, storage_path: path, mime: "image/png", bytes: png.byteLength });
  return path;
}

async function objectStatus(path: string): Promise<number> {
  const response = await fetch(`${URL_BASE}/storage/v1/object/deal-documents/${path}`, {
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  });
  await response.arrayBuffer();
  return response.status;
}

async function seedWhopEvent(userId: string): Promise<string> {
  const eventId = `msg_test_${randomUUID()}`;
  events.push(eventId);
  await insert("whop_events", {
    event_id: eventId,
    type: "payment.succeeded",
    payload: { id: eventId, type: "payment.succeeded", data: { metadata: { user_id: userId } } },
    processed_at: new Date().toISOString(),
  });
  return eventId;
}

async function rows(path: string): Promise<unknown[]> {
  const result = await service(path);
  expect(result.status).toBe(200);
  return result.body as unknown[];
}

async function authUserStatus(userId: string): Promise<number> {
  return (await service(`/auth/v1/admin/users/${userId}`)).status;
}

describe.skipIf(!configured)("suppression de compte", () => {
  it("refusée sans le mot de confirmation : rien n'est supprimé", async () => {
    const user = await account("pack", 2);
    const response = await deleteRequest(user.token, "oui");
    expect(response.headers.get("location")).toBe("/compte/supprimer?erreur=confirmation");
    expect(await authUserStatus(user.id)).toBe(200);
    expect(await rows(`/rest/v1/credits?user_id=eq.${user.id}&select=balance`)).toEqual([{ balance: 2 }]);
  });

  it("refusée tant que l'abonnement Pro est actif : renvoi vers la résiliation", async () => {
    const subscriber = await account("pro", 1);
    const { dealId } = await seedAnalysedDeal({ userId: subscriber.id });

    const response = await deleteRequest(subscriber.token);

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/resilier?motif=suppression");
    expect(await authUserStatus(subscriber.id)).toBe(200);
    expect(await rows(`/rest/v1/deals?id=eq.${dealId}&select=id`)).toHaveLength(1);
    expect(await rows(`/rest/v1/credits?user_id=eq.${subscriber.id}&select=plan`)).toEqual([{ plan: "pro" }]);
    expect(mail.send).not.toHaveBeenCalled();
  });

  it("supprime identité, profil, deals, documents et fichiers, analyses, crédits ; conserve whop_events", async () => {
    const user = await account("pack", 2);
    const { dealId, analysisId } = await seedAnalysedDeal({ userId: user.id });
    const path = await seedDocument(user.id);
    const eventId = await seedWhopEvent(user.id);
    expect(await objectStatus(path)).toBe(200);
    expect(await getRequestUser(new Request("http://localhost", { headers: { cookie: `sb_access_token=${user.token}` } }))).not.toBeNull();

    const response = await deleteRequest(user.token);

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/compte/supprime");
    const cookies = response.headers.getSetCookie();
    expect(cookies.some((c) => c.startsWith("sb_access_token=;") && c.includes("Max-Age=0"))).toBe(true);
    expect(cookies.some((c) => c.startsWith("sb_refresh_token=;") && c.includes("Max-Age=0"))).toBe(true);
    // Indicateur d'affichage effacé aussi : l'en-tête repasse à « Se connecter ».
    expect(cookies.some((c) => c.startsWith("ns_session=;") && c.includes("Max-Age=0"))).toBe(true);

    expect(await authUserStatus(user.id)).toBe(404);
    expect(await rows(`/rest/v1/profiles?id=eq.${user.id}&select=id`)).toEqual([]);
    expect(await rows(`/rest/v1/deals?user_id=eq.${user.id}&select=id`)).toEqual([]);
    expect(await rows(`/rest/v1/deals?id=eq.${dealId}&select=id`)).toEqual([]);
    expect(await rows(`/rest/v1/analyses?id=eq.${analysisId}&select=id`)).toEqual([]);
    expect(await rows(`/rest/v1/deal_documents?storage_path=eq.${encodeURIComponent(path)}&select=id`)).toEqual([]);
    expect(await rows(`/rest/v1/credits?user_id=eq.${user.id}&select=user_id`)).toEqual([]);
    // Le fichier lui-même n'existe plus dans le stockage, pas seulement sa référence.
    expect([400, 404]).toContain(await objectStatus(path));
    // Transaction commerciale conservée.
    expect(await rows(`/rest/v1/whop_events?event_id=eq.${eventId}&select=event_id`)).toHaveLength(1);

    // La session encore en circulation ne donne plus accès à rien.
    expect(await getRequestUser(new Request("http://localhost", { headers: { cookie: `sb_access_token=${user.token}` } }))).toBeNull();
    const refused = await deleteRequest(user.token);
    expect(refused.headers.get("location")).toBe(`/connexion?next=${encodeURIComponent("/compte/supprimer")}`);

    expect(mail.send).toHaveBeenCalledTimes(1);
    const [email] = mail.send.mock.calls[0];
    expect(email.to).toBe(user.email);
    expect(email.text).toContain("Ton compte est supprimé.");
  });

  it("abonnement Pro déjà résilié : la suppression est acceptée", async () => {
    const subscriber = await account("pro", 0, { cancelled: true });
    const response = await deleteRequest(subscriber.token);
    expect(response.headers.get("location")).toBe("/compte/supprime");
    expect(await authUserStatus(subscriber.id)).toBe(404);
  });

  it("preuves de consentement au paiement : jamais perdues", async () => {
    const buyer = await account("pack", 3);
    const consent = await insert("checkout_consents", {
      user_id: buyer.id,
      plan: "pack",
      consent_version: "test",
      consent_text: "consentement de test",
    });
    consents.push(consent.id);

    const response = await deleteRequest(buyer.token);
    const location = response.headers.get("location");

    if (location === "/compte/supprime") {
      // Migration 012 appliquée : compte supprimé, preuve conservée.
      expect(await authUserStatus(buyer.id)).toBe(404);
    } else {
      // Migration 012 absente : la base supprimerait la preuve avec l'identité,
      // la suppression est refusée et rien n'est touché.
      console.warn("Migration 20260917000012 non appliquée : suppression refusée pour un compte avec consentements.");
      expect(location).toBe("/compte/supprimer?erreur=indisponible");
      expect(await authUserStatus(buyer.id)).toBe(200);
      expect(await rows(`/rest/v1/credits?user_id=eq.${buyer.id}&select=balance`)).toEqual([{ balance: 3 }]);
    }
    expect(await rows(`/rest/v1/checkout_consents?id=eq.${consent.id}&select=id`)).toHaveLength(1);
  });
});
