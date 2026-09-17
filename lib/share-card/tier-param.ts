import { parseTier, type Tier } from "@/lib/rates/tier";

// Niveau de la carte partageable, passé dans l'adresse de l'image : ?niveau=…
export const TIER_PARAM = "niveau";

export function withTier(href: string, tier: Tier): string {
  return `${href}${href.includes("?") ? "&" : "?"}${TIER_PARAM}=${tier}`;
}

export function tierFromUrl(url: string): Tier | null {
  return parseTier(new URL(url).searchParams.get(TIER_PARAM));
}
