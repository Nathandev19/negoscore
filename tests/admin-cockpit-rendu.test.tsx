import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AdminUsersPage, DashboardData } from "@/lib/admin/data";

// Mission #103 — ce que le cockpit AFFICHE, rendu pour de vrai.
//
// /admin est réservé au propriétaire : sans session vérifiée par Supabase Auth
// dont l'adresse vaut OWNER_EMAIL, la page répond comme une adresse
// inexistante. Elle ne peut donc pas être ouverte depuis ce poste. On rend
// donc les vrais composants de page, avec leurs vraies données, et on lit le
// balisage produit : c'est la même sortie que celle qui atteindrait l'écran.

const data = vi.hoisted(() => ({
  dashboard: null as DashboardData | "missing" | null,
  users: null as AdminUsersPage | "missing" | null,
}));

vi.mock("@/lib/admin/data", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admin/data")>()),
  loadDashboard: async () => data.dashboard,
  loadAdminUsers: async () => data.users,
}));

const { default: AdminDashboard } = await import("@/app/admin/page");
const { default: AdminUsers } = await import("@/app/admin/users/page");

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&#xE9;/g, "é")
    .replace(/&#x2019;/g, "’")
    .replace(/[\s  ]+/g, " ");

// L'état réel de la base après la migration du 24/09 : 234 événements, tous
// hors production (local et prévisualisations), aucun utilisateur réel.
const APRES_MIGRATION: DashboardData = {
  counts: {},
  excluded: 234,
  internal: 12,
  paid_pro: 0,
  granted_pro: 0,
  feedback: { total: 0, fair: 0, not_fair: 0 },
  purchases: { purchases: 0, revenue_eur: 0, revenue_covered: 0 },
  timeseries: [],
  acquisition: [],
};

async function dashboard(value: DashboardData | "missing"): Promise<string> {
  data.dashboard = value;
  return renderToStaticMarkup(await AdminDashboard({ searchParams: Promise.resolve({}), params: Promise.resolve({}) }));
}

describe("le tableau de bord, tel qu'il s'affiche", () => {
  it("la ligne d'exclusions dit ce qui a été écarté, et les compteurs sont à zéro", async () => {
    const page = text(await dashboard(APRES_MIGRATION));

    expect(page).toContain("Production uniquement. 234 événement(s) hors production exclus sur la période");
    expect(page).toContain("Visites mesurées");
    // Aucun utilisateur réel : c'est le résultat attendu, pas une panne.
    expect(page).toContain("Cockpit");
    expect(page).not.toContain("NaN");
  });

  it("« Taux visite → analyse » a disparu, les deux compteurs bruts restent", async () => {
    const page = text(await dashboard({ ...APRES_MIGRATION, counts: { landing_view: 12, analysis_started: 9, analysis_completed: 7 } }));

    expect(page).not.toContain("Taux visite");
    expect(page).toContain("Analyses lancées");
    expect(page).toContain("Analyses terminées");
    // Aucun pourcentage au-delà de 100 sur la page entière.
    for (const [, value] of [...page.matchAll(/(-?\d+) %/g)]) expect(Number(value)).toBeLessThanOrEqual(100);
  });

  it("les quatre périodes restent proposées", async () => {
    const page = text(await dashboard(APRES_MIGRATION));
    for (const label of ["24 h", "7 jours", "30 jours", "Tout"]) expect(page).toContain(label);
  });

  it("migration absente : le cockpit le dit, il n'invente pas de zéros", async () => {
    const page = text(await dashboard("missing"));
    expect(page).toContain("Le cockpit attend la migration admin");
    expect(page).not.toContain("Production uniquement.");
  });
});

describe("la liste des utilisateurs", () => {
  it("la colonne s'appelle « Dossiers », et plus « Analyses »", async () => {
    data.users = {
      total: 1,
      items: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          email: "creatrice@exemple.test",
          created_at: "2026-09-20T10:00:00.000Z",
          balance: 0,
          plan: "free",
          period_end: null,
          admin_grant: false,
          analyses: 0,
          last_activity: "2026-09-20T10:00:00.000Z",
        },
      ],
    };
    const page = text(renderToStaticMarkup(await AdminUsers({ searchParams: Promise.resolve({}), params: Promise.resolve({}) })));

    expect(page).toContain("Dossiers");
    // Le mot « Analyses » ne désigne plus deux choses : il reste dans le tri,
    // pas dans l'en-tête de colonne.
    expect(page).toContain("Compte Accès Crédits Dossiers Inscription");
    // Un dossier créé en local ne compte plus : la RPC ne rend que la production.
    expect(page).toContain("creatrice@exemple.test");
  });
});
