import type { MetadataRoute } from "next";
import { CANONICAL_ORIGIN, PRIVATE_PREFIXES } from "@/lib/seo";

// robots.txt (mission #047) : pages publiques autorisées, tout ce qui touche
// une personne ou la technique interdit. Voir PRIVATE_PREFIXES dans lib/seo.ts.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: [...PRIVATE_PREFIXES] },
    sitemap: `${CANONICAL_ORIGIN}/sitemap.xml`,
  };
}
