import type { MetadataRoute } from "next";
import { CANONICAL_ORIGIN, PUBLIC_PAGES } from "@/lib/seo";

// sitemap.xml (mission #047) : les pages publiques et stables seulement, à leur
// adresse définitive. Pas de date de modification : aucune n'est suivie de
// façon fiable, et une date fausse vaut moins qu'une absence de date.
export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_PAGES.map((page) => ({ url: `${CANONICAL_ORIGIN}${page.path === "/" ? "" : page.path}` }));
}
