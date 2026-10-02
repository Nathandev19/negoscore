import { readdirSync, readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { ACQUISITION_UTM, servedAttribution, shortPathAttribution, shortPathIsServed, SHORT_PATHS, shortPathTarget } from "@/lib/acquisition/chemins";
import { proxy } from "@/proxy";
import sitemap from "@/app/sitemap";

// Mission #106 — des chemins courts tapables qui portent l'attribution.
//
// Le compte TikTok part de zéro abonné : l'adresse est dictée dans la vidéo et
// tapée à la main. C'est le serveur qui ajoute les UTM, par redirection.

const ORIGIN = "https://www.negoscore.fr";
const call = (path: string) => proxy(new NextRequest(new URL(path, ORIGIN)));

function params(location: string): Record<string, string> {
  return Object.fromEntries(new URL(location, ORIGIN).searchParams.entries());
}

// Mission #119 — le septième chemin, et le premier qui ne vient pas de TikTok.
// Mission #124 — le huitième, et /dm change de source : il sert aux DM de
// prospection Instagram, pas à la vidéo 1, qui récupère /negociation.
const ATTENDU: Array<[string, string, string]> = [
  ["/dm", "instagram", "dm_prospection"],
  ["/negociation", "tiktok", "video_1_negociation"],
  ["/verdicts", "tiktok", "video_2_verdicts"],
  ["/produits", "tiktok", "video_3_produits"],
  ["/capture", "tiktok", "video_4_capture"],
  ["/niveau", "tiktok", "video_5_niveau"],
  // Mission #145 — la bio TikTok porte enfin ce chemin, et son contenu le dit.
  ["/tiktok", "tiktok", "bio_tiktok"],
  ["/insta", "instagram", "bio_instagram"],
];

// Mission #125 — le neuvième chemin, et le premier à ne pas mener à
// l'accueil. Mission #137 — il n'est plus REDIRIGÉ mais SERVI sur place :
// il a donc ses propres vérifications, plus bas.
const EXEMPLE: [string, string, string] = ["/exemple", "instagram", "dm_exemple"];
const TOUS = [...ATTENDU, EXEMPLE];

// La destination attendue de chaque chemin. Tous l'accueil, sauf /exemple.
const DESTINATION: Record<string, string> = { "/exemple": "/analyse/demo" };
const destination = (path: string) => DESTINATION[path] ?? "/";

describe("les huit chemins redirigés portent les UTM posés par le serveur", () => {
  it.each(ATTENDU)("%s → utm_source=%s et utm_content=%s", async (path, source, content) => {
    const response = await call(path);
    expect(response.status).toBe(307);
    const location = response.headers.get("location");
    expect(location).not.toBeNull();
    const target = new URL(location as string, ORIGIN);
    expect(target.pathname, path).toBe(destination(path));
    expect(params(location as string)).toEqual({
      utm_source: source,
      utm_medium: "organic_social",
      utm_campaign: "lancement",
      utm_content: content,
    });
  });

  // Mission #125 — DEUX PORTES D'ENTRÉE, PAS UNE.
  //
  // Depuis le lancement, aucun visiteur n'a lancé d'analyse : l'accueil demande
  // de coller le message d'une marque avant d'avoir rien montré. /exemple mène
  // à un résultat complet, visible dès l'arrivée. /dm reste le lien « je veux
  // tester la mienne ». Les deux portent un utm_content distinct : c'est la
  // seule façon de savoir laquelle des deux fait entrer quelqu'un.
  // Mission #137 — /exemple SERT le contenu, il ne redirige plus.
  //
  // Mesuré en #134 : la redirection coûtait ~230 ms (TTFB 287 ms contre
  // ~50 ms) sur la page envoyée en DM, avant même le premier octet de la
  // page. Le navigateur reste donc sur /exemple, et c'est le contenu de
  // /analyse/demo qui lui est rendu.
  it("/exemple rend le contenu sur place, sans aller-retour", async () => {
    const response = await call("/exemple");
    // Ni 307, ni 308, ni 301 : aucune redirection.
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    // La page rendue est bien celle de l'exemple.
    const reecrit = response.headers.get("x-middleware-rewrite");
    expect(reecrit).not.toBeNull();
    expect(new URL(reecrit as string, ORIGIN).pathname).toBe("/analyse/demo");
  });

  it("l'attribution instagram · lancement · dm_exemple survit au service sur place", () => {
    // Elle ne voyage plus dans l'adresse : elle est relue dans la table par
    // /api/vue, à partir du référent. Une seule source de vérité, la même
    // qu'avant — c'est ce que #124 a réparé et qu'on ne veut pas reperdre.
    const attribution = shortPathAttribution("/exemple");
    expect(attribution).toEqual({
      to: "/analyse/demo",
      utm_source: "instagram",
      utm_medium: "organic_social",
      utm_campaign: "lancement",
      utm_content: "dm_exemple",
    });
    // Et c'est le SEUL chemin servi sur place : les autres redirigent.
    expect(TOUS.filter(([chemin]) => shortPathIsServed(chemin)).map(([chemin]) => chemin)).toEqual(["/exemple"]);
  });

  it("une destination seule ne suffit pas : il faut le dire", () => {
    // Garde pour demain : un chemin court qui gagnerait une destination sans
    // être déclaré servi doit continuer de REDIRIGER. Sinon on servirait une
    // page à une adresse qui n'a pas été prévue pour, et son attribution
    // partirait sans que personne ne l'ait demandé.
    expect(servedAttribution({ source: "tiktok", content: "video_x", to: "/tarifs" })).toBeNull();
    expect(servedAttribution({ source: "tiktok", content: "video_x" })).toBeNull();
    expect(servedAttribution(undefined)).toBeNull();
    expect(servedAttribution({ source: "tiktok", content: "video_x", servi: true })).toBeNull();
    expect(servedAttribution(SHORT_PATHS.exemple)).not.toBeNull();
  });
  it("/dm continue de mener à l'accueil, et les deux ne se confondent pas", async () => {
    const dm = new URL((await call("/dm")).headers.get("location") as string, ORIGIN);
    const exemple = shortPathAttribution("/exemple") as NonNullable<ReturnType<typeof shortPathAttribution>>;
    expect(dm.pathname).toBe("/");
    expect(dm.searchParams.get("utm_content")).toBe("dm_prospection");
    // Même source, deux contenus : on pourra comparer les deux entrées.
    expect(dm.searchParams.get("utm_source")).toBe(exemple.utm_source);
    expect(dm.searchParams.get("utm_content")).not.toBe(exemple.utm_content);
    expect(dm.pathname).not.toBe(exemple.to);
  });

  it("une destination ne s'écrit que dans la table, jamais ailleurs", () => {
    const table = readFileSync("lib/acquisition/chemins.ts", "utf8");
    expect(table).toContain('to: "/analyse/demo"');
    // Le proxy ne connaît aucune adresse de destination : il lit la table.
    expect(readFileSync("proxy.ts", "utf8")).not.toContain("/analyse/demo");
    // Et les huit autres chemins n'ont pas de destination : ils gardent
    // l'accueil par défaut.
    expect([...table.matchAll(/to: "/g)]).toHaveLength(1);
  });

  // Mission #124 — LE DÉFAUT QUI EST ARRIVÉ. /dm a été créé en #106 comme
  // raccourci de la vidéo 1 TikTok, puis réemployé le 29/09 comme lien de
  // réponse aux DM Instagram, sans que sa ligne de table ne bouge. Trois
  // visites réelles de créatrices Instagram sont parties sous utm_source=tiktok
  // avant qu'on s'en aperçoive. Elles restent en base : on ne réécrit pas une
  // mesure passée.
  it("le lien envoyé en DM n'est plus attribué à TikTok", async () => {
    const posted = params((await call("/dm")).headers.get("location") as string);
    expect(posted.utm_source).toBe("instagram");
    expect(posted.utm_source).not.toBe("tiktok");
    // Et il ne porte plus le contenu d'une vidéo : ce n'est pas du trafic vidéo.
    expect(posted.utm_content).toBe("dm_prospection");
    expect(posted.utm_content).not.toContain("video");
    // La table est la seule source : la ligne elle-même est vérifiée.
    expect(SHORT_PATHS.dm).toEqual({ source: "instagram", content: "dm_prospection" });
  });

  it("la vidéo 1 a repris un chemin à elle", async () => {
    const response = await call("/negociation");
    expect(response.status).toBe(307);
    const posted = params(response.headers.get("location") as string);
    expect(posted.utm_content).toBe("video_1_negociation");
    expect(posted.utm_source).toBe("tiktok");
    // Les cinq vidéos ont chacune leur chemin, et aucun ne partage son contenu.
    const videos = Object.values(SHORT_PATHS).filter((entry) => entry.content.startsWith("video_"));
    expect(videos).toHaveLength(5);
    expect(new Set(videos.map((entry) => entry.content)).size).toBe(5);
  });

  it("chaque source du cockpit garde ses chemins séparés", () => {
    const parSource = Object.values(SHORT_PATHS).reduce<Record<string, string[]>>((acc, entry) => {
      (acc[entry.source] ??= []).push(entry.content);
      return acc;
    }, {});
    expect(Object.keys(parSource).sort()).toEqual(["instagram", "tiktok"]);
    // Trois chemins Instagram, qui ne disent pas la même chose : la bio, la
    // prospection directe, et le lien qui montre l'exemple chiffré (#125).
    expect(parSource.instagram.sort()).toEqual(["bio_instagram", "dm_exemple", "dm_prospection"]);
    // Mission #145 — six chemins TikTok : les cinq vidéos, et la bio. Aucun ne
    // s'appelle « bio » tout court : les deux bios sont nommées par leur
    // réseau, sinon la colonne « Contenu » du cockpit les confond.
    expect(parSource.tiktok.sort()).toEqual([
      "bio_tiktok", "video_1_negociation", "video_2_verdicts", "video_3_produits", "video_4_capture", "video_5_niveau",
    ]);
    expect(Object.values(SHORT_PATHS).map((entry) => entry.content)).not.toContain("bio");
  });

  it("le trafic Instagram ne se range pas sous TikTok", async () => {
    const insta = params((await call("/insta")).headers.get("location") as string);
    const tiktok = params((await call("/tiktok")).headers.get("location") as string);
    expect(insta.utm_source).toBe("instagram");
    expect(insta.utm_source).not.toBe(tiktok.utm_source);
    // Ni la même valeur de contenu : deux lignes distinctes dans le cockpit,
    // même en ne regardant qu'une colonne.
    expect(insta.utm_content).not.toBe(tiktok.utm_content);
    // Le reste est commun : même mode, même campagne.
    expect(insta.utm_medium).toBe(tiktok.utm_medium);
    expect(insta.utm_campaign).toBe(tiktok.utm_campaign);
  });

  it("307 et non 308 : la table doit pouvoir changer", async () => {
    for (const [path] of ATTENDU) {
      const response = await call(path);
      expect(response.status, path).toBe(307);
      expect(response.status, path).not.toBe(308);
      expect(response.status, path).not.toBe(301);
    }
  });

  it("casse et barre oblique finale tolérées : /DM, /dm/ et /Dm/ mènent au même endroit", async () => {
    const attendu = shortPathTarget("/dm");
    for (const variante of ["/DM", "/dm/", "/Dm/", "/dm//", "/DM/"]) {
      const response = await call(variante);
      expect(response.status, variante).toBe(307);
      expect(new URL(response.headers.get("location") as string, ORIGIN).search, variante).toBe(
        new URL(attendu as string, ORIGIN).search,
      );
    }
  });

  it("un chemin inconnu n'est jamais redirigé : ni accueil, ni boucle", async () => {
    for (const inconnu of ["/dmm", "/dm-bis", "/video", "/dm/autre", "/", "/tarifs", "/bio"]) {
      expect(shortPathTarget(inconnu), inconnu).toBeNull();
      const response = await call(inconnu);
      expect(response.status, inconnu).not.toBe(307);
      expect(response.headers.get("location"), inconnu).toBeNull();
    }
  });
});

describe("la table est la seule source", () => {
  it("chaque entrée de la table donne un chemin, sans rien écrire ailleurs", async () => {
    for (const [path, entry] of Object.entries(SHORT_PATHS)) {
      const response = await call(`/${path}`);
      // Mission #137 — deux modes, une seule table : redirigé, ou servi sur
      // place. Dans les deux cas l'attribution sort de la ligne, et de rien
      // d'autre.
      if (entry.servi) {
        expect(response.status, path).toBe(200);
        expect(shortPathAttribution(`/${path}`), path).toMatchObject({
          utm_source: entry.source,
          utm_content: entry.content,
        });
        continue;
      }
      expect(response.status, path).toBe(307);
      const posted = params(response.headers.get("location") as string);
      expect(posted.utm_content, path).toBe(entry.content);
      expect(posted.utm_source, path).toBe(entry.source);
    }
    expect(Object.keys(SHORT_PATHS)).toHaveLength(TOUS.length);
  });

  it("aucun utm_content n'est écrit en dur hors de la table", () => {
    // Les contenus seulement : un nom de réseau (« tiktok », « instagram »)
    // a de bonnes raisons d'apparaître ailleurs, dans les liens sociaux du
    // SEO par exemple. Un utm_content, non.
    const valeurs = Object.values(SHORT_PATHS).map((entry) => entry.content);
    const fichiers = ["proxy.ts", "next.config.ts", "app/sitemap.ts", "lib/seo.ts"];
    for (const fichier of fichiers) {
      const source = readFileSync(fichier, "utf8");
      for (const valeur of valeurs) expect(source, `${fichier} / ${valeur}`).not.toContain(valeur);
    }
    // Ni les UTM eux-mêmes : le proxy ne fait que lire la table.
    expect(readFileSync("proxy.ts", "utf8")).not.toContain(ACQUISITION_UTM.campaign);
  });

  it("aucun chemin court n'a de route à lui", () => {
    const routes = new Set(readdirSync("app", { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name));
    for (const path of Object.keys(SHORT_PATHS)) expect(routes.has(path), path).toBe(false);
  });
});

describe("ce ne sont pas des pages", () => {
  it("aucun des neuf n'est dans le sitemap", () => {
    const urls = sitemap().map((entry) => new URL(entry.url).pathname.replace(/\/+$/, ""));
    for (const path of Object.keys(SHORT_PATHS)) expect(urls, path).not.toContain(`/${path}`);
  });

  it("aucun lien interne ne pointe vers l'un d'eux", () => {
    const fichiers: string[] = [];
    const parcourir = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        const chemin = `${dir}/${entry.name}`;
        if (entry.isDirectory()) parcourir(chemin);
        else if (/\.(tsx|ts)$/.test(entry.name) && !chemin.includes("/tests/")) fichiers.push(chemin);
      }
    };
    parcourir("app");
    parcourir("components");
    for (const fichier of fichiers) {
      const source = readFileSync(fichier, "utf8");
      for (const path of Object.keys(SHORT_PATHS)) {
        expect(source, `${fichier} → /${path}`).not.toMatch(new RegExp(`href=["'\`]/${path}["'\`/]`));
      }
    }
  });
});
