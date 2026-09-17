import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RETRY_WINDOW_DAYS } from "@/lib/analysis/retry-window";
import { ANON_ANALYSIS_PURGE_AFTER_DAYS, ANON_ANALYSIS_RETENTION_DAYS, purgeCutoffs } from "@/lib/privacy/purge";

// Mission #061 — trois garanties de texte et de données :
//   F. une analyse lancée sans compte est supprimée au bout de 30 jours ;
//   D. aucun marqueur « [[ … ]] » ne part en production ;
//   H3. les délais en jours viennent des constantes, jamais du texte.

type DealRow = { id: string; user_id: string | null; created_at: string };

const db = vi.hoisted(() => ({ deals: [] as DealRow[], deleted: [] as string[] }));

vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/server")>();
  return {
    ...actual,
    selectRows: async () => [],
    updateRows: async () => [],
    removeDocuments: async (paths: string[]) => paths,
    deleteRowsReturning: async (table: string, filter: string) => {
      if (table !== "deals") return [];
      // Le filtre réel : deals sans compte, plus vieux que la limite.
      const cutoff = decodeURIComponent(filter.match(/created_at=lt\.([^&]+)/)?.[1] ?? "");
      const anonymesOnly = filter.includes("user_id=is.null");
      const supprimes = db.deals.filter(
        (deal) => (anonymesOnly ? deal.user_id === null : true) && deal.created_at < cutoff,
      );
      db.deals = db.deals.filter((deal) => !supprimes.includes(deal));
      db.deleted.push(...supprimes.map((deal) => deal.id));
      return supprimes.map((deal) => ({ id: deal.id }));
    },
  };
});

const { runPurge } = await import("@/lib/privacy/purge");

const DAY_MS = 24 * 60 * 60 * 1000;
const age = (days: number) => new Date(Date.now() - days * DAY_MS).toISOString();

beforeEach(() => {
  db.deals = [];
  db.deleted = [];
});

describe("F — analyses lancées sans compte", () => {
  it("une analyse anonyme de 29 jours est supprimée, une de 28 jours est gardée", async () => {
    db.deals = [
      { id: "anon-29", user_id: null, created_at: age(29.5) },
      { id: "anon-28", user_id: null, created_at: age(28) },
    ];
    const report = await runPurge();
    expect(db.deleted).toEqual(["anon-29"]);
    expect(report.anon_analyses).toBe(1);
    expect(db.deals.map((deal) => deal.id)).toEqual(["anon-28"]);
  });

  it("une analyse rattachée à un compte n'est jamais supprimée, même à 60 jours", async () => {
    db.deals = [{ id: "compte-60", user_id: "11111111-1111-4111-8111-111111111111", created_at: age(60) }];
    const report = await runPurge();
    expect(db.deleted).toEqual([]);
    expect(report.anon_analyses).toBe(0);
    expect(db.deals.map((deal) => deal.id)).toEqual(["compte-60"]);
  });

  it("la marge d'un jour est la même que pour le reste de la purge", () => {
    expect(ANON_ANALYSIS_RETENTION_DAYS).toBe(30);
    expect(ANON_ANALYSIS_PURGE_AFTER_DAYS).toBe(29);
    const cutoffs = purgeCutoffs(new Date("2026-09-18T03:00:00.000Z"));
    expect(cutoffs.anonAnalyses).toBe("2026-08-20T03:00:00.000Z");
    expect(cutoffs.anonAnalyses).toBe(cutoffs.documents);
  });

  it("un second passage ne trouve plus rien", async () => {
    db.deals = [{ id: "anon-40", user_id: null, created_at: age(40) }];
    expect((await runPurge()).anon_analyses).toBe(1);
    expect((await runPurge()).anon_analyses).toBe(0);
  });
});

// Pages publiques rendues, pour y chercher ce qui ne doit jamais s'y trouver.
// Les pages entièrement serveur : l'accueil et /tarifs montent des composants
// client qui exigent le routeur, elles sont couvertes par le balayage des
// sources ci-dessous.
const PUBLIC_PAGES = [
  "app/cgv/page.tsx",
  "app/confidentialite/page.tsx",
  "app/mentions-legales/page.tsx",
  "app/combien-facturer/page.tsx",
  "app/droits-utilisation/page.tsx",
  "app/produits-offerts/page.tsx",
];

describe("D — aucun marqueur d'inachèvement en production", () => {
  it("aucune page publique ne rend « [[ »", async () => {
    for (const file of PUBLIC_PAGES) {
      const imported = (await import(/* @vite-ignore */ `@/${file.replace(/\.tsx$/, "")}`)) as { default: () => unknown };
      const html = renderToStaticMarkup(imported.default() as React.ReactElement);
      expect(html, file).not.toContain("[[");
      expect(html, file).not.toContain("À COMPLÉTER");
    }
  });

  it("aucune source de page ni de contenu ne porte le marqueur", () => {
    const sources = ["app", "components", "lib"].flatMap((dir) =>
      readdirSync(path.join(process.cwd(), dir), { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
        .map((entry) => path.join(entry.parentPath, entry.name)),
    );
    // Le composant ToFill lui-même est le seul endroit où le marqueur existe.
    const gabarit = path.join(process.cwd(), "components", "legal", "legal-page.tsx");
    const fautifs = sources.filter(
      (file) => file !== gabarit && (/<ToFill/.test(readFileSync(file, "utf8")) || /À COMPLÉTER/.test(readFileSync(file, "utf8"))),
    );
    expect(fautifs.map((file) => path.relative(process.cwd(), file))).toEqual([]);
  });
});

describe("H3 — les délais en jours viennent des constantes", () => {
  it("ni les CGV ni le panneau de relance n'écrivent la fenêtre en dur", () => {
    for (const file of ["app/cgv/page.tsx", "components/result/retry-panel.tsx", "lib/content/home.ts"]) {
      const source = readFileSync(path.join(process.cwd(), file), "utf8");
      // Le nombre lui-même n'apparaît pas : seule la constante est employée.
      expect(source.replace(/\/\/.*$/gm, ""), file).not.toMatch(new RegExp(`${RETRY_WINDOW_DAYS}\\s*jours`));
      expect(source, file).toContain("RETRY_WINDOW_DAYS");
    }
  });
});
