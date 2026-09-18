import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { composeAnalysis } from "@/lib/analysis/compose";
import { baseExtraction } from "@/lib/fixtures/preview-states";
import type { FeedbackRow } from "@/lib/admin/feedback-report";

// Mission #077 — les retours sur l'estimation, lisibles par le seul
// propriétaire du site (OWNER_EMAIL), et par personne d'autre.

const OWNER = "nathan@exemple.test";
const SUPABASE = "https://projet.supabase.test";

const session = vi.hoisted(() => ({ email: null as string | null }));
const store = vi.hoisted(() => ({ rows: [] as unknown[] | "missing" }));

vi.mock("@/lib/auth/viewer", () => ({
  getViewer: async () => (session.email ? { id: "compte-1", email: session.email } : null),
}));
vi.mock("@/components/site-header", () => ({ SiteHeader: () => null }));
vi.mock("@/lib/admin/feedback-report", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admin/feedback-report")>()),
  loadFeedbackRows: async () => store.rows,
}));

const { proxy } = await import("@/proxy");
const { default: FeedbackPage } = await import("@/app/dev/retours/page");
const { buildReport, loadFeedbackRows: _unused } = await import("@/lib/admin/feedback-report");
void _unused;

// ─── Fausse base et faux Supabase Auth ───────────────────────────────────────

const baseDeal = () => composeAnalysis(baseExtraction()).deal;

function row(overrides: Partial<FeedbackRow> & { deal?: Partial<ReturnType<typeof baseDeal>> }): FeedbackRow {
  const { deal, ...rest } = overrides;
  return {
    analysis_id: "11111111-1111-4111-8111-111111111111",
    rating: "fair",
    comment: null,
    profile_tier: "starter",
    score: 42,
    total_low: 400,
    total_high: 600,
    rate_table_version: "2026.09",
    created_at: "2026-09-18T10:00:00.000Z",
    updated_at: "2026-09-18T10:00:00.000Z",
    analysis: { deal: { ...baseDeal(), ...deal } },
    ...rest,
  };
}

function visit(pathname: string, email: string | null) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ id: "compte-1", email })),
  );
  const cookie = email ? "sb_access_token=eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjQxMDI0NDQ4MDB9.sig" : "";
  return proxy(new NextRequest(`http://localhost:3000${pathname}`, { headers: cookie ? { cookie } : {} }));
}

// Destination d'une réécriture du proxy, null si la requête passe telle quelle.
const rewrittenTo = (r: Response) => {
  const target = r.headers.get("x-middleware-rewrite");
  return target ? new URL(target).pathname : null;
};

async function render(): Promise<string | "404"> {
  try {
    return renderToStaticMarkup(await FeedbackPage());
  } catch (caught) {
    if (caught instanceof Error && /NEXT_HTTP_ERROR_FALLBACK;404/.test(String((caught as { digest?: string }).digest))) return "404";
    throw caught;
  }
}

beforeEach(() => {
  vi.stubEnv("OWNER_EMAIL", OWNER);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "cle-anon-de-test");
  session.email = null;
  store.rows = [];
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// ─── A3 : trois cas, au proxy et dans la page ────────────────────────────────

describe("A3 — la bonne adresse, une autre adresse connectée, personne", () => {
  it("la bonne adresse : la page passe et s'affiche", async () => {
    for (const pathname of ["/dev/retours", "/dev/retours/11111111-1111-4111-8111-111111111111"]) {
      const r = await visit(pathname, OWNER);
      expect(rewrittenTo(r), pathname).toBeNull();
      expect(r.status).toBe(200);
    }
    session.email = OWNER;
    expect(await render()).toContain("Retours sur l&#x27;estimation");
  });

  it("la bonne adresse, écrite autrement (majuscules, espaces) : même personne", async () => {
    vi.stubEnv("OWNER_EMAIL", "  Nathan@Exemple.test ");
    expect(rewrittenTo(await visit("/dev/retours", "NATHAN@exemple.TEST"))).toBeNull();
  });

  it("une autre adresse connectée : réponse d'une adresse inexistante, page jamais rendue", async () => {
    const r = await visit("/dev/retours", "nina@exemple.test");
    expect(rewrittenTo(r)).toBe("/_introuvable");
    session.email = "nina@exemple.test";
    expect(await render()).toBe("404");
  });

  it("personne : même réponse, sans même interroger Supabase", async () => {
    const r = await visit("/dev/retours/11111111-1111-4111-8111-111111111111", null);
    expect(rewrittenTo(r)).toBe("/_introuvable");
    expect(fetch).not.toHaveBeenCalled();
    session.email = null;
    expect(await render()).toBe("404");
  });

  it("variable OWNER_EMAIL absente ou vide : la page n'existe pour personne", async () => {
    for (const value of ["", "   "]) {
      vi.stubEnv("OWNER_EMAIL", value);
      expect(rewrittenTo(await visit("/dev/retours", OWNER))).toBe("/_introuvable");
      session.email = OWNER;
      expect(await render()).toBe("404");
    }
  });

  it("en développement, le préfixe ne déborde pas : /dev/retoursX et /dev/resultat restent ouverts", async () => {
    expect(rewrittenTo(await visit("/dev/retoursX", null))).toBeNull();
    expect(rewrittenTo(await visit("/dev/resultat", null))).toBeNull();
  });

  it("en production, toute la zone /dev répond pareil : /dev/retours indiscernable d'une adresse /dev inexistante", async () => {
    vi.stubEnv("NODE_ENV", "production");
    for (const email of [null, "nina@exemple.test"]) {
      const responses = await Promise.all(["/dev/retours", "/dev/nimportequoi", "/dev"].map((p) => visit(p, email)));
      for (const r of responses) expect(rewrittenTo(r)).toBe("/_introuvable");
      const headers = responses.map((r) => [...r.headers.entries()].sort());
      expect(headers[0]).toEqual(headers[1]);
      expect(headers[0]).toEqual(headers[2]);
    }
    // Le propriétaire, lui, passe.
    expect(rewrittenTo(await visit("/dev/retours", OWNER))).toBeNull();
  });
});

// ─── A1 : la zone /dev en production ─────────────────────────────────────────

describe("A1 — app/dev : rien n'existe en production, sauf les pages réservées", () => {
  const files = readdirSync(path.join(process.cwd(), "app", "dev"), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(path.join(process.cwd(), "app", "dev"), path.join(entry.parentPath, entry.name)).replaceAll("\\", "/"));

  it("tout fichier sans extension .dev est l'une des deux pages réservées", () => {
    expect(files.filter((file) => !/\.dev\.tsx?$/.test(file)).sort()).toEqual(["retours/[id]/page.tsx", "retours/page.tsx"]);
  });

  it("chaque page réservée vérifie elle-même le propriétaire avant toute lecture", () => {
    for (const file of ["retours/page.tsx", "retours/[id]/page.tsx"]) {
      const source = readFileSync(path.join(process.cwd(), "app", "dev", file), "utf8");
      const gate = source.indexOf("if (!isOwner(await getViewer())) notFound();");
      expect(gate, file).toBeGreaterThan(0);
      expect(source.indexOf("await load"), file).toBeGreaterThan(gate);
    }
  });
});

// ─── A2 : aucune donnée personnelle ──────────────────────────────────────────

describe("A2 — aucune donnée personnelle demandée à la base ni affichée", () => {
  it("les colonnes lues : ni compte, ni email, ni jeton, ni texte d'offre", () => {
    const source = readFileSync(path.join(process.cwd(), "lib", "admin", "feedback-report.ts"), "utf8");
    const selects = [...source.matchAll(/select=([^&`"]+)/g)].map((m) => m[1]).join(",");
    for (const forbidden of ["user_id", "email", "anon_token", "raw_text", "deals", "profiles", "payload->raw"]) {
      expect(selects, forbidden).not.toContain(forbidden);
    }
  });

  it("la page rendue ne contient ni adresse email ni identifiant de compte", async () => {
    session.email = OWNER;
    store.rows = [row({ comment: "Trop bas pour 3 vidéos" })];
    const html = await render();
    expect(html).not.toContain(OWNER);
    expect(html).not.toContain("compte-1");
    expect(html).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
  });
});

// ─── B : ce que la page montre ───────────────────────────────────────────────

describe("B — répartitions et liste", () => {
  const rows = [
    row({ analysis_id: "a1", rating: "too_low", profile_tier: "starter", updated_at: "2026-09-18T09:00:00.000Z", deal: { usage: { ...baseDeal().usage, paid_ads: true } } }),
    row({ analysis_id: "a2", rating: "too_low", profile_tier: "experienced", updated_at: "2026-09-19T09:00:00.000Z", deal: { exclusivity: { present: true, duration_months: 3, category: null } } }),
    row({ analysis_id: "a3", rating: "fair", profile_tier: "starter", updated_at: "2026-09-17T09:00:00.000Z", deal: { in_kind_value_eur: 150, payment: { ...baseDeal().payment, amount_eur: null } } }),
    row({ analysis_id: "a4", rating: "too_high", profile_tier: null, updated_at: "2026-09-16T09:00:00.000Z", analysis: { deal: { illisible: true } } }),
  ];

  it("B1 — l'ensemble : nombres", () => {
    expect(buildReport(rows).overall).toEqual({ total: 4, counts: { too_low: 2, fair: 1, too_high: 1 } });
  });

  it("B2 — par niveau : les trois niveaux toujours présents, et le niveau non enregistré à part", () => {
    const byTier = buildReport(rows).byTier;
    expect(byTier.map((g) => [g.key, g.distribution.total])).toEqual([
      ["starter", 2],
      ["confirmed", 0],
      ["experienced", 1],
      ["inconnu", 1],
    ]);
    expect(byTier[0].distribution.counts).toEqual({ too_low: 1, fair: 1, too_high: 0 });
  });

  it("B3 — par forme du deal : droits pub, exclusivité, produits, et l'analyse illisible à part", () => {
    const shape = Object.fromEntries(buildReport(rows).byShape.map((b) => [b.key, b.groups.map((g) => [g.key, g.distribution.total])]));
    expect(shape["droits-pub"]).toEqual([["avec", baseDeal().usage.paid_ads ? 3 : 1], ["sans", baseDeal().usage.paid_ads ? 0 : 2], ["illisible", 1]]);
    expect(shape.exclusivite).toEqual([["avec", baseDeal().exclusivity.present ? 3 : 1], ["sans", baseDeal().exclusivity.present ? 0 : 2], ["illisible", 1]]);
    expect(shape.produits).toEqual([["chiffres", 1], ["non-chiffres", 2], ["illisible", 1]]);
  });

  it("B4 — du plus récent au plus ancien, avec le rapport proposé ÷ bas de fourchette", () => {
    const entries = buildReport(rows).entries;
    expect(entries.map((e) => e.analysisId)).toEqual(["a2", "a1", "a3", "a4"]);
    const products = entries.find((e) => e.analysisId === "a3");
    expect(products?.offered).toEqual({ value: 150, kind: "products" });
    expect(products?.ratioToLow).toBeCloseTo(150 / 400);
    // Deal illisible : ni montant, ni rapport inventés.
    expect(entries.find((e) => e.analysisId === "a4")).toMatchObject({ offered: null, ratioToLow: null });
  });

  it("B4 — la liste affiche date, réponse, commentaire, niveau, score, montant, fourchette, rapport et lien", async () => {
    session.email = OWNER;
    store.rows = [row({ analysis_id: "a1", rating: "too_low", comment: "La marque paie 800 € d'habitude", score: 38 })];
    const html = await render();
    for (const expected of ["Trop basse", "La marque paie 800 € d&#x27;habitude", "Je débute", "38/100", "400", "600", "× ", 'href="/dev/retours/a1"', "18 sept. 2026"]) {
      expect(html, expected).toContain(expected);
    }
  });

  it("B5 — aucun retour : un état vide honnête, sans tableau ni zéro", async () => {
    session.email = OWNER;
    store.rows = [];
    const html = await render();
    expect(html).toContain("Aucun retour pour l&#x27;instant.");
    expect(html).not.toContain("<table");
    expect(html).not.toMatch(/0\s?%/);
  });

  it("table absente (migration non appliquée) : on le dit, pas de page vide", async () => {
    session.email = OWNER;
    store.rows = "missing";
    expect(await render()).toContain("les migrations 20260917000016 et 20260917000017 ne sont pas");
  });
});
