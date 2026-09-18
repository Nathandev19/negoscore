import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { BRAND } from "@/lib/brand";
import { PLANS, PRICE } from "@/lib/billing/plans";
import { ORGANIZATION_ID, organizationJsonLd, SOCIAL_PROFILES, webSiteJsonLd } from "@/lib/seo";

// Mission #069, B2 — le JSON-LD de la page d'accueil, lu tel que la page le
// sert : JSON valide, types attendus, et des valeurs identiques à celles que le
// site affiche ailleurs.

vi.mock("@/components/deal-input", () => ({ DealInput: () => <form aria-label="saisie" /> }));
vi.mock("@/components/analytics/track-view", () => ({ TrackView: () => null }));
vi.mock("@/components/site-header", () => ({ SiteHeader: () => null }));

const { default: HomePage } = await import("@/app/page");

// Blocs <script type="application/ld+json"> d'un rendu HTML, parsés.
function jsonLdBlocks(html: string): Array<Record<string, unknown>> {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(
    (m) => JSON.parse(m[1]) as Record<string, unknown>,
  );
}

// « 4,99 € » affiché → « 4.99 » attendu par schema.org.
const schemaPrice = (displayed: string) => displayed.replace(/\s|€/g, "").replace(",", ".");

type Offer = { name: string; price: string; priceCurrency: string; description: string; priceSpecification?: Record<string, unknown> };

describe("JSON-LD de la page d'accueil", () => {
  const html = renderToStaticMarkup(<HomePage />);
  const page = jsonLdBlocks(html);
  // L'organisation et le site sont posés par la mise en page, sur chaque page.
  const layout = readFileSync(path.join(process.cwd(), "app/layout.tsx"), "utf8");
  const all = [...page, organizationJsonLd(), webSiteJsonLd()];

  it("des blocs JSON valides, et les trois types attendus", () => {
    expect(page.length).toBeGreaterThan(0);
    expect(layout).toContain("<JsonLd data={organizationJsonLd()} />");
    expect(layout).toContain("<JsonLd data={webSiteJsonLd()} />");
    expect(all.map((b) => b["@type"]).sort()).toEqual(["Organization", "WebApplication", "WebSite"]);
    for (const bloc of all) expect(bloc["@context"]).toBe("https://schema.org");
  });

  it("le nom de l'organisation est celui du site, et l'application s'y rattache", () => {
    const app = page.find((b) => b["@type"] === "WebApplication") as Record<string, unknown>;
    expect(organizationJsonLd().name).toBe(BRAND.name);
    expect(app.name).toBe(BRAND.name);
    expect(app.publisher).toEqual({ "@id": ORGANIZATION_ID });
    expect(webSiteJsonLd().publisher).toEqual({ "@id": ORGANIZATION_ID });
    // Le nom déclaré est bien celui qui s'affiche sur la page.
    expect(html).toContain(BRAND.name);
  });

  it("la description est la promesse de l'accueil, déjà servie en méta-description", () => {
    const app = page.find((b) => b["@type"] === "WebApplication") as Record<string, unknown>;
    expect(typeof app.description).toBe("string");
    expect(String(app.description).length).toBeGreaterThan(40);
  });

  it("les prix sont ceux de /tarifs (même source), pas des valeurs recopiées", () => {
    const app = page.find((b) => b["@type"] === "WebApplication") as { offers: Offer[] };
    expect(app.offers.map((o) => o.name)).toEqual(PLANS.map((p) => p.name));
    expect(app.offers.map((o) => o.price)).toEqual(PLANS.map((p) => schemaPrice(p.price)));
    // Et ce sont les prix affichés : PRICE est ce que /tarifs et l'accueil montrent.
    expect(app.offers.map((o) => o.price)).toEqual([PRICE.free, PRICE.pack, PRICE.pro].map(schemaPrice));
    for (const offer of app.offers) expect(offer.priceCurrency).toBe("EUR");
  });

  it("l'abonnement dit sa périodicité avec la propriété prévue, pas « category »", () => {
    const app = page.find((b) => b["@type"] === "WebApplication") as { offers: Offer[] };
    const pro = app.offers.find((o) => o.name === "Pro") as Offer;
    expect(pro).not.toHaveProperty("category");
    expect(pro.priceSpecification).toMatchObject({
      "@type": "UnitPriceSpecification",
      price: schemaPrice(PRICE.pro),
      referenceQuantity: { value: 1, unitCode: "MON" },
    });
    // Les formules sans abonnement n'en ont pas.
    for (const offer of app.offers.filter((o) => o.name !== "Pro")) expect(offer).not.toHaveProperty("priceSpecification");
  });

  it("rien d'inventé : ni note, ni avis, ni chiffre d'usage, ni date de fondation, et seulement de vrais comptes", () => {
    const texte = JSON.stringify(all);
    for (const interdit of ["aggregateRating", "review", "ratingValue", "ratingCount", "userInteractionCount", "interactionStatistic", "foundingDate", "numberOfEmployees"]) {
      expect(texte, interdit).not.toContain(interdit);
    }
    expect(organizationJsonLd().sameAs).toEqual([...SOCIAL_PROFILES]);
    expect([...SOCIAL_PROFILES]).toEqual(["https://www.tiktok.com/@negoscore"]);
  });
});
