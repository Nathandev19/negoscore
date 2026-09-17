import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import sample from "@/lib/fixtures/analysis-legacy-1.0.json";
import { extractionSchema, PRICE_PLACEHOLDER } from "@/lib/llm/prompt";
import { PRO_ANALYSES_PER_PERIOD } from "@/lib/billing/plans";
import { hashIp } from "@/lib/security/request";
import {
  ANON,
  call,
  configured,
  createUser,
  deleteUser,
  insert,
  newToken,
  seedAnalysedDeal,
  service,
  testIp,
  type TestUser,
} from "./helpers";

// Le modèle est remplacé par un espion : on vérifie qu'il n'est jamais appelé
// sans droit, et on simule ses échecs. Tout le reste (auth, base, droits) est réel.
const model = vi.hoisted(() => ({ extractDeal: vi.fn(), extractDealFromImage: vi.fn() }));
vi.mock("@/lib/llm/extract", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/llm/extract")>();
  return { ...actual, extractDeal: model.extractDeal, extractDealFromImage: model.extractDealFromImage };
});

const { POST: analyse } = await import("@/app/api/analyse/route");
const { GET: callback } = await import("@/app/auth/callback/route");
const { ExtractionError } = await import("@/lib/llm/extract");

const OFFER = "Bonjour, on te propose 300 € pour 2 vidéos TikTok avec droits pub 3 mois, paiement à 30 jours.";

function fakeExtraction() {
  return {
    extraction: extractionSchema.parse({
      ...sample,
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

const usedIps: string[] = [];
const users: TestUser[] = [];
const deals: string[] = [];

function analyseRequest({ ip, cookies = {} }: { ip: string; cookies?: Record<string, string> }) {
  usedIps.push(ip);
  const cookie = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  return analyse(
    new Request("http://localhost:3000/api/analyse", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": ip, ...(cookie ? { cookie } : {}) },
      body: JSON.stringify({ text: OFFER }),
    }),
  );
}

async function user(): Promise<TestUser> {
  const u = await createUser();
  users.push(u);
  return u;
}

async function balanceOf(userId: string): Promise<number> {
  const res = await service(`/rest/v1/credits?user_id=eq.${userId}&select=balance`);
  return (res.body as Array<{ balance: number }>)[0].balance;
}

beforeEach(() => {
  model.extractDeal.mockReset();
  model.extractDealFromImage.mockReset();
});

afterAll(async () => {
  for (const u of users) await deleteUser(u);
  for (const id of deals) await service(`/rest/v1/deals?id=eq.${id}`, { method: "DELETE" });
  for (const ip of usedIps) {
    for (const key of [hashIp(ip), hashIp(`free-analysis:${ip}`)]) {
      await service(`/rest/v1/usage_guard?ip_hash=eq.${key}`, { method: "DELETE" });
    }
  }
});

describe.skipIf(!configured)("magic link : callback et rattachement", () => {
  async function magicLinkHash(email: string): Promise<string> {
    const res = await service("/auth/v1/admin/generate_link", {
      method: "POST",
      body: JSON.stringify({ type: "magiclink", email }),
    });
    expect(res.status, "génération du lien").toBe(200);
    const body = res.body as { hashed_token?: string; properties?: { hashed_token?: string } };
    const hash = body.hashed_token ?? body.properties?.hashed_token;
    expect(hash).toBeTruthy();
    return hash as string;
  }

  function openLink(hash: string, next: string, cookie: string | null) {
    return callback(
      new Request(`http://localhost:3000/auth/callback?token_hash=${hash}&type=magiclink&next=${encodeURIComponent(next)}`, {
        headers: cookie ? { cookie } : {},
      }),
    );
  }

  it("connecte, crée le profil et rattache l'analyse anonyme, puis efface le cookie", async () => {
    const u = await user();
    const token = newToken();
    const seeded = await seedAnalysedDeal({ anonToken: token });
    deals.push(seeded.dealId);

    const next = `/analyse/resultat/${seeded.analysisId}`;
    const response = await openLink(await magicLinkHash(u.email), next, `deal_anon_token=${token}`);

    expect(response.status).toBe(303);
    // ?connexion=ok sert uniquement à la mesure d'audience.
    expect(response.headers.get("location")).toBe(`${next}?connexion=ok`);
    const setCookies = response.headers.getSetCookie();
    expect(setCookies.some((c) => /^sb_access_token=[^;]+;.*HttpOnly/.test(c))).toBe(true);
    expect(setCookies.some((c) => /^sb_refresh_token=[^;]+;.*HttpOnly/.test(c))).toBe(true);
    expect(setCookies.some((c) => /^deal_anon_token=;.*Max-Age=0/.test(c))).toBe(true);

    const profile = await service(`/rest/v1/profiles?id=eq.${u.id}&select=id,email`);
    expect(profile.body).toEqual([{ id: u.id, email: u.email }]);
    const credits = await service(`/rest/v1/credits?user_id=eq.${u.id}&select=plan,balance`);
    expect(credits.body).toEqual([{ plan: "free", balance: 0 }]);
    const deal = await service(`/rest/v1/deals?id=eq.${seeded.dealId}&select=user_id`);
    expect(deal.body).toEqual([{ user_id: u.id }]);

    // Sous son identité, l'utilisateur lit désormais l'analyse rattachée.
    const accessToken = setCookies.find((c) => c.startsWith("sb_access_token="))!.split(";")[0].split("=")[1];
    const own = await call(`/rest/v1/analyses?id=eq.${seeded.analysisId}&select=id`, ANON, { token: accessToken });
    expect(own.body).toEqual([{ id: seeded.analysisId }]);
  });

  it("ne réattribue jamais un jeton déjà rattaché à un autre compte", async () => {
    const owner = await user();
    const intruder = await user();
    const token = newToken();
    const taken = await seedAnalysedDeal({ userId: owner.id, anonToken: token });
    const loose = await seedAnalysedDeal({ anonToken: token });
    deals.push(taken.dealId, loose.dealId);

    const response = await openLink(await magicLinkHash(intruder.email), "/historique", `deal_anon_token=${token}`);
    expect(response.status).toBe(303);

    const rows = await service(`/rest/v1/deals?anon_token=eq.${token}&select=id,user_id&order=created_at`);
    expect(rows.body).toEqual([
      { id: taken.dealId, user_id: owner.id },
      { id: loose.dealId, user_id: null },
    ]);
  });

  it("refuse un lien invalide", async () => {
    const response = await openLink("lien-invalide", "/historique", null);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toMatch(/^\/connexion\?erreur=lien/);
    expect(response.headers.getSetCookie().some((c) => c.startsWith("sb_access_token="))).toBe(false);
  });
});

describe.skipIf(!configured)("droits d'analyse", () => {
  it("visiteur anonyme : la 2e analyse renvoie 402 sans appel au modèle (jeton)", async () => {
    const token = newToken();
    const seeded = await seedAnalysedDeal({ anonToken: token });
    deals.push(seeded.dealId);

    const response = await analyseRequest({ ip: testIp(), cookies: { deal_anon_token: token } });
    expect(response.status).toBe(402);
    expect(await response.json()).toMatchObject({ paywall: true, reason: "free_used" });
    expect(model.extractDeal).not.toHaveBeenCalled();
  });

  it("visiteur anonyme sans cookie : l'IP seule ne consomme pas la gratuité", async () => {
    const ip = testIp();
    model.extractDeal.mockResolvedValue(fakeExtraction());

    // Deux requêtes sans cookie depuis la même IP : ce sont deux visiteurs
    // différents derrière un même réseau, chacun a droit à son analyse.
    for (let i = 0; i < 2; i++) {
      const response = await analyseRequest({ ip });
      expect(response.status).toBe(200);
      const { analysisId } = (await response.json()) as { analysisId: string };
      const created = await service(`/rest/v1/analyses?id=eq.${analysisId}&select=deal_id`);
      deals.push((created.body as Array<{ deal_id: string }>)[0].deal_id);
    }
    expect(model.extractDeal).toHaveBeenCalledTimes(2);
  });

  it("deux visiteurs différents derrière la même IP ont chacun leur analyse gratuite", async () => {
    const ip = testIp();
    model.extractDeal.mockResolvedValue(fakeExtraction());

    for (const token of [newToken(), newToken()]) {
      const response = await analyseRequest({ ip, cookies: { deal_anon_token: token } });
      expect(response.status).toBe(200);
      const { analysisId } = (await response.json()) as { analysisId: string };
      const created = await service(`/rest/v1/analyses?id=eq.${analysisId}&select=deal_id`);
      deals.push((created.body as Array<{ deal_id: string }>)[0].deal_id);
    }
    expect(model.extractDeal).toHaveBeenCalledTimes(2);
  });

  it("au-delà du seuil anti-script, l'IP est freinée en 429 avec un message honnête", async () => {
    const ip = testIp();
    usedIps.push(ip);
    // Compteur déjà à 20 sur la fenêtre de 24 h : la requête suivante est la 21e.
    await insert("usage_guard", { ip_hash: hashIp(`free-analysis:${ip}`), count: 20, window_start: new Date().toISOString() });

    const response = await analyseRequest({ ip, cookies: { deal_anon_token: newToken() } });
    expect(response.status).toBe(429);
    const body = (await response.json()) as { error: string; reason: string; paywall?: boolean };
    expect(body.reason).toBe("rate_limited");
    expect(body.paywall).toBeUndefined();
    expect(body.error).toContain("Trop d'analyses ont été lancées depuis ton réseau");
    expect(body.error).not.toContain("Tu as utilisé ton analyse gratuite");
    expect(model.extractDeal).not.toHaveBeenCalled();
  });

  it("un client payant n'est jamais freiné par l'IP de son voisin", async () => {
    const ip = testIp();
    usedIps.push(ip);
    await insert("usage_guard", { ip_hash: hashIp(`free-analysis:${ip}`), count: 50, window_start: new Date().toISOString() });

    const u = await user();
    await insert("credits", { user_id: u.id, balance: 2, plan: "pack" });
    model.extractDeal.mockResolvedValue(fakeExtraction());

    const response = await analyseRequest({ ip, cookies: { sb_access_token: u.token } });
    expect(response.status).toBe(200);
    expect(await balanceOf(u.id)).toBe(1);
  });

  it("utilisateur connecté sans crédit : 402 et aucun appel au modèle", async () => {
    const u = await user();
    await insert("credits", { user_id: u.id, balance: 0, plan: "free" });
    const seeded = await seedAnalysedDeal({ userId: u.id });
    deals.push(seeded.dealId);

    const response = await analyseRequest({ ip: testIp(), cookies: { sb_access_token: u.token } });
    expect(response.status).toBe(402);
    expect(await response.json()).toMatchObject({ paywall: true, reason: "no_credit" });
    expect(model.extractDeal).not.toHaveBeenCalled();
  });

  it("pack : un échec ne décrémente pas le crédit, une réussite le décrémente", async () => {
    const u = await user();
    await insert("credits", { user_id: u.id, balance: 2, plan: "pack" });

    model.extractDeal.mockRejectedValue(new ExtractionError("sortie invalide simulée"));
    const failed = await analyseRequest({ ip: testIp(), cookies: { sb_access_token: u.token } });
    expect(failed.status).toBe(502);
    expect(model.extractDeal).toHaveBeenCalledTimes(1);
    expect(await balanceOf(u.id)).toBe(2);

    model.extractDeal.mockResolvedValue(fakeExtraction());
    const ok = await analyseRequest({ ip: testIp(), cookies: { sb_access_token: u.token } });
    expect(ok.status).toBe(200);
    expect(await balanceOf(u.id)).toBe(1);
    const deal = await service(`/rest/v1/deals?user_id=eq.${u.id}&select=id,anon_token`);
    expect(deal.body).toHaveLength(1);
    expect((deal.body as Array<{ anon_token: string | null }>)[0].anon_token).toBeNull();
  });

  it("pack à zéro : 402 sans appel au modèle, solde inchangé", async () => {
    const u = await user();
    await insert("credits", { user_id: u.id, balance: 0, plan: "pack" });
    const response = await analyseRequest({ ip: testIp(), cookies: { sb_access_token: u.token } });
    expect(response.status).toBe(402);
    expect(model.extractDeal).not.toHaveBeenCalled();
    expect(await balanceOf(u.id)).toBe(0);
  });

  it("gratuit : un échec ne consomme pas l'analyse gratuite", async () => {
    const u = await user();
    await insert("credits", { user_id: u.id, balance: 0, plan: "free" });
    const ip = testIp();

    model.extractDeal.mockRejectedValue(new ExtractionError("sortie invalide simulée"));
    expect((await analyseRequest({ ip, cookies: { sb_access_token: u.token } })).status).toBe(502);

    model.extractDeal.mockResolvedValue(fakeExtraction());
    expect((await analyseRequest({ ip, cookies: { sb_access_token: u.token } })).status).toBe(200);
    expect((await analyseRequest({ ip, cookies: { sb_access_token: u.token } })).status).toBe(402);
    expect(model.extractDeal).toHaveBeenCalledTimes(2);
  });

  it("pro expiré avec des crédits pack : l'analyse passe et consomme un crédit", async () => {
    const u = await user();
    // Ligne telle qu'elle existe en production après une résiliation : la
    // colonne vaut encore « pro », la période est passée, le solde est acheté.
    await insert("credits", {
      user_id: u.id,
      balance: 3,
      plan: "pro",
      period_end: "2026-09-01T05:37:47.007Z",
    });
    model.extractDeal.mockResolvedValue(fakeExtraction());

    const response = await analyseRequest({ ip: testIp(), cookies: { sb_access_token: u.token } });
    expect(response.status).toBe(200);
    expect(await balanceOf(u.id)).toBe(2);
  });

  it("pro expiré sans crédit : refus explicite sur l'abonnement", async () => {
    const u = await user();
    await insert("credits", { user_id: u.id, balance: 0, plan: "pro", period_end: "2026-09-01T05:37:47.007Z" });

    const response = await analyseRequest({ ip: testIp(), cookies: { sb_access_token: u.token } });
    expect(response.status).toBe(402);
    expect(await response.json()).toMatchObject({
      paywall: true,
      reason: "no_credit",
      error: "Ton abonnement n'est plus actif. Choisis une offre pour continuer.",
    });
    expect(model.extractDeal).not.toHaveBeenCalled();
  });

  it("pro actif avec des crédits pack : l'analyse passe par l'abonnement, le solde ne bouge pas", async () => {
    const u = await user();
    await insert("credits", {
      user_id: u.id,
      balance: 3,
      plan: "pro",
      period_end: new Date(Date.now() + 10 * 24 * 3600 * 1000).toISOString(),
    });
    model.extractDeal.mockResolvedValue(fakeExtraction());

    expect((await analyseRequest({ ip: testIp(), cookies: { sb_access_token: u.token } })).status).toBe(200);
    expect(await balanceOf(u.id)).toBe(3);
  });

  it("pro expiré : un échec rend le crédit consommé", async () => {
    const u = await user();
    await insert("credits", { user_id: u.id, balance: 3, plan: "pro", period_end: "2026-09-01T05:37:47.007Z" });

    model.extractDeal.mockRejectedValue(new ExtractionError("sortie invalide simulée"));
    expect((await analyseRequest({ ip: testIp(), cookies: { sb_access_token: u.token } })).status).toBe(502);
    expect(await balanceOf(u.id)).toBe(3);
  });

  // Quota Pro consommé : on fabrique PRO_ANALYSES_PER_PERIOD analyses dans la période.
  async function fillProQuota(userId: string, periodEnd: string): Promise<void> {
    const createdAt = new Date(new Date(periodEnd).getTime() - 24 * 3600 * 1000).toISOString();
    for (let i = 0; i < PRO_ANALYSES_PER_PERIOD; i++) {
      const deal = await insert("deals", { user_id: userId, source_type: "text", status: "analysed" });
      deals.push(deal.id);
      await insert("analyses", {
        deal_id: deal.id,
        model: "test",
        prompt_version: "test",
        rate_table_version: "test",
        payload: { test: true },
        score: 50,
        confidence: "low",
        created_at: createdAt,
      });
    }
  }

  it("pro au quota avec des crédits : l'analyse passe et consomme un crédit", async () => {
    const u = await user();
    const periodEnd = new Date(Date.now() + 10 * 24 * 3600 * 1000).toISOString();
    await insert("credits", { user_id: u.id, balance: 3, plan: "pro", period_end: periodEnd });
    await fillProQuota(u.id, periodEnd);
    model.extractDeal.mockResolvedValue(fakeExtraction());

    const response = await analyseRequest({ ip: testIp(), cookies: { sb_access_token: u.token } });
    expect(response.status).toBe(200);
    expect(await balanceOf(u.id)).toBe(2);
  });

  it("pro au quota sans crédit : refus avec le message de l'abonnement", async () => {
    const u = await user();
    const periodEnd = new Date(Date.now() + 10 * 24 * 3600 * 1000).toISOString();
    await insert("credits", { user_id: u.id, balance: 0, plan: "pro", period_end: periodEnd });
    await fillProQuota(u.id, periodEnd);

    const response = await analyseRequest({ ip: testIp(), cookies: { sb_access_token: u.token } });
    expect(response.status).toBe(402);
    expect(await response.json()).toMatchObject({
      paywall: true,
      reason: "no_credit",
      error: "Tu as atteint la limite de ton abonnement pour cette période.",
    });
    expect(model.extractDeal).not.toHaveBeenCalled();
  });

  it("pro au quota : un échec rend le crédit de dépassement", async () => {
    const u = await user();
    const periodEnd = new Date(Date.now() + 10 * 24 * 3600 * 1000).toISOString();
    await insert("credits", { user_id: u.id, balance: 2, plan: "pro", period_end: periodEnd });
    await fillProQuota(u.id, periodEnd);

    model.extractDeal.mockRejectedValue(new ExtractionError("sortie invalide simulée"));
    expect((await analyseRequest({ ip: testIp(), cookies: { sb_access_token: u.token } })).status).toBe(502);
    expect(await balanceOf(u.id)).toBe(2);
  });

  it("pro : autorisé tant que period_end est dans le futur, refusé une fois expiré", async () => {
    const u = await user();
    await insert("credits", {
      user_id: u.id,
      balance: 0,
      plan: "pro",
      period_end: new Date(Date.now() + 10 * 24 * 3600 * 1000).toISOString(),
    });
    model.extractDeal.mockResolvedValue(fakeExtraction());
    expect((await analyseRequest({ ip: testIp(), cookies: { sb_access_token: u.token } })).status).toBe(200);

    await service(`/rest/v1/credits?user_id=eq.${u.id}`, {
      method: "PATCH",
      body: JSON.stringify({ period_end: new Date(Date.now() - 1000).toISOString() }),
    });
    expect((await analyseRequest({ ip: testIp(), cookies: { sb_access_token: u.token } })).status).toBe(402);
    expect(model.extractDeal).toHaveBeenCalledTimes(1);
  });

  it("un utilisateur ne peut pas modifier son propre solde", async () => {
    const u = await user();
    await insert("credits", { user_id: u.id, balance: 1, plan: "pack" });
    const patch = await call(`/rest/v1/credits?user_id=eq.${u.id}`, ANON, {
      method: "PATCH",
      token: u.token,
      body: JSON.stringify({ balance: 999, plan: "pro" }),
    });
    expect(patch.status).toBeGreaterThanOrEqual(400);
    const insertOwn = await call("/rest/v1/credits", ANON, {
      method: "POST",
      token: u.token,
      body: JSON.stringify({ user_id: u.id, balance: 999, plan: "pro" }),
    });
    expect(insertOwn.status).toBeGreaterThanOrEqual(400);
    expect(await balanceOf(u.id)).toBe(1);
  });
});
