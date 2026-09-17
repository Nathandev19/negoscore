import OpenAI from "openai";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import sample from "@/lib/fixtures/analysis-sample.json";
import { extractionSchema, PRICE_PLACEHOLDER } from "@/lib/llm/prompt";
import { hashIp } from "@/lib/security/request";
import { newStoragePath } from "@/lib/storage/documents";
import { configured, createUser, deleteUser, insert, newToken, service, SERVICE, testIp, URL_BASE, type TestUser } from "./helpers";

// Échecs du modèle, SIMULÉS : aucun appel réel. Base, stockage, auth et droits
// sont réels. Règle vérifiée : aucun droit consommé sans résultat rendu.
const model = vi.hoisted(() => ({ extractDeal: vi.fn(), extractDealFromImage: vi.fn(), extractDealFromPdf: vi.fn() }));
vi.mock("@/lib/llm/extract", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/llm/extract")>();
  return { ...actual, ...model };
});

const { POST: analyse } = await import("@/app/api/analyse/route");
const { MissingApiKeyError } = await import("@/lib/llm/extract");

const OFFER = "Bonjour, on te propose 300 € pour 2 vidéos TikTok avec droits pub 3 mois, paiement à 30 jours.";
const users: TestUser[] = [];
const ips: string[] = [];
const tokens: string[] = [];
const paths: string[] = [];

afterAll(async () => {
  for (const user of users) await deleteUser(user);
  for (const token of tokens) await service(`/rest/v1/deals?anon_token=eq.${encodeURIComponent(token)}`, { method: "DELETE" });
  for (const ip of ips) {
    for (const key of [hashIp(ip), hashIp(`free-analysis:${ip}`)]) await service(`/rest/v1/usage_guard?ip_hash=eq.${key}`, { method: "DELETE" });
  }
  if (paths.length > 0) {
    await fetch(`${URL_BASE}/storage/v1/object/deal-documents`, {
      method: "DELETE",
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" },
      body: JSON.stringify({ prefixes: paths }),
    });
  }
});

beforeEach(() => {
  for (const fn of Object.values(model)) fn.mockReset();
  vi.unstubAllEnvs();
});

function extraction(readable = true) {
  return {
    extraction: extractionSchema.parse({
      ...sample,
      input_quality: { readable, missing_critical: [] },
      negotiate: [{ label: "Droits pub", why: "Ils ont de la valeur.", priority: 1, topic: "paid_ads" }],
      counter_offer: { changes: ["Droits pub facturés à part"] },
      ready_to_send_message: { tone: "cordial", text: `Mon tarif : ${PRICE_PLACEHOLDER}.` },
    }),
    model: "test",
    inputTokens: 1,
    outputTokens: 1,
    costEur: 0,
    latencyMs: 1,
    schemaValidFirstTry: true,
    attempts: 1,
  };
}

const unreadable = () => {
  const result = extraction(false);
  const deal = result.extraction.deal;
  result.extraction.deal = { ...deal, deliverables: [], usage: { ...deal.usage, organic: false, paid_ads: false, whitelisting: false, spark_ads: false, perpetual: false } };
  return result;
};

// Les quatre pannes demandées, construites avec les classes du SDK du fournisseur.
const FAILURES = [
  {
    name: "quota épuisé",
    error: () => new OpenAI.RateLimitError(429, { code: "insufficient_quota", type: "insufficient_quota", message: "quota" }, "quota", new Headers()),
    status: 503,
    event: "analyse_failed_quota",
    message: "L'analyse est momentanément indisponible. Ton crédit n'a pas été utilisé, réessaie dans quelques minutes.",
  },
  {
    name: "délai dépassé",
    error: () => new OpenAI.APIConnectionTimeoutError(),
    status: 504,
    event: "analyse_failed_timeout",
    message: "L'analyse a pris trop de temps et n'a pas abouti. Ton crédit n'a pas été utilisé, réessaie dans quelques minutes.",
  },
  {
    name: "erreur 500 du fournisseur",
    error: () => new OpenAI.InternalServerError(500, { type: "server_error", message: "panne" }, "panne", new Headers()),
    status: 503,
    event: "analyse_failed_provider_error",
    message: "L'analyse est momentanément indisponible. Ton crédit n'a pas été utilisé, réessaie dans quelques minutes.",
  },
  {
    name: "clé d'API absente",
    error: () => new MissingApiKeyError("OPENAI_API_KEY absente"),
    status: 503,
    event: "analyse_failed_missing_key",
    message: "L'analyse est momentanément indisponible. Ton crédit n'a pas été utilisé, réessaie dans quelques minutes.",
  },
] as const;

function post(body: Record<string, unknown>, { ip, cookie }: { ip: string; cookie?: string }) {
  ips.push(ip);
  return analyse(
    new Request("http://localhost:3000/api/analyse", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": ip, ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    }),
  );
}

async function packUser(balance: number): Promise<TestUser> {
  const user = await createUser();
  users.push(user);
  await insert("credits", { user_id: user.id, balance, plan: "pack" });
  return user;
}

async function balanceOf(userId: string): Promise<number> {
  return ((await service(`/rest/v1/credits?user_id=eq.${userId}&select=balance`)).body as Array<{ balance: number }>)[0].balance;
}

async function hourlyCount(ip: string): Promise<number> {
  const rows = (await service(`/rest/v1/usage_guard?ip_hash=eq.${hashIp(ip)}&select=count`)).body as Array<{ count: number }>;
  return rows[0]?.count ?? 0;
}

async function uploadImage(owner: { anonToken?: string; userId?: string }): Promise<{ dealId: string; storagePath: string }> {
  const deal = await insert("deals", { anon_token: owner.anonToken ?? null, user_id: owner.userId ?? null, source_type: "image", status: "awaiting_upload" });
  const storagePath = newStoragePath("image/png");
  paths.push(storagePath);
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7, 7, 7]);
  const uploaded = await fetch(`${URL_BASE}/storage/v1/object/deal-documents/${storagePath}`, {
    method: "POST",
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "image/png" },
    body: png,
  });
  expect(uploaded.status).toBe(200);
  await insert("deal_documents", { deal_id: deal.id, storage_path: storagePath, mime: "image/png", bytes: png.byteLength });
  return { dealId: deal.id, storagePath };
}

async function objectStatus(path: string): Promise<number> {
  const response = await fetch(`${URL_BASE}/storage/v1/object/deal-documents/${path}`, { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } });
  await response.arrayBuffer();
  return response.status;
}

describe.skipIf(!configured)("échec du modèle : aucun droit consommé sans résultat rendu", () => {
  it.each(FAILURES)("$name : crédit payé intact, message honnête, cause journalisée sans le texte de l'offre", async (failure) => {
    const user = await packUser(2);
    const ip = testIp();
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    model.extractDeal.mockRejectedValue(failure.error());

    const response = await post({ text: OFFER }, { ip, cookie: `sb_access_token=${user.token}` });
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(failure.status);
    expect(body.error).toBe(failure.message);
    expect(await balanceOf(user.id)).toBe(2);
    expect(await hourlyCount(ip)).toBe(0);
    expect((await service(`/rest/v1/deals?user_id=eq.${user.id}&select=id`)).body).toEqual([]);
    const logged = errors.mock.calls.map((call) => String(call[0])).find((line) => line.includes(failure.event));
    expect(logged).toBeTruthy();
    expect(JSON.parse(logged!)).toMatchObject({ event: failure.event, provider: "openai" });
    expect(logged).not.toContain("300 €");
    expect(logged).not.toMatch(/sk-|OPENAI_API_KEY=/);
    errors.mockRestore();
  });

  it.each(FAILURES)("$name : analyse gratuite non décomptée, fichier déposé supprimé", async (failure) => {
    const token = newToken();
    tokens.push(token);
    const ip = testIp();
    const { dealId, storagePath } = await uploadImage({ anonToken: token });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    model.extractDealFromImage.mockRejectedValue(failure.error());

    const response = await post({ storagePath }, { ip, cookie: `deal_anon_token=${token}` });
    const body = (await response.json()) as { error: string };
    expect(response.status).toBe(failure.status);
    expect(body.error).toBe(failure.message.replace("Ton crédit n'a pas été utilisé", "Ton analyse gratuite n'a pas été utilisée"));

    // Fichier supprimé du stockage, deal marqué en échec, rien de compté.
    expect([400, 404]).toContain(await objectStatus(storagePath));
    expect((await service(`/rest/v1/deals?id=eq.${dealId}&select=status`)).body).toEqual([{ status: "failed" }]);
    expect(await hourlyCount(ip)).toBe(0);
    const freeNet = (await service(`/rest/v1/usage_guard?ip_hash=eq.${hashIp(`free-analysis:${ip}`)}&select=count`)).body as Array<{ count: number }>;
    expect(freeNet[0]?.count ?? 0).toBe(0);

    // L'analyse gratuite est toujours disponible pour ce navigateur.
    model.extractDeal.mockResolvedValue(extraction());
    expect((await post({ text: OFFER }, { ip, cookie: `deal_anon_token=${token}` })).status).toBe(200);
    vi.restoreAllMocks();
  });

  it("pendant l'appel au modèle, rien n'est encore décompté", async () => {
    const user = await packUser(2);
    let balanceDuringCall = -1;
    model.extractDeal.mockImplementation(async () => {
      balanceDuringCall = await balanceOf(user.id);
      return extraction();
    });
    expect((await post({ text: OFFER }, { ip: testIp(), cookie: `sb_access_token=${user.token}` })).status).toBe(200);
    expect(balanceDuringCall).toBe(2);
    expect(await balanceOf(user.id)).toBe(1);
  });

  it("offre illisible : rien d'enregistré ni de décompté, et on dit quoi faire", async () => {
    const user = await packUser(2);
    const { storagePath } = await uploadImage({ userId: user.id });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    model.extractDealFromImage.mockResolvedValue(unreadable());

    const response = await post({ storagePath }, { ip: testIp(), cookie: `sb_access_token=${user.token}` });
    expect(response.status).toBe(422);
    expect(((await response.json()) as { error: string }).error).toBe(
      "On n'arrive pas à lire cette image. Envoie une capture plus nette et bien cadrée, ou colle le texte du message. Ton crédit n'a pas été utilisé.",
    );
    expect(await balanceOf(user.id)).toBe(2);
    expect([400, 404]).toContain(await objectStatus(storagePath));
    expect((await service(`/rest/v1/analyses?select=id,deal:deals!inner(user_id)&deal.user_id=eq.${user.id}`)).body).toEqual([]);
    vi.restoreAllMocks();
  });

  it("interrupteur ANALYSIS_PAUSED : message honnête, aucun appel, rien de compté", async () => {
    vi.stubEnv("ANALYSIS_PAUSED", "1");
    const user = await packUser(2);
    const ip = testIp();
    const response = await post({ text: OFFER }, { ip, cookie: `sb_access_token=${user.token}` });
    expect(response.status).toBe(503);
    expect(((await response.json()) as { error: string; reason: string })).toEqual({
      error: "L'analyse est momentanément indisponible. Rien n'est décompté pendant ce temps : réessaie un peu plus tard.",
      reason: "paused",
    });
    expect(model.extractDeal).not.toHaveBeenCalled();
    expect(await balanceOf(user.id)).toBe(2);
    expect(await hourlyCount(ip)).toBe(0);

    const { POST: uploadUrl } = await import("@/app/api/upload-url/route");
    const upload = await uploadUrl(
      new Request("http://localhost:3000/api/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "photo", mime: "image/png", bytes: 100 }),
      }),
    );
    expect(upload.status).toBe(503);
  });
});
