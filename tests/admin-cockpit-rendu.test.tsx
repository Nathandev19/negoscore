import { readFileSync } from "node:fs";
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

vi.mock("@/lib/admin/data", async (importOriginal) => {
  const vrai = await importOriginal<typeof import("@/lib/admin/data")>();
  return {
    ...vrai,
    loadDashboard: async () => data.dashboard,
    // Mission #133 — /admin charge les QUATRE périodes d'un coup. Le faux rend
    // les mêmes chiffres pour chacune : ce qui est vérifié ici, c'est ce que la
    // page AFFICHE pour des données données, pas le découpage des périodes.
    loadDashboards: async () =>
      Object.fromEntries(vrai.ADMIN_PERIODS.map((period) => [period, data.dashboard])) as Record<
        import("@/lib/admin/data").AdminPeriod,
        DashboardData | "missing"
      >,
    loadAdminUsers: async () => data.users,
  };
});

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
  guides: [],
  example: { total: 0, direct: 0 },
  tier_changes: [],
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

// Mission #120 — les pages d'arrivée depuis un moteur de recherche, une fois
// qu'elles ont produit quelque chose.
const AVEC_GUIDES: DashboardData = {
  ...APRES_MIGRATION,
  counts: { guide_view: 42, example_view: 9 },
  excluded: 0,
  internal: 0,
  guides: [
    { path: "/combien-facturer", views: 30, to_example: 6 },
    { path: "/produits-offerts", views: 12, to_example: 1 },
  ],
  example: { total: 9, direct: 2 },
};

describe("le tableau de bord, tel qu'il s'affiche", () => {
  it("ventile seulement non_attribue par domaine avec les trois compteurs", async () => {
    const html = await dashboard({
      ...APRES_MIGRATION,
      acquisition: [
        { source: "instagram", campaign: "lancement", content: "bio", visits: 4, analyses: 1, signups: 0, purchases: 0 },
        { source: "non_attribue", campaign: "non_attribue", content: "non_attribue", visits: 10, analyses: 2, signups: 0, purchases: 1,
          referrers: [{ referrer: "google", visits: 6, analyses: 1, purchases: 1 }, { referrer: "inconnu", visits: 4, analyses: 1, purchases: 0 }] },
      ],
    });
    const page = text(html);
    expect(page).toContain("↳ google 6 1 1");
    expect(page).toContain("↳ inconnu 4 1 0");
    expect(page).toContain("instagram lancement · bio");
    expect(page).toContain("Les visites antérieures à cette mesure n’ont pas de référent enregistré");
  });

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

// Mission #129 — « VISITES » NE PEUT PAS VALOIR DEUX NOMBRES.
//
// Relevé en production le 01/10 : période « Tout », tuile 100, funnel 84 ;
// période « 24 h », tuile 18, funnel 7. L'écart valait exactement les vues
// de guides et d'exemple. La tuile appliquait VISIT_EVENTS, le funnel
// additionnait encore landing_view + pricing_view dans son propre composant.
//
// Ce test compare les deux nombres RENDUS, pas deux constantes : il lit la
// page comme on la lit à l'écran, et il échouerait de nouveau si l'un des
// deux affichages reprenait un calcul à son compte.
describe("mission #129 — un seul nombre pour « Visites »", () => {
  // Le nombre affiché sous le libellé d'une tuile.
  const tuile = (html: string, label: string): number => {
    const depuis = html.indexOf(label);
    expect(depuis, label).toBeGreaterThan(-1);
    // Mission #132 — la classe `figures` n'est plus en tête de l'attribut
    // (`cockpit-valeur figures …`) : on la cherche où qu'elle soit.
    const trouve = /class="[^"]*\bfigures\b[^"]*">([^<]+)</.exec(html.slice(depuis));
    expect(trouve, label).not.toBeNull();
    return Number((trouve?.[1] ?? "").replace(/[^0-9]/g, ""));
  };
  // Le nombre affiché en face d'une étape du funnel.
  const etape = (html: string, label: string): number => {
    // Mission #132 — les deux balises portent maintenant des classes : on
    // vise le libelle puis le premier nombre en gras qui le suit.
    const depuis = html.indexOf(`>${label}</span>`);
    expect(depuis, label).toBeGreaterThan(-1);
    const trouve = /<strong[^>]*>([^<]+)<\/strong>/.exec(html.slice(depuis));
    expect(trouve, label).not.toBeNull();
    return Number((trouve?.[1] ?? "-1").replace(/[^0-9-]/g, ""));
  };

  const CAS: Array<[string, Record<string, number>, number]> = [
    ["production, période Tout", { landing_view: 80, pricing_view: 4, guide_view: 12, example_view: 4 }, 100],
    ["production, période 24 h", { landing_view: 6, pricing_view: 1, guide_view: 9, example_view: 2 }, 18],
    ["aucune vue de guide ni d'exemple", { landing_view: 42, pricing_view: 8 }, 50],
    ["uniquement des arrivées sur l'exemple", { example_view: 7 }, 7],
    ["cockpit vide", {}, 0],
  ];

  it.each(CAS)("%s : la tuile et le funnel affichent le même nombre", async (_nom, counts, attendu) => {
    const html = await dashboard({ ...APRES_MIGRATION, counts });
    expect(tuile(html, "Visites mesurées")).toBe(etape(html, "Visites"));
    expect(tuile(html, "Visites mesurées")).toBe(attendu);
  });

  it.each(CAS.slice(0, 2))("%s : 37 arrivées sur l'analyse ne changent pas les visites", async (_nom, counts, attendu) => {
    const avant = await dashboard({ ...APRES_MIGRATION, counts });
    const apres = await dashboard({ ...APRES_MIGRATION, counts: { ...counts, analysis_page_view: 37 } });
    expect([tuile(avant, "Visites mesurées"), tuile(apres, "Visites mesurées")]).toEqual([attendu, attendu]);
    expect([etape(avant, "Visites"), etape(apres, "Visites")]).toEqual([attendu, attendu]);
    expect(etape(apres, "Arrivées sur la page d’analyse")).toBe(37);
  });

  it("place les arrivées sur l'analyse entre les visites et les analyses lancées", async () => {
    const html = await dashboard({ ...APRES_MIGRATION, counts: { landing_view: 10, analysis_page_view: 7, analysis_started: 4 } });
    expect([etape(html, "Visites"), etape(html, "Arrivées sur la page d’analyse"), etape(html, "Analyses lancées")]).toEqual([10, 7, 4]);
    expect(html.indexOf(">Visites</span>")).toBeLessThan(html.indexOf(">Arrivées sur la page d’analyse</span>"));
    expect(html.indexOf(">Arrivées sur la page d’analyse</span>")).toBeLessThan(html.indexOf(">Analyses lancées</span>"));
  });

  it("le funnel ne recalcule rien lui-même", () => {
    const source = readFileSync("components/admin/charts.tsx", "utf8");
    // Aucune addition d'événements recopiée dans le composant : il appelle
    // la seule fonction qui définit le mot.
    expect(source).toContain("visitCount(data)");
    expect(source).not.toMatch(/counts\.landing_view|counts\.pricing_view/);
  });
});

describe("mission #120 — guides et exemple chiffré", () => {
  it("rien mesuré : le bloc n'apparaît pas du tout", async () => {
    expect(text(await dashboard(APRES_MIGRATION))).not.toContain("Guides et exemple chiffré");
  });

  it("une ligne par guide, ses vues, ses clics vers l'exemple et la part", async () => {
    const page = text(await dashboard(AVEC_GUIDES));
    expect(page).toContain("Guides et exemple chiffré");
    expect(page).toContain("/combien-facturer");
    expect(page).toContain("/produits-offerts");
    // 6 clics sur 30 vues, et 1 sur 12.
    expect(page).toMatch(/\/combien-facturer 30 6 20 %/);
    expect(page).toMatch(/\/produits-offerts 12 1 8 %/);
  });

  it("la ligne de synthèse distingue le lien du site de l'arrivée directe", async () => {
    const page = text(await dashboard(AVEC_GUIDES));
    expect(page).toContain("Exemple chiffré : 9 vue(s) au total");
    expect(page).toContain("dont 7 depuis un lien du site");
    expect(page).toContain("2 en arrivée directe");
  });
});
