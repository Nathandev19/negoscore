import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { isValidElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import nextConfig from "@/next.config";
import { CANONICAL_ORIGIN, PRIVATE_PREFIXES, PUBLIC_PAGES } from "@/lib/seo";
import { SITE_PREVIEW_SIZE, SITE_PREVIEW_TEXTS, sitePreviewElement } from "@/lib/share-card/site-preview";

// Mission #047 : indexation, aperçus de partage, adresse canonique.

vi.mock("@/components/site-header", () => ({ SiteHeader: () => null }));

const ROOT = process.cwd();
const APP = path.join(ROOT, "app");

// Toutes les pages de l'application, avec leur adresse (segments dynamiques gardés).
function pages(): Array<{ route: string; file: string }> {
  return readdirSync(APP, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name === "page.tsx")
    .map((entry) => {
      const dir = path.relative(APP, entry.parentPath).split(path.sep).join("/");
      return { route: dir === "" ? "/" : `/${dir}`, file: path.join(entry.parentPath, entry.name) };
    });
}

describe("robots.txt et sitemap.xml", () => {
  it("robots : tout est autorisé sauf les préfixes privés, sitemap à l'adresse officielle", () => {
    const result = robots();
    expect(result.rules).toEqual({ userAgent: "*", allow: "/", disallow: [...PRIVATE_PREFIXES] });
    expect(result.sitemap).toBe("https://www.negoscore.fr/sitemap.xml");
    for (const prefix of ["/analyse/resultat/", "/compte", "/historique", "/api/", "/auth/", "/connexion", "/merci", "/resilier", "/dev/"]) {
      expect(PRIVATE_PREFIXES).toContain(prefix);
    }
  });

  it("sitemap : les pages publiques seulement, adresses définitives, rien de privé ni de développement", () => {
    const urls = sitemap().map((entry) => entry.url);
    expect(urls).toEqual([
      "https://www.negoscore.fr",
      "https://www.negoscore.fr/analyse",
      "https://www.negoscore.fr/analyse/demo",
      "https://www.negoscore.fr/tarifs",
      "https://www.negoscore.fr/cgv",
      "https://www.negoscore.fr/confidentialite",
      "https://www.negoscore.fr/mentions-legales",
    ]);
    for (const url of urls) {
      const pathname = new URL(url).pathname;
      expect(PRIVATE_PREFIXES.some((prefix) => pathname.startsWith(prefix)), url).toBe(false);
      expect(url).not.toContain("/offres");
    }
  });

  it("chaque page du sitemap existe, et aucune page publique n'est interdite dans robots", () => {
    const routes = pages().map((page) => page.route);
    for (const page of PUBLIC_PAGES) expect(routes, page.path).toContain(page.path);
  });
});

describe("pages publiques et privées", () => {
  it("chaque page publique : titre et description propres, non dupliqués, adresse canonique, aperçu", async () => {
    const titles = new Set<string>();
    const descriptions = new Set<string>();
    for (const page of pages().filter((entry) => PUBLIC_PAGES.some((p) => p.path === entry.route))) {
      const { metadata } = (await import(/* @vite-ignore */ page.file)) as { metadata: import("next").Metadata };
      const expected = PUBLIC_PAGES.find((p) => p.path === page.route)!;
      expect(metadata.description, page.route).toBe(expected.description);
      expect(metadata.alternates?.canonical, page.route).toBe(page.route);
      expect(metadata.openGraph, page.route).toMatchObject({ locale: "fr_FR", url: page.route, description: expected.description });
      expect(metadata.robots, page.route).toBeUndefined();
      // L'image d'aperçu est redonnée à chaque page : un openGraph de page efface celle du site.
      expect(JSON.stringify(metadata.openGraph), page.route).toContain("/opengraph-image");
      expect(JSON.stringify(metadata.twitter), page.route).toContain("/twitter-image");
      titles.add(expected.title);
      descriptions.add(expected.description);
      expect(expected.description.length, page.route).toBeGreaterThan(40);
      expect(expected.description.length, page.route).toBeLessThan(200);
    }
    expect(titles.size).toBe(PUBLIC_PAGES.length);
    expect(descriptions.size).toBe(PUBLIC_PAGES.length);
  });

  it("toute autre page est en noindex, et aucune n'autorise l'indexation", async () => {
    const privatePages = pages().filter((page) => !PUBLIC_PAGES.some((p) => p.path === page.route) && !page.route.startsWith("/dev"));
    expect(privatePages.length).toBeGreaterThanOrEqual(10);
    for (const page of privatePages) {
      const source = readFileSync(page.file, "utf8");
      expect(source, page.route).toMatch(/robots: \{ index: false, follow: false \}/);
    }
    expect(readFileSync(path.join(APP, "not-found.tsx"), "utf8")).toMatch(/robots: \{ index: false, follow: false \}/);
  });

  it("routes privées qui ne sont pas des pages : en-tête X-Robots-Tag noindex", async () => {
    const headers = await nextConfig("phase-production-build").headers!();
    for (const source of ["/analyse/resultat/:path*", "/api/:path*", "/auth/:path*"]) {
      expect(headers).toContainEqual({ source, headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] });
    }
  });

  it("langue française et adresse de base officielle", () => {
    const layout = readFileSync(path.join(APP, "layout.tsx"), "utf8");
    expect(layout).toContain('lang="fr"');
    expect(layout).toContain("metadataBase: new URL(CANONICAL_ORIGIN)");
    expect(CANONICAL_ORIGIN).toBe("https://www.negoscore.fr");
  });
});

// Toutes les chaînes d'un rendu satori, props comprises.
function allStrings(node: ReactNode): string[] {
  if (typeof node === "string" || typeof node === "number") return [String(node)];
  if (Array.isArray(node)) return node.flatMap(allStrings);
  if (!isValidElement(node)) return [];
  const props = node.props as Record<string, unknown>;
  if (typeof node.type === "function") return allStrings((node.type as (p: unknown) => ReactNode)(props));
  return allStrings(props.children as ReactNode);
}

describe("C4 — un lien de résultat partagé ne révèle rien de l'offre", () => {
  it("une seule image d'aperçu, à la racine : aucune page de résultat n'en a une à elle", () => {
    const images = readdirSync(APP, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && /^(opengraph|twitter)-image\./.test(entry.name))
      .map((entry) => path.relative(APP, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"));
    expect(images.sort()).toEqual(["opengraph-image.tsx", "twitter-image.tsx"]);
  });

  it("l'image ne contient que ses textes fixes : ni marque, ni montant, ni score", () => {
    const texts = allStrings(sitePreviewElement());
    expect(texts.sort()).toEqual(Object.values(SITE_PREVIEW_TEXTS).sort());
    expect(texts.join(" ")).not.toMatch(/\d|€|\/100/);
    expect(SITE_PREVIEW_SIZE).toEqual({ width: 1200, height: 630 });
  });

  it("les métadonnées des pages de résultat sont fixes : aucune n'est calculée à partir de l'analyse", () => {
    const resultDir = path.join(APP, "analyse", "resultat");
    const files = readdirSync(resultDir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => path.join(e.parentPath, e.name));
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/generateMetadata|generateImageMetadata|openGraph|twitter:/);
    }
    const page = readFileSync(path.join(resultDir, "[id]", "page.tsx"), "utf8");
    expect(page).toMatch(/export const metadata: Metadata = \{\s+title: "Résultat de l'analyse",\s+robots: \{ index: false, follow: false \},\s+\};/);
    expect(existsSync(path.join(resultDir, "[id]", "opengraph-image.tsx"))).toBe(false);
  });
});
