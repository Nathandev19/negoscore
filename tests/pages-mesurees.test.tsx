import { readdirSync, readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { shortPathAttribution } from "@/lib/acquisition/chemins";
import { isRobot, refusesTracking } from "@/lib/analytics/robots";
import {
  ANALYSIS_ORIGINS,
  EXAMPLE_ORIGIN_PARAM,
  EXAMPLE_ORIGINS,
  INTERNAL_ORIGIN_PARAM,
  analysisOriginFor,
  eventForPage,
  exampleHrefFrom,
  GUIDE_PATHS,
  internalHrefFrom,
  knownOriginKey,
  MEASURED_PAGES,
  originPathFor,
  VIEW_PIXEL_PATH,
  viewPixelSrc,
  viewPixelUrl,
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
vi.mock("@/components/analytics/first-party-view", () => ({ FirstPartyView: () => null, currentAttribution: () => ({}) }));

const { GET: pixel } = await import("@/app/api/vue/route");

beforeEach(() => {
  telemetry.calls = [];
});
afterEach(() => {
  vi.restoreAllMocks();
});

type Ask = { page?: string | null; referer?: string | null; referrer?: string | null; ua?: string | null; headers?: Record<string, string> };

function ask({ page = "/combien-facturer", referer = `${ORIGIN}/combien-facturer`, referrer = null, ua = UA, headers = {} }: Ask = {}) {
  const head: Record<string, string> = { "sec-fetch-dest": "image", "sec-fetch-site": "same-origin", ...headers };
  if (ua !== null) head["user-agent"] = ua;
  if (referer !== null) head.referer = referer;
  const query = page === null ? "" : `?p=${encodeURIComponent(page)}${referrer === null ? "" : `&r=${encodeURIComponent(referrer)}`}`;
  return pixel(new Request(`${ORIGIN}${VIEW_PIXEL_PATH}${query}`, { headers: head }));
}

const recorded = () => telemetry.calls.at(-1);

// ───────────────────────────────────────────────────────────────────────────
describe("la table fermée des pages mesurées", () => {
  it("les trois guides portent UN SEUL nom d'événement, le chemin les distingue", () => {
    for (const path of GUIDE_PATHS) expect(eventForPage(path), path).toBe("guide_view");
    expect(new Set(GUIDE_PATHS.map((p) => eventForPage(p))).size).toBe(1);
    expect(eventForPage("/analyse/demo")).toBe("example_view");
    expect(eventForPage("/analyse")).toBe("analysis_page_view");
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
// Mission #161 — CE QUI PASSE ENTRE LE LIEN ET LA ROUTE.
//
// #158 avait une garde sur les href des guides, et une garde sur la route.
// Entre les deux, personne ne regardait l'adresse que le navigateur demande
// vraiment — et c'est là que l'origine se perdait. Mesuré sur un build de
// production, page ouverte sur /produits-offerts?de=droits-pub-6-mois :
//   GET /api/vue?p=%2Fproduits-offerts&r=direct
// Aucune origine dedans. Elle n'arrivait que par l'en-tête Referer, c'est-à-dire
// par une chose que le site ne décide pas.
describe("l'adresse de mesure réellement demandée", () => {
  it("elle emporte l'origine lue dans l'adresse de la page, sous le même nom que les liens", () => {
    expect(viewPixelUrl("/produits-offerts", "?de=droits-pub-6-mois", "direct")).toBe(
      `/api/vue?p=%2Fproduits-offerts&${INTERNAL_ORIGIN_PARAM}=droits-pub-6-mois&r=direct`,
    );
    // Le nom du paramètre est celui des liens internes : une seule convention.
    expect(internalHrefFrom("/produits-offerts", "droits-pub-6-mois")).toContain(`?${INTERNAL_ORIGIN_PARAM}=`);
    expect(viewPixelUrl("/produits-offerts", "?de=droits-pub-6-mois", null)).toContain(`&${INTERNAL_ORIGIN_PARAM}=`);
  });

  it("les cinq guides traversent la chaîne entière, du lien à la valeur enregistrée", async () => {
    for (const depart of GUIDE_PATHS) {
      const cle = depart.slice(1);
      // 1. le lien écrit dans le corps d'un guide
      const lien = internalHrefFrom("/produits-offerts", cle);
      expect(lien, cle).toBe(`/produits-offerts?${INTERNAL_ORIGIN_PARAM}=${cle}`);
      // 2. l'adresse que le navigateur demande depuis la page ainsi atteinte
      const adresse = viewPixelUrl("/produits-offerts", new URL(lien, ORIGIN).search, "direct");
      expect(adresse, cle).toContain(`${INTERNAL_ORIGIN_PARAM}=${cle}`);
      // 3. ce que la route en enregistre — RÉFÉRENT SANS PARAMÈTRES, pour
      //    prouver que l'origine ne dépend plus de ce que le navigateur
      //    accepte de mettre dans son en-tête Referer.
      telemetry.calls = [];
      await pixel(new Request(`${ORIGIN}${adresse}`, {
        headers: { "sec-fetch-dest": "image", "sec-fetch-site": "same-origin", "user-agent": UA, referer: `${ORIGIN}/produits-offerts` },
      }));
      expect(recorded(), cle).toMatchObject({ event: "guide_view", entityType: "origine", entityId: depart });
    }
  });

  it("une origine fabriquée n'entre même pas dans la requête, et reste inconnue si elle y entre", async () => {
    for (const hostile of ["__proto__", "constructor", "/admin", "autre", ""]) {
      expect(knownOriginKey(hostile), hostile).toBeNull();
      expect(viewPixelUrl("/produits-offerts", `?de=${encodeURIComponent(hostile)}`, null), hostile).toBe(
        viewPixelSrc("/produits-offerts"),
      );
      telemetry.calls = [];
      await pixel(new Request(`${ORIGIN}${VIEW_PIXEL_PATH}?p=%2Fproduits-offerts&de=${encodeURIComponent(hostile)}`, {
        headers: { "sec-fetch-dest": "image", "sec-fetch-site": "same-origin", "user-agent": UA, referer: `${ORIGIN}/produits-offerts` },
      }));
      expect(recorded(), hostile).toMatchObject({ event: "guide_view", entityId: null });
    }
  });

  it("sans origine dans l'adresse, la requête n'en invente pas", () => {
    expect(viewPixelUrl("/combien-facturer", "", null)).toBe(viewPixelSrc("/combien-facturer"));
    expect(viewPixelUrl("/combien-facturer", "?utm_source=tiktok", "direct")).toBe(
      `${viewPixelSrc("/combien-facturer")}&r=direct`,
    );
  });

  it("le composant ne compose plus d'adresse lui-même : un seul endroit à tester", () => {
    const composant = readFileSync("components/analytics/view-pixel.tsx", "utf8");
    expect(composant).toContain("viewPixelUrl(page, window.location.search, currentAttribution().referrer_host)");
    // Le fond d'image sans JavaScript, lui, reste sans paramètre : une page
    // prérendue ne connaît pas l'adresse demandée (le référent prend le relais).
    expect(composant).toContain('url("${viewPixelSrc(page)}")');
  });
});

describe("l'origine du clic vers l'analyse", () => {
  it("le bouton mobile a une clé fermée distincte des UTM", () => {
    expect(INTERNAL_ORIGIN_PARAM).toBe(EXAMPLE_ORIGIN_PARAM);
    expect(ANALYSIS_ORIGINS["bouton-mobile"]).toBe("/bouton-mobile");
    expect(analysisOriginFor("bouton-mobile")).toBe("/bouton-mobile");
    for (const value of ["__proto__", "constructor", "autre", null]) expect(analysisOriginFor(value)).toBeUndefined();
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

  it("un domaine transmis par le navigateur accompagne la vue sans changer les UTM", async () => {
    await ask({ referrer: "l.instagram.com", referer: `${ORIGIN}/combien-facturer?utm_source=TikTok` });
    expect(recorded()).toMatchObject({
      event: "guide_view",
      attribution: expect.objectContaining({ referrer_host: "instagram.com", utm_source: "tiktok" }),
    });
  });

  it("l'image n'est jamais mise en cache : sinon la deuxième visite ne compte pas", async () => {
    const cache = (await ask()).headers.get("cache-control") ?? "";
    expect(cache).toContain("no-store");
    expect(cache).toContain("max-age=0");
  });

  // Mission #158 — les quatre guides se citent dans leur texte. Un guide lit
  // donc son origine comme l'exemple : sans ça, le `?de=` que portent ces
  // liens serait écrit dans l'adresse sans être mesuré nulle part.
  it("un guide atteint depuis un autre guide garde l'origine du clic", async () => {
    await ask({ page: "/droits-pub-6-mois", referer: `${ORIGIN}/droits-pub-6-mois?de=combien-facturer` });
    expect(recorded()).toMatchObject({ event: "guide_view", entityType: "origine", entityId: "/combien-facturer" });
  });

  it("une arrivée directe sur un guide est enregistrée, sans origine inventée", async () => {
    await ask({ page: "/droits-pub-6-mois", referer: `${ORIGIN}/droits-pub-6-mois` });
    expect(recorded()).toMatchObject({ event: "guide_view", entityType: "origine", entityId: null });
  });

  it("une origine fabriquée sur un guide ne devient jamais une ligne du cockpit", async () => {
    await ask({ page: "/droits-pub-6-mois", referer: `${ORIGIN}/droits-pub-6-mois?de=__proto__` });
    expect(recorded()).toMatchObject({ event: "guide_view", entityId: null });
  });

  it("l'exemple, avec l'origine du clic lue dans l'adresse de la page", async () => {
    await ask({ page: "/analyse/demo", referer: `${ORIGIN}/analyse/demo?de=combien-facturer` });
    expect(recorded()).toMatchObject({ event: "example_view", entityType: "origine", entityId: "/combien-facturer" });
  });

  it("l'arrivée sur /analyse déclenche son propre événement avec le chemin affiché", async () => {
    await ask({ page: "/analyse", referer: `${ORIGIN}/analyse` });
    expect(recorded()).toMatchObject({
      event: "analysis_page_view", attribution: expect.objectContaining({ path: "/analyse" }),
      entityType: "origine", entityId: null,
    });
  });

  it("le bouton fixe est identifié sans écraser les UTM d'acquisition", async () => {
    await ask({ page: "/analyse", referer: `${ORIGIN}/analyse?de=bouton-mobile&utm_source=Instagram&utm_campaign=dm&utm_content=story` });
    expect(recorded()).toMatchObject({
      event: "analysis_page_view", entityType: "origine", entityId: "/bouton-mobile",
      attribution: expect.objectContaining({ path: "/analyse", utm_source: "instagram", utm_campaign: "dm", utm_content: "story" }),
    });
  });

  it("une origine inconnue n'est pas enregistrée comme bouton mobile", async () => {
    await ask({ page: "/analyse", referer: `${ORIGIN}/analyse?de=constructor` });
    expect(recorded()).toMatchObject({ event: "analysis_page_view", entityId: null });
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

  // Mission #136 — ces deux-là ont CHANGÉ DE RÉPONSE, volontairement.
  //
  // Avant, une image demandée sans référent était comptée : « une visite sans
  // paramètre est une visite valide ». C'était vrai tant que seule une vraie
  // page demandait l'image. Depuis qu'on sait qu'un préchargement la demande
  // aussi, le référent est la seule chose qui distingue une page affichée
  // d'une page préchargée. Sans lui, on ne sait pas : on n'écrit pas.
  it("aucun référent : on ne peut pas savoir, donc on n'écrit pas", async () => {
    await ask({ referer: null });
    expect(telemetry.calls).toEqual([]);
  });

  it("un référent d'un autre site : ce n'est pas la page, rien n'est enregistré", async () => {
    await ask({ referer: "https://evil.test/x?utm_source=piege" });
    expect(telemetry.calls).toEqual([]);
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
// ───────────────────────────────────────────────────────────────────────────
// MISSION #136 — UNE VUE N'EXISTE QUE SI LA PAGE EST AFFICHÉE.
//
// Constaté en production le 01/10 : /api/vue partait par paquets de trois,
// un par guide, alors que le visiteur était sur l'accueil. Les trois guides
// affichaient exactement 17 vues chacun — le même nombre, parce qu'aucune de
// ces vues n'était une vraie lecture.
//
// CAUSE : React 19 émet une consigne de préchargement pour toute image rendue
// côté serveur. Next l'embarque dans la charge RSC d'une page, sous la forme
// :HL["/api/vue?p=…","image"], et l'applique à la page COURANTE quand il
// précharge un lien. Les trois guides sont dans le pied de page, donc sur
// tout le site.
//
// Deux barrières, et chacune suffirait : le pixel n'est plus une image
// préchargeable, et le serveur refuse une vue dont le référent n'est pas la
// page qu'elle déclare.
describe("un préchargement n'est pas une vue", () => {
  it("le pixel n'est pas une balise que React peut précharger", () => {
    const source = readFileSync("components/analytics/view-pixel.tsx", "utf8");
    // C'est la balise <img> rendue côté serveur qui déclenchait la consigne de
    // préchargement. Il n'y en a plus — on lit le code, commentaires retirés.
    const code = source.replace(/\/\/[^\n]*/g, "");
    expect(code).not.toMatch(/<img/);
    expect(code).toContain("backgroundImage");
  });


  it("une demande venue d'une AUTRE page n'enregistre rien", async () => {
    // Exactement le cas de production : le navigateur est sur l'accueil, et
    // demande le pixel des trois guides.
    for (const guide of GUIDE_PATHS) {
      await ask({ page: guide, referer: `${ORIGIN}/` });
    }
    await ask({ page: "/analyse/demo", referer: `${ORIGIN}/` });
    expect(telemetry.calls).toEqual([]);
  });

  it("un affichage réel en enregistre exactement un, et un seul", async () => {
    for (const guide of GUIDE_PATHS) {
      await ask({ page: guide, referer: `${ORIGIN}${guide}` });
    }
    expect(telemetry.calls).toHaveLength(GUIDE_PATHS.length);
    expect(telemetry.calls.map((c) => (c.attribution as { path: string }).path)).toEqual([...GUIDE_PATHS]);
  });

  it("le référent est comparé à la page déclarée, pas seulement au site", async () => {
    // Même site, mauvaise page : c'est le cas du préchargement, et c'est
    // aussi celui d'une image recopiée ailleurs sur le site.
    await ask({ page: "/combien-facturer", referer: `${ORIGIN}/droits-utilisation` });
    await ask({ page: "/combien-facturer", referer: `${ORIGIN}/tarifs` });
    await ask({ page: "/analyse/demo", referer: `${ORIGIN}/analyse` });
    expect(telemetry.calls).toEqual([]);
    // Et la bonne page, avec ses paramètres, passe toujours.
    await ask({ page: "/combien-facturer", referer: `${ORIGIN}/combien-facturer?utm_source=google` });
    expect(telemetry.calls).toHaveLength(1);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("la mesure côté navigateur déclare sa page, elle aussi", () => {
  const envoyer = async (corps: unknown) => {
    const { POST } = await import("@/app/api/events/route");
    return POST(
      new Request(`${ORIGIN}/api/events`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN, "sec-fetch-site": "same-origin", "user-agent": UA },
        body: JSON.stringify(corps),
      }),
    );
  };

  it("landing_view depuis l'accueil, pricing_view depuis les tarifs", async () => {
    await envoyer({ event: "landing_view", attribution: { path: "/" } });
    await envoyer({ event: "pricing_view", attribution: { path: "/tarifs" } });
    expect(telemetry.calls.map((c) => c.event)).toEqual(["landing_view", "pricing_view"]);
  });

  it("une vue déclarée depuis une autre page n'écrit rien", async () => {
    // Ces deux-là n'ont jamais eu le défaut du pixel : elles partent d'un
    // useEffect, qu'un préchargement ne monte pas. Mais rien n'empêchait un
    // corps de déclarer une vue de tarifs depuis n'importe où.
    const refus = await envoyer({ event: "pricing_view", attribution: { path: "/combien-facturer" } });
    await envoyer({ event: "landing_view", attribution: { path: "/tarifs" } });
    await envoyer({ event: "landing_view" });
    expect(telemetry.calls).toEqual([]);
    // La réponse ne dit rien de ce qui a été fait : même code qu'un succès.
    expect(refus.status).toBe(204);
  });

  it("tier_changed n'est pas une vue : aucune page ne lui est imposée", async () => {
    await envoyer({ event: "tier_changed", tier: "experienced", attribution: { path: "/analyse/resultat/x" } });
    expect(telemetry.calls).toHaveLength(1);
    expect(telemetry.calls[0]).toMatchObject({ event: "tier_changed", entityType: "niveau", entityId: "experienced" });
  });
});

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
          // Mission #136 — l'événement nomme sa page, et le serveur la vérifie.
          body: JSON.stringify({ event: "landing_view", attribution: { path: "/" } }),
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
    await recordProductEvent({ event: "analysis_page_view", attribution: { path: "/analyse" }, entityType: "origine", entityId: "/bouton-mobile" });
    expect(db.rows).toHaveLength(3);
    for (const row of db.rows) {
      // #103 : décidé par le serveur, et « test » ici — donc hors production.
      expect(row.environment).toBe("test");
      // #118 : la marque interne est portée par la ligne, comme pour les autres.
      expect(row).toHaveProperty("internal");
    }
    expect(db.rows[1]).toMatchObject({ event_name: "example_view", entity_type: "origine", entity_id: "/combien-facturer" });
    expect(db.rows[2]).toMatchObject({ event_name: "analysis_page_view", path: "/analyse", entity_type: "origine", entity_id: "/bouton-mobile" });
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
    for (const path of Object.values(ANALYSIS_ORIGINS)) expect(path.length, path).toBeLessThanOrEqual(120);
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
    "/analyse": "app/analyse/page.tsx",
  };

  async function render(path: string): Promise<string> {
    const loaded = await import(`@/${FICHIER[path].replace(/\.tsx$/, "")}`);
    const Page = loaded.default as () => React.ReactElement;
    return renderToStaticMarkup(Page());
  }

  it("chaque page mesurée porte son pixel, une seule fois, invisible", async () => {
    for (const page of Object.keys(FICHIER)) {
      const html = await render(page);
      const pixels = [...html.matchAll(/<div [^>]*>/g)].map((m) => m[0]).filter((tag) => tag.includes(VIEW_PIXEL_PATH));
      expect(pixels, page).toHaveLength(1);
      // Mission #136 — une image de FOND, pas une balise <img> : React
      // précharge les images rendues côté serveur, et c'est ce préchargement
      // qui comptait des vues sur des pages que personne n'avait ouvertes.
      expect(pixels[0], page).toContain(`background-image:url(&quot;${viewPixelSrc(page)}&quot;)`);
      expect(html, page).not.toContain(`<img src="${viewPixelSrc(page)}"`);
      // Et rien ne précharge cette adresse : c'est la consigne de préchargement,
      // émise par React pour une image rendue, qui partait depuis une autre page.
      expect(html, page).not.toMatch(new RegExp(`rel="preload"[^>]*${VIEW_PIXEL_PATH}`));
      // Rien à annoncer, rien à décaler. Et surtout rien qui empêche le rendu :
      // un élément non rendu ne télécharge pas son fond.
      expect(pixels[0], page).toContain('aria-hidden="true"');
      // Ni `hidden`, ni `invisible`, ni `display:none` : les trois empêchent
      // le rendu de l'élément, donc le téléchargement de son fond, donc la
      // mesure. On lit la LISTE de classes et non la chaîne entière :
      // `aria-hidden` contient le mot « hidden » et fausserait la lecture.
      const classes = (pixels[0].match(/ class="([^"]*)"/)?.[1] ?? "").split(" ");
      expect(classes, page).toContain("opacity-0");
      for (const interdite of ["hidden", "invisible", "sr-only"]) {
        expect(classes, `${page} / ${interdite}`).not.toContain(interdite);
      }
      expect(pixels[0], page).not.toMatch(/display:\s*none/);
    }
  });

  it("les pages restent lisibles sans JavaScript et gardent le pixel sans noscript", () => {
    for (const fichier of Object.values(FICHIER)) {
      const source = readFileSync(fichier, "utf8");
      expect(source, fichier).not.toMatch(/^\s*["']use client["']/m);
      expect(source, fichier).not.toMatch(/useEffect|onClick|window\.|document\./);
    }
    const pixel = readFileSync("components/analytics/view-pixel.tsx", "utf8");
    expect(pixel).toContain("{...WITHOUT_JS}");
    expect(pixel).not.toContain("<noscript>");
    expect(readFileSync("app/globals.css", "utf8")).toContain("[data-js] [data-sans-js]");
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
  // Mission #137 — /exemple ne redirige plus : il SERT le contenu de la page
  // d'exemple, à son adresse. L'attribution ne voyage donc plus dans l'adresse,
  // et c'est exactement ce qui doit continuer de marcher : elle est relue dans
  // la table des chemins courts, à partir du référent.
  it("chemin court servi sur place → événement avec les bons UTM", async () => {
    const { proxy } = await import("@/proxy");
    const { NextRequest } = await import("next/server");

    // 1. Aucun aller-retour : la page est rendue à l'adresse demandée.
    const reponse = await proxy(new NextRequest(`${ORIGIN}/exemple`));
    expect(reponse.status).toBe(200);
    expect(reponse.headers.get("location")).toBeNull();
    const servi = new URL(reponse.headers.get("x-middleware-rewrite") as string, ORIGIN);
    expect(servi.pathname).toBe("/analyse/demo");

    // 2. Le navigateur est sur /exemple, et c'est de là que part l'image de
    //    mesure. L'adresse ne porte aucun paramètre.
    await ask({ page: "/analyse/demo", referer: `${ORIGIN}/exemple` });

    // 3. Et la ligne écrite est la même qu'avant, mot pour mot.
    expect(recorded()).toMatchObject({
      event: "example_view",
      attribution: expect.objectContaining({
        path: "/analyse/demo",
        utm_source: "instagram",
        // Mission #159 — voir lib/acquisition/chemins.ts : le DM a son propre
        // mode d'acquisition, et il traverse le service sur place intact.
        utm_medium: "dm",
        utm_campaign: "lancement",
        utm_content: "dm_exemple",
      }),
    });
  });

  it("l'arrivée directe sur /analyse/demo reste sans attribution", () => {
    // Le service sur place n'invente pas d'attribution pour qui arrive
    // directement : seule l'adresse /exemple en porte une.
    expect(shortPathAttribution("/analyse/demo")).toBeNull();
    expect(shortPathAttribution("/")).toBeNull();
  });

  it("une demande de pixel venue d'un chemin court NON servi n'est pas acceptée", async () => {
    // /dm redirige vers l'accueil : il n'affiche jamais la page d'exemple, et
    // ne peut donc pas en déclarer la vue.
    await ask({ page: "/analyse/demo", referer: `${ORIGIN}/dm` });
    expect(telemetry.calls).toEqual([]);
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
    for (const fichier of ["lib/rates/engine.ts", "lib/rates/fr-2026.4.json", "lib/rates/score.ts"]) {
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

// ───────────────────────────────────────────────────────────────────────────
// Mission #152 — UN LIEN INTERNE N'ÉCRASE JAMAIS L'ATTRIBUTION.
//
// /exemple est la destination des DM depuis la #125. Elle devient aussi
// atteignable depuis le site : sous l'action principale de l'accueil, et dans
// le pied de page. Le piège, c'est d'étiqueter ces liens internes avec des
// utm : quelqu'un arrivé par bio_instagram deviendrait « site » au premier
// clic, et on perdrait la seule chose que la mesure d'acquisition sait faire.
//
// Le paramètre `de=` existe depuis la #120 et répond exactement à ça : il dit
// d'où vient le CLIC, il est lu dans une table fermée, et il n'entre dans
// aucune colonne utm.
describe("le chemin vers l'exemple depuis le site", () => {
  it("un clic depuis l'accueil n'écrit aucune attribution d'acquisition", async () => {
    await ask({ page: "/analyse/demo", referer: `${ORIGIN}/analyse/demo?de=accueil` });
    const vue = recorded();
    expect(vue).toMatchObject({ event: "example_view", entityType: "origine", entityId: "/" });
    // Le point de la mission : AUCUNE colonne utm n'est remplie. Le lien
    // interne ne raconte pas d'où vient le visiteur, il ne sait pas.
    expect(vue?.attribution).toMatchObject({ utm_source: null, utm_medium: null, utm_campaign: null, utm_content: null });
  });

  it("le pied de page se distingue de l'accueil, et reste sans utm", async () => {
    await ask({ page: "/analyse/demo", referer: `${ORIGIN}/analyse/demo?de=pied-de-page` });
    expect(recorded()).toMatchObject({ event: "example_view", entityType: "origine", entityId: "/pied-de-page" });
    expect(recorded()?.attribution).toMatchObject({ utm_source: null, utm_content: null });
  });

  it("l'arrivée par le lien envoyé en DM garde son attribution, et n'a pas d'origine", async () => {
    // /exemple est servi sur place : son attribution vient de la table des
    // chemins courts, pas de l'adresse. C'est ce qui distingue les deux
    // chemins dans /admin : une origine, ou une attribution.
    await ask({ page: "/analyse/demo", referer: `${ORIGIN}/exemple` });
    expect(recorded()).toMatchObject({
      event: "example_view",
      entityId: null,
      attribution: expect.objectContaining({ utm_source: "instagram", utm_content: "dm_exemple" }),
    });
  });

  it("une origine inventée ne devient jamais une ligne du cockpit", async () => {
    for (const hostile of ["bio_instagram", "../admin", "__proto__", "site"]) {
      await ask({ page: "/analyse/demo", referer: `${ORIGIN}/analyse/demo?de=${encodeURIComponent(hostile)}` });
      expect(recorded(), hostile).toMatchObject({ event: "example_view", entityId: null });
    }
  });

  it("aucun lien du site vers l'exemple ne porte d'utm", async () => {
    const { default: Accueil } = await import("@/app/page");
    const html = renderToStaticMarkup((Accueil as () => React.ReactElement)());
    const vers = [...html.matchAll(/href="(\/analyse\/demo[^"]*)"/g)].map((m) => m[1]);
    expect(vers.length, "aucun lien vers l'exemple sur l'accueil").toBeGreaterThanOrEqual(2);
    for (const href of vers) {
      expect(href, href).not.toContain("utm_");
      expect(href, href).toMatch(/\?de=(accueil|pied-de-page)$/);
    }
  });
});
