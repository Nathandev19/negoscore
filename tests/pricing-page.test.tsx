import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PricingGuidePage from "@/app/combien-facturer/page";
import sitemap from "@/app/sitemap";
import { FOOTER_COLUMNS } from "@/components/site-footer";
import { billableUnits, computeEstimate } from "@/lib/rates/engine";
import rates from "@/lib/rates/fr-2026.3.json";
import { TIERS } from "@/lib/rates/tier";
import { CANONICAL_ORIGIN, publicPageMetadata, PUBLIC_PAGES } from "@/lib/seo";
import type { Analysis } from "@/lib/schema";

// Mission #054 — la page /combien-facturer publie des fourchettes. Chaque
// chiffre affiché est ici RECALCULÉ depuis lib/rates/fr-2026.3.json et le
// moteur : le jour où la table change, ce test échoue avant la mise en ligne.

const html = renderToStaticMarkup(<PricingGuidePage />);
const texte = html
  .replaceAll("&#x27;", "'")
  .replaceAll("&amp;", "&")
  .replaceAll(" ", " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/\s+/g, " ");

// « 1 410 » est écrit avec une espace fine insécable par le formateur du site.
const nombre = (value: number) => value.toLocaleString("fr-FR").replace(/ | /g, " ");
const euros = (low: number, high: number) => `${nombre(low)} à ${nombre(high)} €`;
const pourcents = (low: number, high: number) => `+${Math.round(low * 100)} à +${Math.round(high * 100)} %`;

type Deal = Analysis["deal"];

// Deal minimal : seuls les livrables et les droits changent d'un cas à l'autre.
function deal(part: Partial<Deal> = {}): Deal {
  return {
    brand: null,
    deliverables: [{ type: "video", platform: "tiktok", quantity: 1, format: null }],
    publication_required: true,
    usage: { organic: true, paid_ads: false, whitelisting: false, spark_ads: false, perpetual: false, duration_months: null, territory: null },
    exclusivity: { present: false, duration_months: null, category: null },
    raw_footage: false,
    ip_transfer: "license",
    ai_training_rights: "absent",
    revisions: { count: null, unlimited: false },
    payment: { amount_eur: null, currency: "EUR", terms_days: null, schedule: null },
    in_kind_value_eur: null,
    deadlines: [],
    kill_fee: null,
    termination: null,
    governing_law: null,
    ...part,
  } as Deal;
}

describe("page /combien-facturer", () => {
  it("les tarifs de base affichés sont ceux de la table, pour les trois niveaux", () => {
    for (const tier of TIERS) {
      const { low, high } = rates.base_rates_eur[tier];
      expect(texte, `${tier} ${low}-${high}`).toContain(euros(low, high));
    }
  });

  it("les coefficients des autres formats sont bien un quart, un tiers environ, et autant qu'une vidéo", () => {
    expect(rates.deliverable_weights.story.weight).toBe(0.25);
    expect(rates.deliverable_weights.photo.weight).toBeCloseTo(1 / 3, 1);
    expect(rates.deliverable_weights.live.weight).toBe(rates.deliverable_weights.video.weight);
    expect(texte).toContain("une story vaut un quart d'une vidéo, une photo un tiers environ, un live autant qu'une vidéo");
  });

  it("la majoration par plateforme supplémentaire est celle de la table", () => {
    const { low, high } = rates.multipliers.extra_platform;
    expect(texte).toContain(`compte ${Math.round(low * 100)} à ${Math.round(high * 100)} % en plus par plateforme`);
  });

  it("le tableau des volumes est recalculé par le moteur, niveau « Je débute »", () => {
    for (const quantite of [1, 2, 3, 5, 10]) {
      const estimate = computeEstimate(deal({ deliverables: [{ type: "video", platform: "tiktok", quantity: quantite, format: null }] }), { tier: "starter" });
      // Sans droits ni exclusivité, le total est la création arrondie à la dizaine.
      expect(estimate.lines).toHaveLength(0);
      expect(texte, `${quantite} vidéos`).toContain(euros(estimate.total_low as number, estimate.total_high as number));
      expect(billableUnits(quantite)).toBeGreaterThan(0);
    }
  });

  it("les tableaux des droits pub et de l'exclusivité reprennent les coefficients de la table", () => {
    const attendus: Array<[keyof typeof rates.multipliers, string]> = [
      ["paid_ads_1m", "1 mois"],
      ["paid_ads_3m", "3 mois"],
      ["paid_ads_6m", "6 mois"],
      ["paid_ads_12m", "12 mois"],
      ["paid_ads_perpetual", "À vie"],
      ["exclusivity_1m", "1 mois"],
      ["exclusivity_3m", "3 mois"],
      ["exclusivity_6m_plus", "6 mois et plus"],
      ["territory_worldwide", "Territoire monde"],
      ["ip_full_assignment", "Cession totale"],
    ];
    for (const [cle] of attendus) {
      const { low, high } = rates.multipliers[cle];
      expect(texte, cle).toContain(pourcents(low, high));
    }
  });

  it("l'exemple complet est celui que le moteur calcule vraiment", () => {
    const exemple = deal({
      deliverables: [
        { type: "video", platform: "tiktok", quantity: 3, format: null },
        { type: "story", platform: "tiktok", quantity: 1, format: null },
      ],
      usage: { organic: true, paid_ads: true, whitelisting: false, spark_ads: false, perpetual: false, duration_months: 6, territory: null },
      exclusivity: { present: true, duration_months: 3, category: "catégorie" },
      payment: { amount_eur: 300, currency: "EUR", terms_days: null, schedule: null },
    });
    const estimate = computeEstimate(exemple, { tier: "starter" });
    expect([estimate.base_low, estimate.base_high]).toEqual([300, 540]);
    expect([estimate.total_low, estimate.total_high]).toEqual([540, 1190]);
    const ads = estimate.lines.find((line) => line.topic === "paid_ads");
    const exclusivite = estimate.lines.find((line) => line.topic === "exclusivity");
    expect([ads?.eur_low, ads?.eur_high]).toEqual([150, 378]);
    expect([exclusivite?.eur_low, exclusivite?.eur_high]).toEqual([90, 270]);

    expect(texte).toContain(`ça fait ${euros(300, 540)}`);
    expect(texte).toContain(`soit ${euros(150, 378)} en plus`);
    expect(texte).toContain(`soit ${euros(90, 270)} en plus`);
    expect(texte).toContain("Total juste : entre 540 et 1 190 €");
  });

  it("un seul h1, des tableaux qui restent des tableaux, et le lien final vers l'analyse", () => {
    expect([...html.matchAll(/<h1[^>]*>/g)]).toHaveLength(1);
    expect([...html.matchAll(/<table[^>]*>/g)]).toHaveLength(4);
    expect(html).toMatch(/href="\/analyse"[^>]*>[^<]*Analyser mon deal/);
  });

  it("un seul lien vers /droits-utilisation, et la page réciproque en a un vers ici", async () => {
    expect([...html.matchAll(/href="\/droits-utilisation"/g)].filter((m) => html.indexOf("<footer") > (m.index ?? 0))).toHaveLength(1);
    const { default: UsageRightsPage } = await import("@/app/droits-utilisation/page");
    const rights = renderToStaticMarkup(<UsageRightsPage />);
    expect([...rights.matchAll(/href="\/combien-facturer"/g)].filter((m) => rights.indexOf("<footer") > (m.index ?? 0))).toHaveLength(1);
  });

  it("elle est publique : métadonnées, sitemap, et une entrée dans la colonne Guides", () => {
    const meta = publicPageMetadata("/combien-facturer");
    expect(meta.title).toBe("Tarifs UGC : combien facturer une vidéo, une story, une photo");
    expect(sitemap().map((entry) => entry.url)).toContain(`${CANONICAL_ORIGIN}/combien-facturer`);
    const guides = FOOTER_COLUMNS.find((colonne) => colonne.title === "Guides");
    expect(guides?.links.map((lien) => lien.href)).toEqual(["/combien-facturer", "/droits-utilisation"]);
    expect(FOOTER_COLUMNS.find((colonne) => colonne.title === "Produit")?.links.map((lien) => lien.href)).not.toContain(
      "/droits-utilisation",
    );
  });

  it("aucune autre page publique n'a le même titre ni la même description", () => {
    const titres = PUBLIC_PAGES.map((page) => page.title);
    const descriptions = PUBLIC_PAGES.map((page) => page.description);
    expect(new Set(titres).size).toBe(titres.length);
    expect(new Set(descriptions).size).toBe(descriptions.length);
  });
});
