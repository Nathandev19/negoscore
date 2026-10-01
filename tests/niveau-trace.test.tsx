import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { DashboardData } from "@/lib/admin/data";
import { tierChangesNotice } from "@/lib/admin/data";
import { PRODUCT_EVENTS } from "@/lib/analytics/first-party";
import { composeAnalysis } from "@/lib/analysis/compose";
import { recomputeForTier } from "@/lib/analysis/recompute";
import { extractionSchema } from "@/lib/llm/prompt";
import sampleExtraction from "@/lib/fixtures/sample-extraction.json";
import { TIERS } from "@/lib/rates/tier";

// Mission #130 — LE CHANGEMENT DE NIVEAU LAISSE UNE TRACE.
//
// Constat du 01/10 : les huit analyses enregistrées affichaient toutes
// « starter », sans exception. Établi avant de corriger quoi que ce soit :
// ce n'est pas un défaut d'écriture, c'est le comportement voulu depuis la
// mission #039. Changer de niveau recalcule tout DANS LE NAVIGATEUR et
// n'écrit rien sur la ligne de l'analyse.
//
// Ce qui manquait, c'est de pouvoir savoir si quelqu'un avait seulement
// essayé. Le niveau consulté devient un événement ; le niveau de l'analyse,
// lui, reste celui de son calcul.

const base = extractionSchema.parse(structuredClone(sampleExtraction));

describe("ce qui est enregistré, et ce qui ne l'est pas", () => {
  it("le recalcul est pur : il rend un nouvel objet, il n'écrit rien", () => {
    const stored = composeAnalysis(base, { tier: "starter" });
    const shown = recomputeForTier(stored, "experienced");
    // L'analyse enregistrée n'a pas bougé d'un champ.
    expect(stored.profile_tier).toBe("starter");
    expect(shown.profile_tier).toBe("experienced");
    expect(shown).not.toBe(stored);
    // Et la fourchette affichée n'est plus celle qui est enregistrée : c'est
    // exactement pour ça qu'on n'écrase pas le niveau sur la ligne.
    expect(shown.estimate.total_high).not.toBe(stored.estimate.total_high);
  });

  it("aucun chemin du produit ne réécrit le niveau d'une analyse", () => {
    // Le seul `update` jamais posé sur public.analyses concerne la relance
    // gratuite (migration 018). Le niveau vit dans le payload, écrit une fois.
    const ecritures: string[] = [];
    for (const fichier of [
      "lib/analysis/recompute.ts",
      "lib/rates/tier-preference.ts",
      "app/api/niveau/route.ts",
      "components/result/tier-selector.tsx",
    ]) {
      const source = readFileSync(fichier, "utf8");
      if (/updateRows\(\s*"analyses"/.test(source)) ecritures.push(fichier);
    }
    expect(ecritures).toEqual([]);
  });

  it("la colonne de /admin dit ce qu'elle montre : le niveau INITIAL", async () => {
    const page = readFileSync("app/admin/analyses/page.tsx", "utf8");
    expect(page).toContain("<th>Niveau initial</th>");
    expect(page).not.toContain("<th>Niveau</th>");
    // Et elle lit bien le champ du payload, celui du calcul.
    // La DERNIÈRE définition de admin_analyses_page fait foi : celle que la
    // base porte une fois toutes les migrations appliquées.
    const { readdirSync } = await import("node:fs");
    const sql = readdirSync("supabase/migrations").sort()
      .map((f) => readFileSync(`supabase/migrations/${f}`, "utf8"))
      .filter((t) => t.includes("function public.admin_analyses_page"))
      .at(-1) as string;
    expect(sql).toContain("a.payload #>> '{profile_tier}' as profile_tier");
  });
});

describe("le niveau consulté devient un événement", () => {
  it("le nom existe, et le sélecteur le signale pour tout le monde", () => {
    expect([...PRODUCT_EVENTS]).toContain("tier_changed");
    const selector = readFileSync("components/result/tier-selector.tsx", "utf8");
    // Signalé AVANT la mémorisation sur le compte, et sans condition de session :
    // le niveau est consulté par des visiteurs sans compte aussi.
    expect(selector).toContain("reportTierChange(tier);");
    expect(selector.indexOf("reportTierChange(tier);")).toBeLessThan(selector.indexOf("if (!signedIn) return;"));
    // Et le refus de suivi est respecté, comme pour les vues de page.
    expect(selector).toContain('navigator.doNotTrack === "1"');
  });

  it("le navigateur ne choisit pas une valeur, il choisit une entrée", async () => {
    const { bodySchema } = await import("@/app/api/events/route");
    for (const tier of TIERS) {
      expect(bodySchema.safeParse({ event: "tier_changed", tier }).success, tier).toBe(true);
    }
    for (const hostile of ["", "admin", "__proto__", "STARTER", 1, null]) {
      expect(bodySchema.safeParse({ event: "tier_changed", tier: hostile }).success, String(hostile)).toBe(false);
    }
    // Et la route n'accepte toujours aucun événement que le serveur seul écrit.
    const route = readFileSync("app/api/events/route.ts", "utf8");
    const publics = /const PUBLIC_EVENTS = \[([^\]]*)\]/.exec(route)?.[1] ?? "";
    for (const serveur of ["analysis_started", "analysis_completed", "purchase_completed", "signup"]) {
      expect(publics, serveur).not.toContain(serveur);
    }
  });

  it("le niveau part dans entity_id, et seulement pour cet événement", async () => {
    vi.resetModules();
    const ecrits: Array<Record<string, unknown>> = [];
    vi.doMock("@/lib/analytics/first-party", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@/lib/analytics/first-party")>()),
      recordProductEvent: async (input: Record<string, unknown>) => {
        ecrits.push(input);
      },
    }));
    const { POST } = await import("@/app/api/events/route");
    const envoyer = (corps: Record<string, unknown>) =>
      POST(
        new Request("https://negoscore.fr/api/events", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "https://negoscore.fr",
            "sec-fetch-site": "same-origin",
            "user-agent":
              "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
          },
          body: JSON.stringify(corps),
        }),
      );

    expect((await envoyer({ event: "tier_changed", tier: "experienced" })).status).toBe(204);
    expect(ecrits.at(-1)).toMatchObject({ event: "tier_changed", entityType: "niveau", entityId: "experienced" });

    // Une vue de page ne porte aucun niveau, même si le corps en annonce un.
    expect((await envoyer({ event: "landing_view", tier: "experienced", attribution: { path: "/" } })).status).toBe(204);
    expect(ecrits.at(-1)).toMatchObject({ event: "landing_view", entityType: null, entityId: null });

    // Un niveau inconnu fait refuser le corps entier, sans rien écrire.
    const avant = ecrits.length;
    expect((await envoyer({ event: "tier_changed", tier: "admin" })).status).toBe(400);
    expect(ecrits).toHaveLength(avant);
    vi.doUnmock("@/lib/analytics/first-party");
    vi.resetModules();
  });

  it("la base admet ce nom : sans ça, chaque signalement repart en 400", () => {
    const sql = readFileSync("supabase/migrations/20261001000035_niveau_consulte.sql", "utf8");
    const blocs = [...sql.matchAll(/check\s*\(\s*event_name\s+in\s*\(([^)]*)\)/gi)];
    expect(blocs.length).toBeGreaterThan(0);
    const autorises = [...blocs[blocs.length - 1][1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    for (const event of PRODUCT_EVENTS) expect(autorises, event).toContain(event);
    // L'agrégat lit `filtered` : production et trafic non interne déjà écartés.
    const agregat = sql.slice(sql.indexOf("), tier_changes as ("), sql.indexOf("), feedback as ("));
    expect(agregat).toContain("from filtered");
    expect(agregat).toContain("where event_name = 'tier_changed'");
    expect(agregat).not.toContain("public.product_events");
  });
});

describe("ce que le cockpit affiche", () => {
  const dashboard = (tier_changes: DashboardData["tier_changes"]): DashboardData => ({
    counts: {}, excluded: 0, internal: 0, paid_pro: 0, granted_pro: 0,
    feedback: { total: 0, fair: 0, not_fair: 0 },
    purchases: { purchases: 0, revenue_eur: 0, revenue_covered: 0 },
    timeseries: [], acquisition: [], guides: [], example: { total: 0, direct: 0 },
    tier_changes,
  });

  it("aucun changement : la ligne le dit, et rappelle ce que le niveau signifie", () => {
    const texte = tierChangesNotice(dashboard([]));
    expect(texte).toContain("Aucun changement de niveau");
    expect(texte).toContain("reste celui de son calcul");
  });

  it("des changements : le total et le détail par niveau, en libellés lisibles", () => {
    const texte = tierChangesNotice(
      dashboard([
        { tier: "experienced", changes: 7 },
        { tier: "confirmed", changes: 2 },
      ]),
    );
    expect(texte).toContain("9 changement(s) de niveau");
    expect(texte).toContain("C'est mon métier : 7");
    expect(texte).toContain("Déjà des collabs payées : 2");
  });

  it("la ligne est affichée dans le cockpit", async () => {
    // Mission #132 — le cockpit est devenu un composant client, pour changer
    // de période sans recharger. La ligne y est rendue, pas dans la page.
    const page = readFileSync("components/admin/cockpit.tsx", "utf8");
    expect(page).toContain("tierChangesNotice(data)");
    // Migration pas encore appliquée : un tableau vide, pas un affichage cassé.
    expect(readFileSync("lib/admin/data.ts", "utf8")).toContain("tier_changes: data.tier_changes ?? []");
    expect(renderToStaticMarkup(<p>{tierChangesNotice(dashboard([]))}</p>)).toContain("Aucun changement");
  });
});
