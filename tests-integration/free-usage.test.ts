import { afterAll, describe, expect, it, vi } from "vitest";
import sample from "@/lib/fixtures/analysis-sample.json";
import { freeSubjectHash } from "@/lib/billing/free-usage";
import { extractionSchema, PRICE_PLACEHOLDER } from "@/lib/llm/prompt";
import { hashIp } from "@/lib/security/request";
import { configured, createUser, deleteUser, insert, service, testIp, type TestUser } from "./helpers";

// Brèche de quota : analyser, supprimer, réessayer. Modèle simulé, base réelle.
// Nécessite la migration 015 (table free_usage) : sauté tant qu'elle n'est pas appliquée.
const model = vi.hoisted(() => ({ extractDeal: vi.fn() }));
vi.mock("@/lib/llm/extract", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/llm/extract")>()), ...model }));

const { POST: analyse } = await import("@/app/api/analyse/route");
const { POST: supprimer } = await import("@/app/api/analyses/[id]/supprimer/route");

const hasTable = configured && (await service("/rest/v1/free_usage?select=used&limit=1")).status === 200;
const users: TestUser[] = [];
const ips: string[] = [];

afterAll(async () => {
  for (const user of users) {
    await service(`/rest/v1/free_usage?subject_hash=eq.${freeSubjectHash({ kind: "user", id: user.id })}`, { method: "DELETE" });
    await deleteUser(user);
  }
  for (const ip of ips) {
    for (const key of [hashIp(ip), hashIp(`free-analysis:${ip}`)]) await service(`/rest/v1/usage_guard?ip_hash=eq.${key}`, { method: "DELETE" });
  }
});

function extraction() {
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

async function run(user: TestUser) {
  const ip = testIp();
  ips.push(ip);
  return analyse(
    new Request("http://localhost:3000/api/analyse", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": ip, cookie: `sb_access_token=${user.token}` },
      body: JSON.stringify({ text: "Bonjour, 300 € pour 2 vidéos TikTok, droits pub 3 mois, paiement à 30 jours." }),
    }),
  );
}

async function remove(user: TestUser, analysisId: string) {
  return supprimer(
    new Request(`http://localhost:3000/api/analyses/${analysisId}/supprimer`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: `sb_access_token=${user.token}` },
      body: "confirmation=oui",
    }),
    { params: Promise.resolve({ id: analysisId }) },
  );
}

describe.skipIf(!hasTable)("supprimer une analyse ne rend pas le droit gratuit", () => {
  it("compte gratuit : analyser, supprimer, réessayer → refusé", async () => {
    const user = await createUser();
    users.push(user);
    await insert("credits", { user_id: user.id, balance: 0, plan: "free" });
    model.extractDeal.mockResolvedValue(extraction());

    const first = await run(user);
    expect(first.status).toBe(200);
    const { analysisId } = (await first.json()) as { analysisId: string };
    expect((await remove(user, analysisId)).headers.get("location")).toBe("/analyse/supprimee");
    expect((await service(`/rest/v1/deals?user_id=eq.${user.id}&select=id`)).body).toEqual([]);

    const again = await run(user);
    expect(again.status).toBe(402);
    expect(model.extractDeal).toHaveBeenCalledTimes(1);
    // Le compteur ne garde qu'un nombre et une date.
    const [row] = (await service(`/rest/v1/free_usage?subject_hash=eq.${freeSubjectHash({ kind: "user", id: user.id })}&select=*`)).body as Array<Record<string, unknown>>;
    expect(Object.keys(row).sort()).toEqual(["last_used_at", "subject_hash", "used"]);
    expect(row.used).toBe(1);
  });

  it("avec un crédit payé restant : accepté après suppression", async () => {
    const user = await createUser();
    users.push(user);
    await insert("credits", { user_id: user.id, balance: 2, plan: "pack" });
    model.extractDeal.mockResolvedValue(extraction());

    const first = await run(user);
    const { analysisId } = (await first.json()) as { analysisId: string };
    await remove(user, analysisId);
    expect((await run(user)).status).toBe(200);
    const [credits] = (await service(`/rest/v1/credits?user_id=eq.${user.id}&select=balance`)).body as Array<{ balance: number }>;
    expect(credits.balance).toBe(0);
  });
});
