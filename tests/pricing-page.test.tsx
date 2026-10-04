import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PricingGuidePage from "@/app/combien-facturer/page";
import sitemap from "@/app/sitemap";
import { FOOTER_COLUMNS } from "@/components/site-footer";
import { billableUnits, computeEstimate, upliftCap } from "@/lib/rates/engine";
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

  // Mission #061 : /droits-utilisation cite le même exemple. Il est recalculé
  // ici aussi, pour que les deux guides ne puissent plus diverger de la table.
  it("le guide des droits cite les mêmes chiffres, recalculés depuis la table", async () => {
    const { default: UsageRightsPage } = await import("@/app/droits-utilisation/page");
    const rights = renderToStaticMarkup(<UsageRightsPage />)
      .replaceAll("&#x27;", "'")
      .replaceAll(" ", " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ");
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
    expect(rights).toContain(
      `Trois vidéos TikTok et une story chez un créateur qui débute, ça vaut entre ${nombre(estimate.base_low as number)} et ${nombre(estimate.base_high as number)} € de création`,
    );
    expect(rights).toContain(
      `l'offre juste monte entre ${nombre(estimate.total_low as number)} et ${nombre(estimate.total_high as number)} €`,
    );
    const ads = rates.multipliers.paid_ads_6m;
    const exclusivite = rates.multipliers.exclusivity_3m;
    expect(rights).toContain(`Six mois de droits publicitaires : compte ${Math.round(ads.low * 100)} % à ${Math.round(ads.high * 100)} %`);
    expect(rights).toContain(
      `Trois mois d'exclusivité sur la catégorie : compte ${Math.round(exclusivite.low * 100)} % à ${Math.round(exclusivite.high * 100)} %`,
    );
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
    // Mission #105 — l'écart d'arrondi du total à la dizaine est logé dans les
    // lignes de majoration : la ligne vaut sa part à un euro près, et c'est la
    // somme qui tombe juste. Les chiffres du guide viennent du moteur.
    expect([ads?.eur_low, ads?.eur_high]).toEqual([150, 379]);
    expect([exclusivite?.eur_low, exclusivite?.eur_high]).toEqual([90, 271]);
    expect((estimate.base_high ?? 0) + (ads?.eur_high ?? 0) + (exclusivite?.eur_high ?? 0)).toBe(estimate.total_high);

    expect(texte).toContain(`ça fait ${euros(300, 540)}`);
    expect(texte).toContain(`soit ${euros(150, 379)} en plus`);
    expect(texte).toContain(`soit ${euros(90, 271)} en plus`);
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
    // Mission #152 — l'exemple chiffré rejoint la colonne : c'est le même
    // usage que les guides, montrer avant de demander, et c'est le seul
    // chemin vers lui depuis une page qui n'est pas l'accueil.
        expect(guides?.links.map((lien) => lien.href)).toEqual([
          "/combien-facturer",
          "/droits-utilisation",
          "/produits-offerts",
          "/analyse/demo?de=pied-de-page",
        ]);
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

// Mission #055 — les deux paragraphes ajoutés au guide : whitelisting et Spark
// Ads facturés au mois, et plafond des majorations cumulées. Les valeurs sont
// relues dans la table, le texte casse si elle change.
describe("guide des tarifs — compléments #055", () => {
  it("whitelisting et Spark Ads : le pourcentage mensuel est celui de la table, pour les deux", () => {
    const { whitelisting_per_month: white, spark_ads_per_month: spark } = rates.multipliers;
    expect([white.low, white.high]).toEqual([spark.low, spark.high]);
    expect(texte).toContain(`Compte +${Math.round(white.low * 100)} à +${Math.round(white.high * 100)} % par mois, pour chacun`);
  });

  it("six mois de whitelisting : la valeur annoncée est bien celle que le moteur facture", () => {
    const mois = 6;
    const { whitelisting_per_month: white } = rates.multipliers;
    const cap = rates.uplift_caps.standard.max_cumulative_uplift;
    const brutLow = white.low * mois;
    const brutHigh = white.high * mois;
    // Le plafond standard ramène les deux bornes à +150 % quand le whitelisting est seul.
    const applique = [Math.min(brutLow, cap), Math.min(brutHigh, cap)];
    expect(applique).toEqual([1.5, 1.5]);
    expect(texte).toContain("ce n'est pas +50 % : c'est de l'ordre de +150 %");
  });

  it("le plafond des majorations cumulées est celui de la table, et le cas « lourd » aussi", () => {
    expect(rates.uplift_caps.standard.max_cumulative_uplift).toBe(1.5);
    expect(rates.uplift_caps.heavy.max_cumulative_uplift).toBe(2.5);
    expect(texte).toContain("plafonné à +150 % du prix de création");
    expect(texte).toContain("ne monte à +250 % que si la marque demande l'usage à vie ou la cession totale des droits");
    // Le plafond « lourd » ne se déclenche que sur ces deux cas.
    const perpetuel = deal({ usage: { organic: true, paid_ads: true, whitelisting: false, spark_ads: false, perpetual: true, duration_months: null, territory: null } });
    const cession = deal({ ip_transfer: "full_assignment" });
    expect(upliftCap(perpetuel)).toBe(2.5);
    expect(upliftCap(cession)).toBe(2.5);
    expect(upliftCap(deal())).toBe(1.5);
  });

  it("un seul lien vers /produits-offerts, dans le corps de la page", () => {
    expect([...html.matchAll(/href="\/produits-offerts"/g)].filter((m) => html.indexOf("<footer") > (m.index ?? 0))).toHaveLength(1);
  });
});
