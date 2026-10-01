import { readdirSync, readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isRobot, refusesTracking } from "@/lib/analytics/robots";
import {
  EXAMPLE_ORIGIN_PARAM,
  EXAMPLE_ORIGINS,
  eventForPage,
  exampleHrefFrom,
  GUIDE_PATHS,
  MEASURED_PAGES,
  originPathFor,
  VIEW_PIXEL_PATH,
  viewPixelSrc,
} from "@/lib/analytics/views";
import { FULL_EXAMPLE } from "@/lib/content/vocabulaire";

// Mission #120 — les guides et la page d'exemple deviennent mesurables.
//
// Constat de #119 : seules `/` et `/tarifs` émettaient une vue. Quelqu'un qui
// arrivait de Google sur un guide, cliquait vers l'exemple chiffré et repartait
// était invisible de bout en bout.
//
// La mesure est une IMAGE D'UN PIXEL, pas un script : ces quatre pages sont
// statiques et doivent tenir sans JavaScript (garantie #074). Une mesure qui
// demande JavaScript laisserait dehors une partie des visiteurs qu'on cherche.

const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const ORIGIN = "https://www.negoscore.fr";

// Ce que recordProductEvent reçoit, sans toucher à la base.
const telemetry = vi.hoisted(() => ({ calls: [] as Array<Record<string, unknown>> }));
vi.mock("@/lib/analytics/first-party", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/analytics/first-party")>()),
  recordProductEvent: async (input: Record<string, unknown>) => {
    telemetry.calls.push(input);
  },
}));

vi.mock("@/components/deal-input", () => ({ DealInput: ({ note }: { note?: string }) => <form aria-label="saisie">{note}</form> }));
vi.mock("@/components/analytics/track-view", () => ({ TrackView: () => null }));
vi.mock("@/components/analytics/first-party-view", () => ({ FirstPartyView: () => null, currentAttribution: () => ({}) }));

const { GET: pixel } = await import("@/app/api/vue/route");

beforeEach(() => {
  telemetry.calls = [];
});
afterEach(() => {
  vi.restoreAllMocks();
});

type Ask = { page?: string | null; referer?: string | null; ua?: string | null; headers?: Record<string, string> };

function ask({ page = "/combien-facturer", referer = `${ORIGIN}/combien-facturer`, ua = UA, headers = {} }: Ask = {}) {
  const head: Record<string, string> = { "sec-fetch-dest": "image", "sec-fetch-site": "same-origin", ...headers };
  if (ua !== null) head["user-agent"] = ua;
  if (referer !== null) head.referer = referer;
  const query = page === null ? "" : `?p=${encodeURIComponent(page)}`;
  return pixel(new Request(`${ORIGIN}${VIEW_PIXEL_PATH}${query}`, { headers: head }));
}

const recorded = () => telemetry.calls.at(-1);

// ───────────────────────────────────────────────────────────────────────────
describe("la table fermée des pages mesurées", () => {
  it("les trois guides portent UN SEUL nom d'événement, le chemin les distingue", () => {
    for (const path of GUIDE_PATHS) expect(eventForPage(path), path).toBe("guide_view");
    expect(new Set(GUIDE_PATHS.map((p) => eventForPage(p))).size).toBe(1);
    expect(eventForPage("/analyse/demo")).toBe("example_view");
  });

  it("le navigateur ne choisit pas un chemin, il choisit une entrée", () => {
    for (const hostile of ["/admin", "/", "__proto__", "constructor", "toString", "", "/combien-facturer?x=1"]) {
      expect(eventForPage(hostile), hostile).toBeUndefined();
    }
    expect(eventForPage(null)).toBeUndefined();
  });

  it("chaque page mesurée a son adresse d'image, et elles sont distinctes", () => {
    const sources = Object.keys(MEASURED_PAGES).map((page) => viewPixelSrc(page));
    expect(new Set(sources).size).toBe(sources.length);
    // Deux images de même adresse ne seraient demandées qu'une fois d'un guide
    // à l'autre : le routeur navigue sans recharger la page.
    expect(viewPixelSrc("/combien-facturer")).not.toBe(viewPixelSrc("/produits-offerts"));
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("l'origine du clic vers l'exemple", () => {
  it("chaque page qui mène à l'exemple a sa clé, et elle se relit", () => {
    for (const [key, path] of Object.entries(EXAMPLE_ORIGINS)) {
      expect(exampleHrefFrom(key), key).toBe(`/analyse/demo?${EXAMPLE_ORIGIN_PARAM}=${key}`);
      expect(originPathFor(key), key).toBe(path);
    }
  });

  it("une visite sans paramètre reste valide : c'est une arrivée directe", () => {
    expect(exampleHrefFrom(null)).toBe("/analyse/demo");
    // Et le lien de base du vocabulaire ne diverge jamais de cette adresse.
    expect(FULL_EXAMPLE.href).toBe(exampleHrefFrom(null));
  });

  it("une clé inconnue ou hostile n'invente aucune ligne dans le cockpit", () => {
    for (const hostile of ["__proto__", "constructor", "/admin", "autre", ""]) {
      expect(originPathFor(hostile), hostile).toBeUndefined();
    }
    expect(originPathFor(null)).toBeUndefined();
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("l'image de mesure enregistre la vue", () => {
  it("un guide : une vue, avec son chemin", async () => {
    const response = await ask();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/gif");
    expect(recorded()).toMatchObject({ event: "guide_view", attribution: expect.objectContaining({ path: "/combien-facturer" }) });
  });

  it("l'image n'est jamais mise en cache : sinon la deuxième visite ne compte pas", async () => {
    const cache = (await ask()).headers.get("cache-control") ?? "";
    expect(cache).toContain("no-store");
    expect(cache).toContain("max-age=0");
  });

  it("l'exemple, avec l'origine du clic lue dans l'adresse de la page", async () => {
    await ask({ page: "/analyse/demo", referer: `${ORIGIN}/analyse/demo?de=combien-facturer` });
    expect(recorded()).toMatchObject({ event: "example_view", entityType: "origine", entityId: "/combien-facturer" });
  });

  it("l'exemple en arrivée directe : enregistré, sans origine", async () => {
    await ask({ page: "/analyse/demo", referer: `${ORIGIN}/analyse/demo` });
    expect(recorded()).toMatchObject({ event: "example_view", entityId: null });
  });

  it("une origine fabriquée ne devient jamais une ligne du cockpit", async () => {
    await ask({ page: "/analyse/demo", referer: `${ORIGIN}/analyse/demo?de=%2Fadmin` });
    expect(recorded()).toMatchObject({ event: "example_view", entityId: null });
  });

  it("les UTM viennent de l'adresse réellement affichée", async () => {
    await ask({ referer: `${ORIGIN}/combien-facturer?utm_source=Instagram&utm_content=BIO_instagram` });
    expect(recorded()?.attribution).toMatchObject({ utm_source: "instagram", utm_content: "bio_instagram" });
  });

  it("aucun référent : la vue est comptée quand même, sans attribution", async () => {
    await ask({ referer: null });
    expect(recorded()).toMatchObject({ event: "guide_view", attribution: expect.objectContaining({ path: "/combien-facturer", utm_source: null }) });
  });

  it("un référent d'un autre site n'apporte aucune attribution", async () => {
    await ask({ referer: "https://evil.test/x?utm_source=piege" });
    expect(recorded()?.attribution).toMatchObject({ utm_source: null });
  });

  it("page inconnue, image demandée hors d'une page : rien n'est enregistré", async () => {
    await ask({ page: "/admin" });
    await ask({ page: null });
    await ask({ headers: { "sec-fetch-dest": "document" } });
    await ask({ headers: { "sec-fetch-site": "cross-site" } });
    expect(telemetry.calls).toEqual([]);
  });

  it("la réponse est la même image, quoi qu'il arrive", async () => {
    const bonne = await ask();
    const refus = await ask({ page: "/admin" });
    expect(refus.status).toBe(bonne.status);
    expect(refus.headers.get("content-type")).toBe(bonne.headers.get("content-type"));
    expect(new Uint8Array(await refus.arrayBuffer())).toEqual(new Uint8Array(await bonne.arrayBuffer()));
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("les robots et le refus de suivi", () => {
  const ROBOTS = [
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/W.X.Y.Z Safari/537.36",
    "Mozilla/5.0 (compatible; Google-InspectionTool/1.0)",
    "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
    "facebookexternalhit/1.1",
    "Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)",
    "WhatsApp/2.23",
    "curl/8.4.0",
    "python-requests/2.31.0",
    "Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/120.0.0.0",
  ];

  it("les robots qui se nomment sont reconnus", () => {
    for (const ua of ROBOTS) expect(isRobot(ua), ua).toBe(true);
    // Aucun navigateur n'omet son User-Agent.
    expect(isRobot(null)).toBe(true);
    expect(isRobot("")).toBe(true);
  });

  it("un vrai navigateur ne l'est pas", () => {
    for (const ua of [
      UA,
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15",
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36",
    ]) {
      expect(isRobot(ua), ua).toBe(false);
    }
  });

  it("le passage d'un robot ne compte pas comme une visite", async () => {
    for (const ua of ROBOTS) await ask({ ua });
    await ask({ ua: null });
    expect(telemetry.calls).toEqual([]);
  });

  it("Do Not Track et Global Privacy Control : rien n'est enregistré", async () => {
    expect(refusesTracking(new Headers({ dnt: "1" }))).toBe(true);
    expect(refusesTracking(new Headers({ "sec-gpc": "1" }))).toBe(true);
    expect(refusesTracking(new Headers({ dnt: "0" }))).toBe(false);
    expect(refusesTracking(new Headers())).toBe(false);
    await ask({ headers: { dnt: "1" } });
    await ask({ headers: { "sec-gpc": "1" } });
    expect(telemetry.calls).toEqual([]);
  });

  it("l'ancienne mesure côté navigateur écarte les robots elle aussi", async () => {
    const { POST } = await import("@/app/api/events/route");
    const send = (ua: string | null, extra: Record<string, string> = {}) =>
      POST(
        new Request(`${ORIGIN}/api/events`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: ORIGIN,
            "sec-fetch-site": "same-origin",
            ...(ua === null ? {} : { "user-agent": ua }),
            ...extra,
          },
          body: JSON.stringify({ event: "landing_view" }),
        }),
      );
    expect((await send(UA)).status).toBe(204);
    expect(telemetry.calls).toHaveLength(1);
    // Le moteur de rendu de Google exécute le JavaScript de la page : sans ce
    // filtre, chaque exploration comptait une visite sur l'accueil.
    const robot = await send(ROBOTS[1]);
    const dnt = await send(UA, { dnt: "1" });
    // Réponse identique : le client n'apprend rien de ce qui a été fait.
    expect(robot.status).toBe(204);
    expect(dnt.status).toBe(204);
    expect(telemetry.calls).toHaveLength(1);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("les filtres de #103 et #118 s'appliquent sans rien ajouter", () => {
  it("la vue passe par le même écrivain que tous les autres événements", () => {
    const route = readFileSync("app/api/vue/route.ts", "utf8");
    expect(route).toContain("recordProductEvent");
    // Aucune écriture directe : ce serait le seul moyen de contourner
    // l'environnement (#103) et la marque interne (#118).
    expect(route).not.toMatch(/insertRow|insertIfAbsent|upsertRow|from\s+["']@\/lib\/supabase/);
    const writer = readFileSync("lib/analytics/first-party.ts", "utf8");
    expect(writer).toContain("withEnvironment");
  });

  it("une vue de guide écrite en base porte son environnement et sa marque interne", async () => {
    // Le vrai chemin d'écriture, sans le mock de recordProductEvent : on
    // regarde la LIGNE qui part, pas l'intention.
    vi.resetModules();
    const db = { rows: [] as Array<Record<string, unknown>> };
    vi.doMock("@/lib/supabase/server", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@/lib/supabase/server")>()),
      insertIfAbsent: async (_table: string, row: Record<string, unknown>) => {
        db.rows.push(row);
      },
    }));
    vi.doUnmock("@/lib/analytics/first-party");
    const { recordProductEvent } = await import("@/lib/analytics/first-party");
    await recordProductEvent({ event: "guide_view", attribution: { path: "/combien-facturer" } });
    await recordProductEvent({ event: "example_view", entityType: "origine", entityId: "/combien-facturer" });
    expect(db.rows).toHaveLength(2);
    for (const row of db.rows) {
      // #103 : décidé par le serveur, et « test » ici — donc hors production.
      expect(row.environment).toBe("test");
      // #118 : la marque interne est portée par la ligne, comme pour les autres.
      expect(row).toHaveProperty("internal");
    }
    expect(db.rows[1]).toMatchObject({ event_name: "example_view", entity_type: "origine", entity_id: "/combien-facturer" });
    vi.doUnmock("@/lib/supabase/server");
    vi.resetModules();
  });

  it("les RPC du cockpit filtrent ces événements comme les autres", () => {
    const sql = readFileSync("supabase/migrations/20260928000033_cockpit_guides.sql", "utf8");
    // Les deux nouveaux agrégats lisent `filtered`, qui porte déjà les deux
    // filtres. Aucun ne relit product_events directement.
    const guides = sql.slice(sql.indexOf("), guide_views as ("), sql.indexOf("), feedback as ("));
    expect(guides).toContain("from filtered");
    expect(guides).not.toContain("public.product_events");
    expect(sql).toContain("where environment = 'production' and not internal");
    // Aucune ligne détruite, aucun index touché : la seule modification de
    // schéma est l'extension de la contrainte de noms, ci-dessous.
    expect(sql).not.toMatch(/\bdelete from\b|\bcreate index\b|\bdrop index\b|\badd column\b/i);
  });

  it("les trois nombres du bloc sont comptés, pas posés", () => {
    const sql = readFileSync("supabase/migrations/20260928000033_cockpit_guides.sql", "utf8");
    // Vues d'un guide : comptées par chemin.
    expect(sql).toContain("select path, count(*)::int as views");
    // Clics vers l'exemple : comptés par origine.
    expect(sql).toContain("select entity_id as path, count(*)::int as to_example");
    // Arrivée directe : les vues de l'exemple SANS origine. Une constante à
    // cet endroit afficherait un chiffre faux sans que rien ne bronche.
    expect(sql).toContain("count(*) filter (where entity_id is null)::int as direct");
    expect(sql).toContain("count(*)::int as total");
  });

  // CE TEST EXISTE PARCE QUE LE DÉFAUT EST ARRIVÉ. Le code écrivait bien les
  // deux noms, et chaque vue repartait en HTTP 400 : la table porte depuis la
  // migration 30 une contrainte CHECK qui énumère les noms admis. L'erreur est
  // avalée par recordProductEvent — la page s'affiche normalement, et seul un
  // journal serveur le dit. Constaté en exécutant vraiment la page, pas en
  // relisant le code.
  it("tout nom d'événement du code est autorisé par la contrainte en base", async () => {
    const { PRODUCT_EVENTS } = await import("@/lib/analytics/first-party");
    const sql = readdirSync("supabase/migrations")
      .sort()
      .map((file) => readFileSync(`supabase/migrations/${file}`, "utf8"))
      .join("\n")
      // Les commentaires sont écartés : les sections « Rollback » citent la
      // contrainte PRÉCÉDENTE, et c'est ce que la base porte VRAIMENT qu'on
      // vérifie ici.
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    // La DERNIÈRE définition de la contrainte fait foi : c'est celle que la
    // base porte une fois toutes les migrations appliquées.
    const blocks = [...sql.matchAll(/check\s*\(\s*event_name\s+in\s*\(([^)]*)\)/gi)];
    expect(blocks.length).toBeGreaterThan(0);
    const autorises = [...blocks[blocks.length - 1][1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    for (const event of PRODUCT_EVENTS) expect(autorises, event).toContain(event);
    // Et aucun nom autorisé en base que le code n'écrit plus : une contrainte
    // qui s'allonge sans jamais se relire finit par ne plus rien contraindre.
    for (const autorise of autorises) expect([...PRODUCT_EVENTS], autorise).toContain(autorise);
  });

  // Même classe de défaut que le précédent : une valeur parfaitement juste que
  // la base refuse. Les colonnes de product_events sont bornées (migration 30).
  it("les valeurs écrites tiennent dans les colonnes de la table", () => {
    for (const page of Object.keys(MEASURED_PAGES)) expect(page.length, page).toBeLessThanOrEqual(300);
    for (const path of Object.values(EXAMPLE_ORIGINS)) expect(path.length, path).toBeLessThanOrEqual(120);
    // entity_type : 40 caractères au plus.
    expect("origine".length).toBeLessThanOrEqual(40);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("ce que les pages rendent", () => {
  const FICHIER: Record<string, string> = {
    "/combien-facturer": "app/combien-facturer/page.tsx",
    "/produits-offerts": "app/produits-offerts/page.tsx",
    "/droits-utilisation": "app/droits-utilisation/page.tsx",
    "/analyse/demo": "app/analyse/demo/page.tsx",
  };

  async function render(path: string): Promise<string> {
    const loaded = await import(`@/${FICHIER[path].replace(/\.tsx$/, "")}`);
    const Page = loaded.default as () => React.ReactElement;
    return renderToStaticMarkup(Page());
  }

  it("chaque page mesurée porte son image, une seule fois, invisible", async () => {
    for (const page of Object.keys(FICHIER)) {
      const html = await render(page);
      const images = [...html.matchAll(/<img [^>]*>/g)].map((m) => m[0]).filter((tag) => tag.includes(VIEW_PIXEL_PATH));
      expect(images, page).toHaveLength(1);
      expect(images[0], page).toContain(`src="${viewPixelSrc(page)}"`);
      // Rien à annoncer, rien à lire, rien à décaler.
      expect(images[0], page).toContain('alt=""');
      expect(images[0], page).toContain('aria-hidden="true"');
      expect(images[0], page).toContain("opacity-0");
    }
  });

  it("aucun script n'est ajouté à ces pages : la garantie #074 tient", () => {
    for (const fichier of [...Object.values(FICHIER), "components/analytics/view-pixel.tsx"]) {
      const source = readFileSync(fichier, "utf8");
      expect(source, fichier).not.toMatch(/^\s*["']use client["']/m);
      expect(source, fichier).not.toMatch(/useEffect|onClick|window\.|document\./);
    }
  });

  it("la canonique de l'exemple reste /analyse/demo, malgré le paramètre", async () => {
    const { publicPageMetadata } = await import("@/lib/seo");
    const metadata = publicPageMetadata("/analyse/demo");
    expect(metadata.alternates?.canonical).toBe("/analyse/demo");
    expect(String(metadata.alternates?.canonical)).not.toContain(EXAMPLE_ORIGIN_PARAM + "=");
  });

  it("ni les guides ni l'exemple n'entrent dans le sitemap avec un paramètre", async () => {
    const sitemap = (await import("@/app/sitemap")).default;
    for (const entry of sitemap()) expect(new URL(entry.url).search, entry.url).toBe("");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Mission #127, partie A — DE BOUT EN BOUT, /exemple PRODUIT UNE LIGNE.
//
// Constat du 01/10 : un clic réel depuis le navigateur intégré d'Instagram n'a
// rien produit de visible dans /admin. L'événement était pourtant écrit : ce
// qui manquait, c'est qu'il soit COMPTÉ comme une visite. Ce test suit la
// chaîne entière — le chemin court, la redirection, l'image, les paramètres
// enregistrés — au lieu de vérifier que la page existe.
describe("le chemin complet de /exemple", () => {
  it("chemin court → page d'exemple → événement avec les bons UTM", async () => {
    const { proxy } = await import("@/proxy");
    const { NextRequest } = await import("next/server");

    // 1. Le chemin court redirige, et le serveur pose les UTM.
    const redirection = await proxy(new NextRequest(`${ORIGIN}/exemple`));
    expect(redirection.status).toBe(307);
    const arrivee = new URL(redirection.headers.get("location") as string, ORIGIN);
    expect(arrivee.pathname).toBe("/analyse/demo");

    // 2. La page d'arrivée demande son image de mesure. Le référent est
    //    l'adresse RÉELLEMENT affichée, UTM compris.
    await ask({ page: "/analyse/demo", referer: arrivee.toString() });

    // 3. Ce qui part en base.
    expect(recorded()).toMatchObject({
      event: "example_view",
      attribution: expect.objectContaining({
        path: "/analyse/demo",
        utm_source: "instagram",
        utm_medium: "organic_social",
        utm_campaign: "lancement",
        utm_content: "dm_exemple",
      }),
    });
  });

  it("une visite sur la page d'exemple COMPTE comme une visite", async () => {
    const { VISIT_EVENTS, dashboardTiles } = await import("@/lib/admin/data");
    expect([...VISIT_EVENTS]).toContain("example_view");
    expect([...VISIT_EVENTS]).toContain("guide_view");
    const tuiles = dashboardTiles({
      counts: { landing_view: 3, pricing_view: 1, guide_view: 2, example_view: 4 },
      excluded: 0, internal: 0, paid_pro: 0, granted_pro: 0,
      feedback: { total: 0, fair: 0, not_fair: 0 },
      purchases: { purchases: 0, revenue_eur: 0, revenue_covered: 0 },
      timeseries: [], acquisition: [], guides: [], example: { total: 4, direct: 4 }, tier_changes: [],
    });
    expect(tuiles.find((t) => t.label === "Visites mesurées")?.value).toBe("10");
  });

  it("la RPC compte exactement les mêmes événements que le cockpit", async () => {
    const { VISIT_EVENTS } = await import("@/lib/admin/data");
    const sql = readFileSync("supabase/migrations/20261001000034_visites_toutes_pages.sql", "utf8");
    const liste = `(${VISIT_EVENTS.map((event) => `'${event}'`).join(",")})`;
    // Les deux endroits où la RPC compte une visite : la courbe et le tableau
    // par source. Aucun ne doit diverger de VISIT_EVENTS.
    expect(sql.split(`event_name in ${liste}`).length - 1, liste).toBe(2);
    expect(sql).not.toMatch(/event_name in \('landing_view','pricing_view'\)/);
  });
});

describe("ce que le cockpit montre", () => {
  const base = {
    counts: { guide_view: 42, example_view: 9 },
    excluded: 0, internal: 0, paid_pro: 0, granted_pro: 0,
    feedback: { total: 0, fair: 0, not_fair: 0 },
    purchases: { purchases: 0, revenue_eur: 0, revenue_covered: 0 },
    timeseries: [], acquisition: [],
    guides: [
      { path: "/combien-facturer", views: 30, to_example: 6 },
      { path: "/produits-offerts", views: 12, to_example: 1 },
    ],
    example: { total: 9, direct: 2 }, tier_changes: [],
  };

  it("la ligne sous le tableau dit le total, l'attribué et le direct", async () => {
    const { exampleNotice } = await import("@/lib/admin/data");
    const texte = exampleNotice(base);
    expect(texte).toContain("9 vue(s)");
    expect(texte).toContain("7 depuis un lien du site");
    expect(texte).toContain("2 en arrivée directe");
  });

  // Le tableau RENDU est vérifié dans tests/admin-cockpit-rendu.test.tsx, qui
  // porte déjà le montage de la page d'administration.

  it("migration pas encore appliquée : zéro plutôt qu'un affichage cassé", () => {
    const source = readFileSync("lib/admin/data.ts", "utf8");
    expect(source).toContain("guides: data.guides ?? []");
    expect(source).toContain("example: data.example ?? EMPTY_DASHBOARD.example");
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("rien d'autre n'a bougé", () => {
  it("aucun fichier du moteur de chiffrage n'est touché par cette mission", () => {
    for (const fichier of ["lib/rates/engine.ts", "lib/rates/fr-2026.3.json", "lib/rates/score.ts"]) {
      const source = readFileSync(fichier, "utf8");
      for (const ajout of ["guide_view", "example_view", "ViewPixel", "viewPixelSrc", "isRobot", "/api/vue"]) {
        expect(source, `${fichier} / ${ajout}`).not.toContain(ajout);
      }
    }
  });

  it("les quatre fourchettes des vidéos déjà tournées sont inchangées", async () => {
    const { computeEstimate } = await import("@/lib/rates/engine");
    const { analysisSchema } = await import("@/lib/schema");
    const sample = (await import("@/lib/fixtures/sample-extraction.json")).default;
    type Deal = (typeof analysisSchema.shape.deal)["_output"];
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
