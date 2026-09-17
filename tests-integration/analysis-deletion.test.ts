import { afterAll, describe, expect, it } from "vitest";
import { newStoragePath } from "@/lib/storage/documents";
import { configured, createUser, deleteUser, insert, newToken, service, SERVICE, URL_BASE, type TestUser } from "./helpers";

// Suppression d'une analyse par son auteur, contre la vraie base et le vrai
// stockage. Seules les lignes créées ici sont touchées.
const { POST } = await import("@/app/api/analyses/[id]/supprimer/route");

const users: TestUser[] = [];
const dealIds: string[] = [];
const paths: string[] = [];

afterAll(async () => {
  for (const id of dealIds) await service(`/rest/v1/deals?id=eq.${id}`, { method: "DELETE" });
  if (paths.length > 0) {
    await fetch(`${URL_BASE}/storage/v1/object/deal-documents`, {
      method: "DELETE",
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" },
      body: JSON.stringify({ prefixes: paths }),
    });
  }
  for (const user of users) await deleteUser(user);
});

async function seed(owner: { anonToken?: string; userId?: string }) {
  const deal = await insert("deals", {
    anon_token: owner.anonToken ?? null,
    user_id: owner.userId ?? null,
    source_type: "image",
    raw_text: "texte de test",
    status: "analysed",
  });
  dealIds.push(deal.id);
  const analysis = await insert("analyses", { deal_id: deal.id, model: "test", prompt_version: "test", rate_table_version: "test", payload: { test: true } });
  const path = newStoragePath("image/png");
  paths.push(path);
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9, 9]);
  const uploaded = await fetch(`${URL_BASE}/storage/v1/object/deal-documents/${path}`, {
    method: "POST",
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "image/png" },
    body: png,
  });
  expect(uploaded.status).toBe(200);
  await insert("deal_documents", { deal_id: deal.id, storage_path: path, mime: "image/png", bytes: png.byteLength });
  return { dealId: deal.id, analysisId: analysis.id, path };
}

function post(analysisId: string, cookie: string | null) {
  return POST(
    new Request(`http://localhost:3000/api/analyses/${analysisId}/supprimer`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", ...(cookie ? { cookie } : {}) },
      body: "confirmation=oui",
    }),
    { params: Promise.resolve({ id: analysisId }) },
  );
}

async function exists(dealId: string, analysisId: string): Promise<boolean> {
  const deals = (await service(`/rest/v1/deals?id=eq.${dealId}&select=id`)).body as unknown[];
  const analyses = (await service(`/rest/v1/analyses?id=eq.${analysisId}&select=id`)).body as unknown[];
  return deals.length === 1 && analyses.length === 1;
}

async function objectStatus(path: string): Promise<number> {
  const response = await fetch(`${URL_BASE}/storage/v1/object/deal-documents/${path}`, {
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  });
  await response.arrayBuffer();
  return response.status;
}

describe.skipIf(!configured)("suppression d'une analyse, contre la base", () => {
  it("refusée à un autre visiteur, à un visiteur sans cookie, et pour un identifiant inexistant", async () => {
    const owner = newToken();
    const { dealId, analysisId, path } = await seed({ anonToken: owner });

    expect((await post(analysisId, `deal_anon_token=${newToken()}`)).status).toBe(404);
    expect((await post(analysisId, null)).status).toBe(404);
    expect((await post("7b1f2c9e-3d4a-4b5c-8d6e-0f1a2b3c4d5e", `deal_anon_token=${owner}`)).status).toBe(404);

    expect(await exists(dealId, analysisId)).toBe(true);
    expect(await objectStatus(path)).toBe(200);
  });

  it("l'auteur anonyme supprime deal, texte, fichier et analyse", async () => {
    const owner = newToken();
    const { dealId, analysisId, path } = await seed({ anonToken: owner });

    const response = await post(analysisId, `deal_anon_token=${owner}`);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/analyse/supprimee");
    expect(await exists(dealId, analysisId)).toBe(false);
    expect((await service(`/rest/v1/deal_documents?storage_path=eq.${encodeURIComponent(path)}&select=id`)).body).toEqual([]);
    expect([400, 404]).toContain(await objectStatus(path));
  });

  it("une analyse rattachée à un compte : seul ce compte la supprime", async () => {
    const account = await createUser();
    const other = await createUser();
    users.push(account, other);
    const { dealId, analysisId } = await seed({ userId: account.id });

    expect((await post(analysisId, `sb_access_token=${other.token}`)).status).toBe(404);
    expect(await exists(dealId, analysisId)).toBe(true);

    const response = await post(analysisId, `sb_access_token=${account.token}`);
    expect(response.headers.get("location")).toBe("/analyse/supprimee");
    expect(await exists(dealId, analysisId)).toBe(false);
  });
});
