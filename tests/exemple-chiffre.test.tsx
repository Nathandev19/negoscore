import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FULL_EXAMPLE } from "@/lib/content/vocabulaire";
import type { Analysis } from "@/lib/schema";

// Mission #119, partie B — /analyse/demo cesse d'être orpheline.
//
// Constat du 28/09 : la page est indexée par Google et c'est la plus
// convaincante du site pour un inconnu — exemple chiffré complet, mention
// honnête que l'offre est inventée, appel à l'action. Elle n'était atteignable
// que depuis l'accueil ; les TROIS GUIDES, qui sont les pages d'arrivée depuis
// la recherche, n'y menaient pas.

vi.mock("@/components/deal-input", () => ({ DealInput: ({ note }: { note?: string }) => <form aria-label="saisie">{note}</form> }));
vi.mock("@/components/analytics/track-view", () => ({ TrackView: () => null }));
vi.mock("@/components/analytics/first-party-view", () => ({ FirstPartyView: () => null, currentAttribution: () => ({}) }));

const GUIDES = ["/combien-facturer", "/produits-offerts", "/droits-utilisation"] as const;
const FICHIER: Record<string, string> = {
  "/combien-facturer": "app/combien-facturer/page.tsx",
  "/produits-offerts": "app/produits-offerts/page.tsx",
  "/droits-utilisation": "app/droits-utilisation/page.tsx",
  "/": "app/page.tsx",
};

function anchors(html: string): Array<{ href: string; text: string }> {
  return [...html.matchAll(/<a ([^>]*)>([\s\S]*?)<\/a>/g)].map((match) => ({
    href: match[1].match(/href="([^"]*)"/)?.[1] ?? "",
    text: match[2].replace(/<[^>]+>/g, "").replace(/&#x27;|&apos;/g, "'").replace(/\s+/g, " ").trim(),
  }));
}

async function render(path: string): Promise<string> {
  const loaded = await import(`@/${FICHIER[path].replace(/\.tsx$/, "")}`);
  const Page = loaded.default as () => React.ReactElement;
  return renderToStaticMarkup(Page());
}

describe("le lien vers l'exemple chiffré", () => {
  it("les trois guides y mènent, avec le libellé du vocabulaire", async () => {
    for (const guide of GUIDES) {
      const found = anchors(await render(guide)).filter((a) => a.href === FULL_EXAMPLE.href);
      expect(found, guide).toHaveLength(1);
      expect(found[0].text, guide).toBe(FULL_EXAMPLE.label);
    }
  });

  it("l'accueil aussi, et avec le MÊME libellé : une page, une formule", async () => {
    const found = anchors(await render("/")).filter((a) => a.href === FULL_EXAMPLE.href);
    expect(found).toHaveLength(1);
    expect(found[0].text).toBe(FULL_EXAMPLE.label);
  });

  it("le libellé dit ce qu'on y trouve, jamais « démo »", () => {
    expect(FULL_EXAMPLE.label.toLowerCase()).not.toContain("démo");
    expect(FULL_EXAMPLE.label.toLowerCase()).not.toContain("demo");
    // Il annonce une analyse, et qu'elle est chiffrée : les deux raisons d'y aller.
    expect(FULL_EXAMPLE.label).toMatch(/analyse/i);
    expect(FULL_EXAMPLE.label).toMatch(/chiffr/i);
  });

  it("le libellé n'est écrit qu'une fois, dans le vocabulaire", () => {
    for (const fichier of Object.values(FICHIER)) {
      const source = readFileSync(fichier, "utf8");
      expect(source, fichier).toContain("FULL_EXAMPLE");
      // Aucune page ne réécrit le texte à la main.
      expect(source, fichier).not.toContain(FULL_EXAMPLE.label);
    }
  });

  it("ce sont des liens, pas des composants : la page tient sans JavaScript", () => {
    for (const fichier of Object.values(FICHIER)) {
      const source = readFileSync(fichier, "utf8");
      expect(source, fichier).not.toMatch(/^\s*["']use client["']/m);
    }
    // Rendu côté serveur, sans la moindre hydratation : l'ancre est dans le HTML.
    expect(FULL_EXAMPLE.href).toBe("/analyse/demo");
  });

  it("la page visée existe, et dit toujours que l'offre est inventée", async () => {
    const source = readFileSync("app/analyse/demo/page.tsx", "utf8");
    expect(source).toContain("Exemple, pas une vraie analyse");
    expect(source).toContain("l&apos;offre est inventée");
  });
});

describe("rien d'autre n'a bougé", () => {
  it("les guides gardent leur appel à l'action principal", async () => {
    for (const guide of GUIDES) {
      const hrefs = anchors(await render(guide)).map((a) => a.href);
      expect(hrefs, guide).toContain("/analyse");
    }
  });

  it("aucun moteur de chiffrage touché par cette mission", () => {
    // Les deux fichiers qui décident des fourchettes ne mentionnent ni le
    // lien, ni les chemins courts : la partie A et la partie B sont
    // strictement de la copie et de l'aiguillage.
    for (const fichier of ["lib/rates/engine.ts", "lib/rates/fr-2026.3.json", "lib/rates/score.ts"]) {
      const source = readFileSync(fichier, "utf8");
      for (const ajout of ["FULL_EXAMPLE", "analyse/demo", "SHORT_PATHS", "ACQUISITION_UTM"]) {
        expect(source, `${fichier} / ${ajout}`).not.toContain(ajout);
      }
    }
    // (« instagram » n'est pas dans cette liste : c'est une PLATEFORME de la
    // table de tarifs, et elle y était bien avant cette mission.)
  });

  // Le contrôle de référence vit dans tests/arrondi-fourchette.test.ts. Il est
  // refait ICI pour qu'une régression causée par cette mission fasse tomber un
  // test DE CETTE MISSION, et pas seulement un test d'une autre.
  it("les quatre fourchettes des vidéos déjà tournées sont inchangées", async () => {
    const { computeEstimate } = await import("@/lib/rates/engine");
    const { analysisSchema } = await import("@/lib/schema");
    const sample = (await import("@/lib/fixtures/sample-extraction.json")).default;
    type Deal = Analysis["deal"];
    const BASE = analysisSchema.shape.deal.parse((sample as { deal: unknown }).deal);
    const NO_RIGHTS = {
      usage: { organic: true, paid_ads: false, whitelisting: false, spark_ads: false, perpetual: false, duration_months: null, territory: null },
      exclusivity: { present: false, duration_months: null, category: null },
      raw_footage: false,
      ip_transfer: "none" as const,
      ai_training_rights: "absent" as const,
    };
    const deal = (patch: Partial<Deal>): Deal => ({ ...BASE, ...NO_RIGHTS, ...patch });
    const video = (quantity: number) => ({ type: "video" as const, platform: "tiktok" as const, quantity, format: null });
    const story = (quantity: number) => ({ type: "story" as const, platform: "instagram" as const, quantity, format: null });
    const photo = (quantity: number) => ({ type: "photo" as const, platform: "instagram" as const, quantity, format: null });
    const range = (subject: Deal, tier: "starter" | "experienced") => {
      const estimate = computeEstimate(subject, { tier });
      return [estimate.total_low, estimate.total_high];
    };

    expect(range(deal({ deliverables: [video(2)] }), "experienced")).toEqual([1000, 1600]);

    const lot = deal({
      deliverables: [video(1), story(3), photo(3)],
      usage: { organic: true, paid_ads: false, whitelisting: true, spark_ads: false, perpetual: false, duration_months: 3, territory: "monde entier" },
    });
    expect(range(lot, "starter")).toEqual([540, 1190]);
    expect(range(lot, "experienced")).toEqual([2700, 5280]);

    const gros = deal({
      deliverables: [video(4), story(6), photo(1)],
      usage: { organic: true, paid_ads: false, whitelisting: true, spark_ads: false, perpetual: false, duration_months: 3, territory: null },
      exclusivity: { present: true, duration_months: 1, category: "x" },
    });
    expect(range(gros, "starter")).toEqual([970, 2210]);
  });
});
