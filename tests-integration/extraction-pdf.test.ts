import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { composeAnalysis } from "@/lib/analysis/compose";
import { extractDealFromPdf } from "@/lib/llm/extract";
import { newStoragePath } from "@/lib/storage/documents";
import { configured, insert, newToken, service, SERVICE, testIp, URL_BASE } from "./helpers";

// PDF de bout en bout, avec le modèle de production. Coûte des appels API :
// lancé seulement par `pnpm test:llm` (RUN_LLM_INVARIANTS=1), sauté ailleurs.
const enabled = process.env.RUN_LLM_INVARIANTS === "1";
const FIXTURE = path.join(process.cwd(), "evals", "fixtures-pdf", "p01-offre-bougies", "offre.pdf");
const pdf = readFileSync(FIXTURE);

const dealIds: string[] = [];
afterAll(async () => {
  for (const id of dealIds) await service(`/rest/v1/deals?id=eq.${id}`, { method: "DELETE" });
});

describe.skipIf(!enabled)("PDF : extraction par le modèle de production", () => {
  it("lit l'offre du PDF d'une page et journalise un coût", async () => {
    const result = await extractDealFromPdf({ base64: pdf.toString("base64"), filename: "offre.pdf" });
    const { deal } = result.extraction;
    console.log(
      JSON.stringify({ event: "pdf_cost", input_tokens: result.inputTokens, output_tokens: result.outputTokens, cost_eur: result.costEur, latency_ms: result.latencyMs }),
    );
    expect(deal.payment.amount_eur).toBe(450);
    expect(deal.payment.terms_days).toBe(30);
    expect(deal.deliverables).toEqual([expect.objectContaining({ type: "video", platform: "tiktok", quantity: 2 })]);
    expect(deal.usage.paid_ads).toBe(true);
    expect(deal.usage.duration_months).toBe(6);
    expect(deal.exclusivity).toMatchObject({ present: true, duration_months: 3 });
    expect(deal.raw_footage).toBe(true);
    expect(deal.revisions.count).toBe(2);
    expect(result.inputTokens).toBeGreaterThan(0);
    expect(result.costEur).toBeGreaterThan(0);
    expect(composeAnalysis(result.extraction).evaluability).toBe("complete");
  });

  it.skipIf(!configured)("parcours complet : dépôt dans le bucket, puis /api/analyse", async () => {
    const { POST: analyse } = await import("@/app/api/analyse/route");
    const token = newToken();
    const deal = await insert("deals", { anon_token: token, source_type: "pdf", status: "awaiting_upload" });
    dealIds.push(deal.id);
    const storagePath = newStoragePath("application/pdf");
    const uploaded = await fetch(`${URL_BASE}/storage/v1/object/deal-documents/${storagePath}`, {
      method: "POST",
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/pdf" },
      body: pdf,
    });
    expect(uploaded.status).toBe(200);
    await insert("deal_documents", { deal_id: deal.id, storage_path: storagePath, mime: "application/pdf", bytes: pdf.byteLength });

    const response = await analyse(
      new Request("http://localhost:3000/api/analyse", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: `deal_anon_token=${token}`, "x-forwarded-for": testIp() },
        body: JSON.stringify({ storagePath }),
      }),
    );
    const body = (await response.json()) as { analysisId?: string; meta?: { has_price: boolean } };
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.meta?.has_price).toBe(true);
    const saved = await service(`/rest/v1/analyses?id=eq.${body.analysisId}&select=cost_cents,prompt_version`);
    const [row] = saved.body as Array<{ cost_cents: number; prompt_version: string }>;
    console.log(JSON.stringify({ event: "pdf_route_cost", cost_cents: row.cost_cents }));
    expect(row.cost_cents).toBeGreaterThan(0);
    await fetch(`${URL_BASE}/storage/v1/object/deal-documents`, {
      method: "DELETE",
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" },
      body: JSON.stringify({ prefixes: [storagePath] }),
    });
  });
});
