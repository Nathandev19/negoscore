import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dashboardTiles, excludedNotice, share, type DashboardData } from "@/lib/admin/data";

// Mission #103 — ce que le cockpit compte, et ce qu'il refuse d'afficher.
//
// L'agrégation elle-même est en SQL (admin_dashboard_metrics). Ce fichier
// vérifie les deux choses qui sont vérifiables sans base : le texte de la
// migration — chaque source filtrée sur la production — et les règles
// d'affichage, sorties du composant pour pouvoir être mises à l'épreuve.

const MIGRATION = readFileSync("supabase/migrations/20260924000031_telemetry_environment.sql", "utf8").replace(/\r\n/g, "\n");
// Le corps des fonctions, sans les commentaires : ce qui s'exécute vraiment.
const SQL = MIGRATION.replace(/^\s*--.*$/gm, "");

function dashboard(patch: Partial<DashboardData> = {}): DashboardData {
  return {
    counts: {}, excluded: 0, internal: 0, paid_pro: 0, granted_pro: 0,
    feedback: { total: 0, fair: 0, not_fair: 0 },
    purchases: { purchases: 0, revenue_eur: 0, revenue_covered: 0 },
    timeseries: [], acquisition: [],
    ...patch,
  };
}

describe("la RPC ne compte que la production", () => {
  it("chaque source du tableau de bord porte le filtre", () => {
    const metrics = SQL.slice(SQL.indexOf("function public.admin_dashboard_metrics"), SQL.indexOf("function public.admin_users_page"));
    // Les trois tables agrégées : événements, retours, achats.
    expect(metrics).toContain("from public.product_events\n  where environment = 'production'");
    expect(metrics).toContain("from public.analysis_feedback\n  where environment = 'production'");
    expect(metrics).toContain("from public.purchases\n  where environment = 'production'");
    // Et le reste, compté à part.
    expect(metrics).toContain("where environment <> 'production'");
    expect(metrics).toContain("'excluded'");
  });

  it("les listes comptent la même chose que le tableau de bord", () => {
    const users = SQL.slice(SQL.indexOf("function public.admin_users_page"), SQL.indexOf("function public.admin_analyses_page"));
    // Le compte de dossiers de la colonne « Dossiers »…
    expect(users).toContain("from public.deals d where d.user_id=p.id and d.environment='production') as analyses");
    // …et les deux sources de la dernière activité.
    expect(users).toContain("max(d.created_at) from public.deals d where d.user_id=p.id and d.environment='production'");
    expect(users).toContain("pe.environment='production'");
    const analyses = SQL.slice(SQL.indexOf("function public.admin_analyses_page"));
    expect(analyses).toContain("a.environment='production'");
  });

  it("rien n'est supprimé ni reclassifié : l'historique bascule en unknown par le défaut", () => {
    expect(SQL).not.toMatch(/\bdelete\s+from\b|\btruncate\b|\bdrop\s+table\b/i);
    // Une colonne non nulle, avec un défaut : les lignes existantes ne sont
    // pas réécrites une par une, elles valent « unknown ».
    for (const table of ["product_events", "analysis_feedback", "analyses", "deals", "purchases"]) {
      expect(SQL).toContain(`alter table public.${table} add column if not exists environment text not null default 'unknown'`);
      expect(SQL).toContain(`check (environment in ('production', 'preview', 'development', 'test', 'unknown'))`);
    }
    // Aucune mise à jour de masse qui devinerait l'origine des lignes.
    expect(SQL).not.toMatch(/update public\.(product_events|analyses|deals|analysis_feedback|purchases)\s+set environment/i);
  });

  it("un index couvre le filtre, sur chaque table interrogée par période", () => {
    expect(SQL).toContain("on public.product_events (environment, occurred_at desc)");
    expect(SQL).toContain("on public.product_events (environment, event_name, occurred_at desc)");
    expect(SQL).toContain("on public.analysis_feedback (environment, updated_at desc)");
    expect(SQL).toContain("on public.purchases (environment, paid_at desc)");
    expect(SQL).toContain("on public.analyses (environment, created_at desc)");
    expect(SQL).toContain("on public.deals (environment, created_at desc)");
  });
});

describe("aucun chiffre affiché ne peut mentir", () => {
  it("le taux visite → analyse a disparu de l'écran", () => {
    const page = readFileSync("app/admin/page.tsx", "utf8");
    const labels = dashboardTiles(dashboard({ counts: { landing_view: 4, analysis_started: 20 } })).map((tile) => tile.label);
    expect(labels).not.toContain("Taux visite → analyse");
    expect(page).not.toMatch(/analysisRate/);
    // Les deux compteurs bruts restent, côte à côte.
    expect(labels).toContain("Analyses lancées");
    expect(labels).toContain("Analyses terminées");
  });

  it("aucun ratio ne dépasse 100 %, même sur des données absurdes", () => {
    const absurde = dashboard({
      counts: { landing_view: 1, pricing_view: 0, analysis_started: 505, analysis_completed: 900 },
      feedback: { total: 3, fair: 3, not_fair: 0 },
    });
    for (const tile of dashboardTiles(absurde)) {
      const percent = /(-?\d+) %/.exec(tile.value);
      if (!percent) continue;
      expect(Number(percent[1])).toBeGreaterThanOrEqual(0);
      expect(Number(percent[1])).toBeLessThanOrEqual(100);
    }
    // La règle qui le garantit : une part hors de son tout n'est pas un taux.
    expect(share(505, 1)).toBeNull();
    expect(share(-1, 10)).toBeNull();
    expect(share(3, 3)).toBe("100 %");
  });

  it("aucune donnée : pas de division par zéro, un tiret propre", () => {
    const vide = dashboardTiles(dashboard());
    expect(vide.find((tile) => tile.label === "Estimations jugées justes")?.value).toBe("—");
    expect(vide.every((tile) => !tile.value.includes("NaN") && !tile.value.includes("Infinity"))).toBe(true);
    expect(share(0, 0)).toBeNull();
  });

  it("la ligne d'exclusions dit combien de lignes ont été écartées", () => {
    expect(excludedNotice(dashboard({ excluded: 218 }))).toContain("218 événement(s) hors production exclus");
    expect(excludedNotice(dashboard())).toContain("0 événement(s)");
  });

  it("les deux concepts de la page utilisateurs ont deux mots", () => {
    const liste = readFileSync("app/admin/users/page.tsx", "utf8");
    const fiche = readFileSync("app/admin/users/[id]/page.tsx", "utf8");
    expect(liste).toContain("<th>Dossiers</th>");
    expect(liste).not.toContain("<th>Analyses</th>");
    expect(fiche).toContain('"Analyses calculées"');
  });
});
