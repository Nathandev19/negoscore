import { readdirSync, readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { ACQUISITION_UTM, SHORT_PATHS, shortPathTarget } from "@/lib/acquisition/chemins";
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

const ATTENDU: Array<[string, string]> = [
  ["/dm", "video_1_negociation"],
  ["/verdicts", "video_2_verdicts"],
  ["/produits", "video_3_produits"],
  ["/capture", "video_4_capture"],
  ["/niveau", "video_5_niveau"],
  ["/tiktok", "bio"],
];

describe("les six chemins redirigent vers l'accueil, UTM posés par le serveur", () => {
  it.each(ATTENDU)("%s → accueil avec utm_content=%s", async (path, content) => {
    const response = await call(path);
    expect(response.status).toBe(307);
    const location = response.headers.get("location");
    expect(location).not.toBeNull();
    const target = new URL(location as string, ORIGIN);
    expect(target.pathname).toBe("/");
    expect(params(location as string)).toEqual({
      utm_source: "tiktok",
      utm_medium: "organic_social",
      utm_campaign: "lancement",
      utm_content: content,
    });
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
    for (const [path, content] of Object.entries(SHORT_PATHS)) {
      const response = await call(`/${path}`);
      expect(response.status, path).toBe(307);
      expect(params(response.headers.get("location") as string).utm_content, path).toBe(content);
    }
    expect(Object.keys(SHORT_PATHS)).toHaveLength(ATTENDU.length);
  });

  it("aucun utm_content n'est écrit en dur hors de la table", () => {
    const valeurs = Object.values(SHORT_PATHS);
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
  it("aucun des six n'est dans le sitemap", () => {
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
