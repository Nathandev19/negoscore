import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashIp } from "@/lib/security/request";
import { hitUsageGuard } from "@/lib/security/usage-guard";
import { newStoragePath } from "@/lib/storage/documents";
import { createSignedUploadUrl, downloadDocument, removeDocument } from "@/lib/supabase/server";

// Tests contre le vrai projet Supabase. Les deux comptes de test sont créés
// avec des mots de passe aléatoires gardés en mémoire, puis supprimés.

const URL_BASE = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const configured = Boolean(URL_BASE && ANON && SERVICE);

type User = { id: string; token: string };

async function call(path: string, key: string, init: RequestInit & { token?: string } = {}) {
  const response = await fetch(`${URL_BASE}${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${init.token ?? key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...init.headers,
    },
  });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

const service = (path: string, init: RequestInit = {}) => call(path, SERVICE, init);
const asUser = (user: User, path: string, init: RequestInit = {}) => call(path, ANON, { ...init, token: user.token });

async function createUser(): Promise<User> {
  const email = `rls-${randomUUID()}@example.com`;
  const password = randomBytes(24).toString("base64url");
  const created = await service("/auth/v1/admin/users", {
    method: "POST",
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  expect(created.status, "création du compte de test").toBe(200);
  const id = (created.body as { id: string }).id;
  const session = await call("/auth/v1/token?grant_type=password", ANON, {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  expect(session.status, "connexion du compte de test").toBe(200);
  return { id, token: (session.body as { access_token: string }).access_token };
}

type Seed = { dealId: string; documentId: string; analysisId: string };

async function seed(userId: string | null, anonToken: string | null): Promise<Seed> {
  const deal = await service("/rest/v1/deals", {
    method: "POST",
    body: JSON.stringify({ user_id: userId, anon_token: anonToken, source_type: "text", raw_text: "offre de test", status: "analysed" }),
  });
  expect(deal.status).toBe(201);
  const dealId = (deal.body as Array<{ id: string }>)[0].id;
  const document = await service("/rest/v1/deal_documents", {
    method: "POST",
    body: JSON.stringify({ deal_id: dealId, storage_path: newStoragePath("image/png"), mime: "image/png", bytes: 10 }),
  });
  expect(document.status).toBe(201);
  const analysis = await service("/rest/v1/analyses", {
    method: "POST",
    body: JSON.stringify({
      deal_id: dealId,
      model: "test",
      prompt_version: "test",
      rate_table_version: "test",
      payload: { secret: `contrat-${dealId}` },
      score: 50,
      confidence: "low",
    }),
  });
  expect(analysis.status).toBe(201);
  if (userId) {
    expect((await service("/rest/v1/profiles", { method: "POST", body: JSON.stringify({ id: userId, email: "test" }) })).status).toBe(201);
    expect((await service("/rest/v1/credits", { method: "POST", body: JSON.stringify({ user_id: userId, balance: 3 }) })).status).toBe(201);
  }
  return {
    dealId,
    documentId: (document.body as Array<{ id: string }>)[0].id,
    analysisId: (analysis.body as Array<{ id: string }>)[0].id,
  };
}

function ids(body: unknown, key = "id"): string[] {
  return Array.isArray(body) ? body.map((row) => (row as Record<string, string>)[key]) : [];
}

describe.skipIf(!configured)("RLS : isolation entre comptes", () => {
  let a: User;
  let b: User;
  let seedA: Seed;
  let seedB: Seed;
  let seedAnon: Seed;

  beforeAll(async () => {
    a = await createUser();
    b = await createUser();
    seedA = await seed(a.id, null);
    seedB = await seed(b.id, null);
    seedAnon = await seed(null, randomBytes(32).toString("base64url"));
  });

  afterAll(async () => {
    // La suppression des comptes supprime leurs lignes en cascade.
    for (const user of [a, b]) if (user) await service(`/auth/v1/admin/users/${user.id}`, { method: "DELETE" });
    if (seedAnon) await service(`/rest/v1/deals?id=eq.${seedAnon.dealId}`, { method: "DELETE" });
  });

  it("A ne voit que ses propres lignes, table par table", async () => {
    const checks: Array<[string, string, string, string[]]> = [
      ["profiles", "id", a.id, [b.id]],
      ["deals", "id", seedA.dealId, [seedB.dealId, seedAnon.dealId]],
      ["deal_documents", "id", seedA.documentId, [seedB.documentId, seedAnon.documentId]],
      ["analyses", "id", seedA.analysisId, [seedB.analysisId, seedAnon.analysisId]],
      ["credits", "user_id", a.id, [b.id]],
    ];
    for (const [table, key, own, foreign] of checks) {
      const res = await asUser(a, `/rest/v1/${table}?select=*`);
      expect(res.status, table).toBe(200);
      const seen = ids(res.body, key);
      expect(seen, `${table} : A voit sa ligne`).toEqual([own]);
      for (const id of foreign) expect(seen, `${table} : ligne étrangère visible`).not.toContain(id);
    }
  });

  it("A ne lit pas la ligne de B même en la ciblant par son id", async () => {
    expect((await asUser(a, `/rest/v1/deals?id=eq.${seedB.dealId}`)).body).toEqual([]);
    expect((await asUser(a, `/rest/v1/analyses?id=eq.${seedB.analysisId}`)).body).toEqual([]);
    expect((await asUser(a, `/rest/v1/analyses?deal_id=eq.${seedB.dealId}`)).body).toEqual([]);
    expect((await asUser(a, `/rest/v1/deal_documents?deal_id=eq.${seedB.dealId}`)).body).toEqual([]);
    expect((await asUser(a, `/rest/v1/profiles?id=eq.${b.id}`)).body).toEqual([]);
    expect((await asUser(a, `/rest/v1/credits?user_id=eq.${b.id}`)).body).toEqual([]);
    expect((await asUser(a, `/rest/v1/deals?id=eq.${seedAnon.dealId}`)).body).toEqual([]);
  });

  it("A n'écrit pas dans les lignes de B", async () => {
    const insert = await asUser(a, "/rest/v1/deals", {
      method: "POST",
      body: JSON.stringify({ user_id: b.id, source_type: "text", status: "pending" }),
    });
    expect(insert.status).toBeGreaterThanOrEqual(400);

    const update = await asUser(a, `/rest/v1/deals?id=eq.${seedB.dealId}`, {
      method: "PATCH",
      body: JSON.stringify({ raw_text: "modifié par A" }),
    });
    expect(update.body).toEqual([]);
    const still = await service(`/rest/v1/deals?id=eq.${seedB.dealId}&select=raw_text`);
    expect(still.body).toEqual([{ raw_text: "offre de test" }]);

    const remove = await asUser(a, `/rest/v1/analyses?id=eq.${seedB.analysisId}`, { method: "DELETE" });
    expect(remove.body).toEqual([]);
    expect(ids((await service(`/rest/v1/analyses?id=eq.${seedB.analysisId}`)).body)).toEqual([seedB.analysisId]);
  });

  it("A ne peut pas se créditer lui-même", async () => {
    const update = await asUser(a, `/rest/v1/credits?user_id=eq.${a.id}`, {
      method: "PATCH",
      body: JSON.stringify({ balance: 9999 }),
    });
    expect(update.status).toBeGreaterThanOrEqual(400);
  });

  it("la clé anon seule ne lit aucune donnée utilisateur", async () => {
    for (const table of ["profiles", "deals", "deal_documents", "analyses", "credits"]) {
      const res = await call(`/rest/v1/${table}?select=*`, ANON);
      const rows = Array.isArray(res.body) ? res.body : [];
      expect(rows, table).toEqual([]);
    }
  });

  it("whop_events et usage_guard sont fermés à anon et authenticated", async () => {
    for (const table of ["whop_events", "usage_guard"]) {
      expect((await call(`/rest/v1/${table}?select=*`, ANON)).status, `${table} anon`).toBeGreaterThanOrEqual(400);
      expect((await asUser(a, `/rest/v1/${table}?select=*`)).status, `${table} authenticated`).toBeGreaterThanOrEqual(400);
    }
    const rpcAnon = await call("/rest/v1/rpc/usage_guard_hit", ANON, {
      method: "POST",
      body: JSON.stringify({ p_ip_hash: "x", p_limit: 5, p_window_seconds: 3600 }),
    });
    expect(rpcAnon.status).toBeGreaterThanOrEqual(400);
  });
});

// PNG 1×1 valide.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

describe.skipIf(!configured)("Stockage : bucket privé", () => {
  const path = newStoragePath("image/png");
  let user: User;

  beforeAll(async () => {
    user = await createUser();
    const uploadUrl = await createSignedUploadUrl(path);
    const put = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": "image/png", "x-upsert": "false" }, body: PNG });
    expect(put.status, "dépôt par URL signée").toBe(200);
  });

  afterAll(async () => {
    await removeDocument(path).catch(() => undefined);
    if (user) await service(`/auth/v1/admin/users/${user.id}`, { method: "DELETE" });
  });

  it("le bucket deal-documents est privé", async () => {
    const res = await service("/storage/v1/bucket/deal-documents");
    expect(res.status).toBe(200);
    expect((res.body as { public: boolean }).public).toBe(false);
  });

  it("aucun document n'est lisible sans signature", async () => {
    const publicUrl = await fetch(`${URL_BASE}/storage/v1/object/public/deal-documents/${path}`);
    expect(publicUrl.status, "URL publique").toBeGreaterThanOrEqual(400);

    const bare = await fetch(`${URL_BASE}/storage/v1/object/deal-documents/${path}`);
    expect(bare.status, "sans aucune clé").toBeGreaterThanOrEqual(400);

    const anon = await fetch(`${URL_BASE}/storage/v1/object/deal-documents/${path}`, {
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
    });
    expect(anon.status, "clé anon").toBeGreaterThanOrEqual(400);

    const authenticated = await fetch(`${URL_BASE}/storage/v1/object/authenticated/deal-documents/${path}`, {
      headers: { apikey: ANON, Authorization: `Bearer ${user.token}` },
    });
    expect(authenticated.status, "utilisateur connecté").toBeGreaterThanOrEqual(400);

    const list = await call("/storage/v1/object/list/deal-documents", ANON, {
      method: "POST",
      token: user.token,
      body: JSON.stringify({ prefix: path.split("/")[0] }),
    });
    expect(Array.isArray(list.body) ? list.body : [], "liste").toEqual([]);
  });

  it("le serveur relit le fichier déposé", async () => {
    const bytes = await downloadDocument(path);
    expect(Buffer.from(bytes).equals(PNG)).toBe(true);
  });
});

describe.skipIf(!configured)("usage_guard", () => {
  const ipHash = hashIp(`198.51.100.${Math.floor(Math.random() * 250)}-${randomUUID()}`);

  afterAll(async () => {
    await service(`/rest/v1/usage_guard?ip_hash=eq.${ipHash}`, { method: "DELETE" });
  });

  it("compte deux analyses à la suite depuis la même IP", async () => {
    const first = await hitUsageGuard(ipHash);
    const second = await hitUsageGuard(ipHash);
    expect(first).toMatchObject({ allowed: true, count: 1 });
    expect(second).toMatchObject({ allowed: true, count: 2 });
    const rows = await service(`/rest/v1/usage_guard?ip_hash=eq.${ipHash}&select=ip_hash,count`);
    expect(rows.body).toEqual([{ ip_hash: ipHash, count: 2 }]);
  });

  it("bloque la sixième", async () => {
    for (let i = 0; i < 3; i++) await hitUsageGuard(ipHash);
    const sixth = await hitUsageGuard(ipHash);
    expect(sixth.allowed).toBe(false);
    expect(sixth.count).toBe(6);
  });
});
