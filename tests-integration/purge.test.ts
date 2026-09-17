import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { runPurge, type PurgeScope } from "@/lib/privacy/purge";
import { newStoragePath } from "@/lib/storage/documents";
import { configured, createUser, deleteUser, insert, service, SERVICE, URL_BASE, type TestUser } from "./helpers";

// Purge contre le vrai Supabase et le vrai stockage, qui sont ceux de la
// production. La purge est TOUJOURS appelée avec une portée : seules les
// lignes créées par ce fichier peuvent être supprimées. Ne jamais appeler
// runPurge() sans portée ici : cela purgerait les données des utilisateurs.

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

async function seedDocument(dealId: string, ageDays: number): Promise<{ id: string; path: string }> {
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
  const row = await insert("deal_documents", {
    deal_id: dealId,
    storage_path: path,
    mime: "image/png",
    bytes: png.byteLength,
    created_at: ago(ageDays),
    delete_after: new Date(Date.now() - (ageDays - 30) * DAY).toISOString(),
  });
  return { id: row.id, path };
}

async function seedUsageGuard(ageDays: number): Promise<string> {
  const row = await insert("usage_guard", { ip_hash: `test-${randomBytes(16).toString("hex")}`, count: 1, window_start: ago(ageDays) });
  cleanup.push(() => service(`/rest/v1/usage_guard?id=eq.${row.id}`, { method: "DELETE" }));
  return row.id;
}

async function seedWhopEvent(processedAgeDays: number | null, receivedAgeDays?: number): Promise<string> {
  const eventId = `msg_test_purge_${randomUUID()}`;
  await insert("whop_events", {
    event_id: eventId,
    type: "payment.succeeded",
    payload: { id: eventId, type: "payment.succeeded", data: {} },
    processed_at: processedAgeDays === null ? null : ago(processedAgeDays),
    ...(receivedAgeDays === undefined ? {} : { received_at: ago(receivedAgeDays) }),
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

// La colonne whop_events.received_at n'existe qu'après la migration 013.
async function receivedAtExists(): Promise<boolean> {
  return (await service("/rest/v1/whop_events?select=received_at&limit=1")).status === 200;
}

const hasReceivedAt = configured ? await receivedAtExists() : false;

describe.skipIf(!configured)("purge avec portée, contre la base de production", () => {
  it("supprime ce qui est échu dans la portée, garde le reste, ne touche ni aux deals ni aux analyses, rejouable", async () => {
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
    const thirtyDays = await seedDocument(deal.id, 30);
    const twentyEight = await seedDocument(deal.id, 28);
    const oldGuard = await seedUsageGuard(31);
    const recentGuard = await seedUsageGuard(1);
    const sixYears = await seedWhopEvent(6 * 365);
    const fourYears = await seedWhopEvent(4 * 365);
    const oldConsent = await seedConsent(user.id, 6 * 365);
    const recentConsent = await seedConsent(user.id, 4 * 365);
    expect(await objectStatus(thirtyDays.path)).toBe(200);

    const scope: PurgeScope = {
      documentIds: [thirtyDays.id, twentyEight.id],
      usageGuardIds: [oldGuard, recentGuard],
      whopEventIds: [sixYears, fourYears],
      consentIds: [oldConsent, recentConsent],
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const report = await runPurge(new Date(), scope);
    warn.mockRestore();
    expect(report).toEqual({ documents: 1, files_removed: 1, usage_guard: 1, whop_events: 1, checkout_consents: 1 });

    // Document de 30 jours : ligne ET fichier supprimés ; de 28 jours : intact.
    expect(await rows(`/rest/v1/deal_documents?id=eq.${thirtyDays.id}&select=id`)).toEqual([]);
    expect([400, 404]).toContain(await objectStatus(thirtyDays.path));
    expect(await rows(`/rest/v1/deal_documents?id=eq.${twentyEight.id}&select=id`)).toHaveLength(1);
    expect(await objectStatus(twentyEight.path)).toBe(200);

    expect(await rows(`/rest/v1/usage_guard?id=eq.${oldGuard}&select=id`)).toEqual([]);
    expect(await rows(`/rest/v1/usage_guard?id=eq.${recentGuard}&select=id`)).toHaveLength(1);
    expect(await rows(`/rest/v1/whop_events?event_id=eq.${sixYears}&select=event_id`)).toEqual([]);
    expect(await rows(`/rest/v1/whop_events?event_id=eq.${fourYears}&select=event_id`)).toHaveLength(1);
    expect(await rows(`/rest/v1/checkout_consents?id=eq.${oldConsent}&select=id`)).toEqual([]);
    expect(await rows(`/rest/v1/checkout_consents?id=eq.${recentConsent}&select=id`)).toHaveLength(1);

    expect(await rows(`/rest/v1/deals?id=eq.${deal.id}&select=id`)).toHaveLength(1);
    expect(await rows(`/rest/v1/analyses?id=eq.${analysis.id}&select=id`)).toHaveLength(1);

    const again = await runPurge(new Date(), scope);
    expect(again).toEqual({ documents: 0, files_removed: 0, usage_guard: 0, whop_events: 0, checkout_consents: 0 });
    expect(await rows(`/rest/v1/deals?id=eq.${deal.id}&select=id`)).toHaveLength(1);
    expect(await rows(`/rest/v1/analyses?id=eq.${analysis.id}&select=id`)).toHaveLength(1);
  });

  it("une ligne échue HORS de la portée n'est pas supprimée", async () => {
    const user = await createUser();
    users.push(user);
    const deal = await insert("deals", { user_id: user.id, source_type: "image", status: "analysed" });
    const inScope = await seedDocument(deal.id, 40);
    const outOfScope = await seedDocument(deal.id, 40);
    const guardOut = await seedUsageGuard(60);
    const eventOut = await seedWhopEvent(7 * 365);
    const consentOut = await seedConsent(user.id, 7 * 365);

    const report = await runPurge(new Date(), { documentIds: [inScope.id] });

    expect(report).toEqual({ documents: 1, files_removed: 1, usage_guard: 0, whop_events: 0, checkout_consents: 0 });
    expect(await rows(`/rest/v1/deal_documents?id=eq.${inScope.id}&select=id`)).toEqual([]);
    // Échus, mais hors portée : intacts, ligne comme fichier.
    expect(await rows(`/rest/v1/deal_documents?id=eq.${outOfScope.id}&select=id`)).toHaveLength(1);
    expect(await objectStatus(outOfScope.path)).toBe(200);
    expect(await rows(`/rest/v1/usage_guard?id=eq.${guardOut}&select=id`)).toHaveLength(1);
    expect(await rows(`/rest/v1/whop_events?event_id=eq.${eventOut}&select=event_id`)).toHaveLength(1);
    expect(await rows(`/rest/v1/checkout_consents?id=eq.${consentOut}&select=id`)).toHaveLength(1);
  });

  it.skipIf(!hasReceivedAt)("événement Whop jamais traité, reçu il y a 6 ans : purgé via received_at", async () => {
    const unprocessedOld = await seedWhopEvent(null, 6 * 365);
    const unprocessedRecent = await seedWhopEvent(null, 1);
    const report = await runPurge(new Date(), { whopEventIds: [unprocessedOld, unprocessedRecent] });
    expect(report.whop_events).toBe(1);
    expect(await rows(`/rest/v1/whop_events?event_id=eq.${unprocessedOld}&select=event_id`)).toEqual([]);
    expect(await rows(`/rest/v1/whop_events?event_id=eq.${unprocessedRecent}&select=event_id`)).toHaveLength(1);
  });

  it.skipIf(hasReceivedAt)("avant la migration 013 : la purge ne casse pas et le signale", async () => {
    const unprocessed = await seedWhopEvent(null);
    const processedOld = await seedWhopEvent(6 * 365);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const report = await runPurge(new Date(), { whopEventIds: [unprocessed, processedOld] });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("purge_whop_received_at_missing"));
    warn.mockRestore();
    expect(report.whop_events).toBe(1);
    expect(await rows(`/rest/v1/whop_events?event_id=eq.${unprocessed}&select=event_id`)).toHaveLength(1);
  });
});
