import { randomBytes, randomUUID } from "node:crypto";
import { expect } from "vitest";

// Accès au projet Supabase de test. Comptes créés avec des mots de passe
// aléatoires gardés en mémoire, supprimés en fin de test.

export const URL_BASE = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
export const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
export const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
export const configured = Boolean(URL_BASE && ANON && SERVICE);

export type TestUser = { id: string; email: string; token: string };

export async function call(path: string, key: string, init: RequestInit & { token?: string } = {}) {
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

export const service = (path: string, init: RequestInit = {}) => call(path, SERVICE, init);

export async function createUser(): Promise<TestUser> {
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
  return { id, email, token: (session.body as { access_token: string }).access_token };
}

export async function deleteUser(user: TestUser | undefined): Promise<void> {
  if (user) await service(`/auth/v1/admin/users/${user.id}`, { method: "DELETE" });
}

export async function insert<T = { id: string }>(table: string, row: Record<string, unknown>): Promise<T> {
  const res = await service(`/rest/v1/${table}`, { method: "POST", body: JSON.stringify(row) });
  expect(res.status, `insertion ${table}`).toBe(201);
  return (res.body as T[])[0];
}

export async function seedAnalysedDeal(owner: { userId?: string | null; anonToken?: string | null }) {
  const deal = await insert("deals", {
    user_id: owner.userId ?? null,
    anon_token: owner.anonToken ?? null,
    source_type: "text",
    raw_text: "offre de test",
    status: "analysed",
  });
  const analysis = await insert("analyses", {
    deal_id: deal.id,
    model: "test",
    prompt_version: "test",
    rate_table_version: "test",
    payload: { test: true },
    score: 50,
    confidence: "low",
  });
  return { dealId: deal.id, analysisId: analysis.id };
}

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

// Adresse de documentation IPv6 unique par test (2001:db8::/32).
export function testIp(): string {
  const hex = randomBytes(6).toString("hex");
  return `2001:db8:${hex.slice(0, 4)}:${hex.slice(4, 8)}::${hex.slice(8, 12)}`;
}
