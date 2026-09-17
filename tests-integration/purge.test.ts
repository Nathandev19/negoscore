import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { runPurge } from "@/lib/privacy/purge";
import { newStoragePath } from "@/lib/storage/documents";
import { configured, createUser, deleteUser, insert, service, SERVICE, URL_BASE, type TestUser } from "./helpers";

// Purge réelle contre le projet Supabase configuré. Elle s'applique à toute la
// base, exactement comme l'appel quotidien de Vercel Cron : seules des données
// dont la durée de conservation est écoulée sont supprimées.

const DAY = 24 * 3600 * 1000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();

const users: TestUser[] = [];
const cleanup: Array<() => Promise<unknown>> = [];

afterAll(async () => {
  for (const undo of cleanup.reverse()) await undo();
  for (const user of users) await deleteUser(user);
});

async function rows(path: string): Promise<unknown[]> {
  const result = await service(path);
  expect(result.status).toBe(200);
  return result.body as unknown[];
}

async function objectStatus(path: string): Promise<number> {
  const response = await fetch(`${URL_BASE}/storage/v1/object/deal-documents/${path}`, {
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  });
  await response.arrayBuffer();
  return response.status;
}

async function seedDocument(dealId: string, ageDays: number): Promise<string> {
  const path = newStoragePath("image/png");
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
  const uploaded = await fetch(`${URL_BASE}/storage/v1/object/deal-documents/${path}`, {
    method: "POST",
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "image/png" },
    body: png,
  });
  expect(uploaded.status, "dépôt du fichier de test").toBe(200);
  cleanup.push(() =>
    fetch(`${URL_BASE}/storage/v1/object/deal-documents`, {
      method: "DELETE",
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" },
      body: JSON.stringify({ prefixes: [path] }),
    }),
  );
  await insert("deal_documents", {
    deal_id: dealId,
    storage_path: path,
    mime: "image/png",
    bytes: png.byteLength,
    created_at: ago(ageDays),
    delete_after: new Date(Date.now() - (ageDays - 30) * DAY).toISOString(),
  });
  return path;
}

async function seedUsageGuard(ageDays: number): Promise<string> {
  const row = await insert("usage_guard", { ip_hash: `test-${randomBytes(16).toString("hex")}`, count: 1, window_start: ago(ageDays) });
  cleanup.push(() => service(`/rest/v1/usage_guard?id=eq.${row.id}`, { method: "DELETE" }));
  return row.id;
}

async function seedWhopEvent(ageDays: number): Promise<string> {
  const eventId = `msg_test_purge_${randomUUID()}`;
  await insert("whop_events", {
    event_id: eventId,
    type: "payment.succeeded",
    payload: { id: eventId, type: "payment.succeeded", data: {} },
    processed_at: ago(ageDays),
  });
  cleanup.push(() => service(`/rest/v1/whop_events?event_id=eq.${eventId}`, { method: "DELETE" }));
  return eventId;
}

async function seedConsent(userId: string, ageDays: number): Promise<string> {
  const row = await insert("checkout_consents", {
    user_id: userId,
    plan: "pack",
    consent_version: "test",
    consent_text: "consentement de test",
    accepted_at: ago(ageDays),
    created_at: ago(ageDays),
  });
  cleanup.push(() => service(`/rest/v1/checkout_consents?id=eq.${row.id}`, { method: "DELETE" }));
  return row.id;
}

describe.skipIf(!configured)("purge des données dont la durée de conservation est écoulée", () => {
  it("supprime ce qui est échu, garde le reste, ne touche ni aux deals ni aux analyses, et peut être rejouée", async () => {
    const user = await createUser();
    users.push(user);

    // Deal et analyse anciens : la purge ne doit jamais les supprimer.
    const deal = await insert("deals", { user_id: user.id, source_type: "image", status: "analysed", created_at: ago(400) });
    const analysis = await insert("analyses", {
      deal_id: deal.id,
      model: "test",
      prompt_version: "test",
      rate_table_version: "test",
      payload: { test: true },
      created_at: ago(400),
    });
    const oldPath = await seedDocument(deal.id, 31);
    const recentPath = await seedDocument(deal.id, 29);
    const oldGuard = await seedUsageGuard(31);
    const recentGuard = await seedUsageGuard(1);
    const sixYears = await seedWhopEvent(6 * 365);
    const fourYears = await seedWhopEvent(4 * 365);
    const oldConsent = await seedConsent(user.id, 6 * 365);
    const recentConsent = await seedConsent(user.id, 4 * 365);
    expect(await objectStatus(oldPath)).toBe(200);

    const report = await runPurge();
    expect(report.documents).toBeGreaterThanOrEqual(1);
    expect(report.files_removed).toBeGreaterThanOrEqual(1);
    expect(report.usage_guard).toBeGreaterThanOrEqual(1);
    expect(report.whop_events).toBeGreaterThanOrEqual(1);
    expect(report.checkout_consents).toBeGreaterThanOrEqual(1);

    // Document de 31 jours : ligne ET fichier supprimés.
    expect(await rows(`/rest/v1/deal_documents?storage_path=eq.${encodeURIComponent(oldPath)}&select=id`)).toEqual([]);
    expect([400, 404]).toContain(await objectStatus(oldPath));
    // Document de 29 jours : intact.
    expect(await rows(`/rest/v1/deal_documents?storage_path=eq.${encodeURIComponent(recentPath)}&select=id`)).toHaveLength(1);
    expect(await objectStatus(recentPath)).toBe(200);

    expect(await rows(`/rest/v1/usage_guard?id=eq.${oldGuard}&select=id`)).toEqual([]);
    expect(await rows(`/rest/v1/usage_guard?id=eq.${recentGuard}&select=id`)).toHaveLength(1);

    expect(await rows(`/rest/v1/whop_events?event_id=eq.${sixYears}&select=event_id`)).toEqual([]);
    expect(await rows(`/rest/v1/whop_events?event_id=eq.${fourYears}&select=event_id`)).toHaveLength(1);
    expect(await rows(`/rest/v1/checkout_consents?id=eq.${oldConsent}&select=id`)).toEqual([]);
    expect(await rows(`/rest/v1/checkout_consents?id=eq.${recentConsent}&select=id`)).toHaveLength(1);

    // Jamais de deal ni d'analyse supprimés.
    expect(await rows(`/rest/v1/deals?id=eq.${deal.id}&select=id`)).toHaveLength(1);
    expect(await rows(`/rest/v1/analyses?id=eq.${analysis.id}&select=id`)).toHaveLength(1);

    // Idempotente : un second passage ne casse rien et ne trouve plus nos données échues.
    const again = await runPurge();
    expect(again).toMatchObject({ documents: 0, files_removed: 0, whop_events: 0, checkout_consents: 0 });
    expect(await rows(`/rest/v1/deal_documents?storage_path=eq.${encodeURIComponent(recentPath)}&select=id`)).toHaveLength(1);
    expect(await rows(`/rest/v1/deals?id=eq.${deal.id}&select=id`)).toHaveLength(1);
    expect(await rows(`/rest/v1/analyses?id=eq.${analysis.id}&select=id`)).toHaveLength(1);
  });
});
