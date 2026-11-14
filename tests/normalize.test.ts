import { describe, expect, it } from "vitest";
import { composeAnalysis } from "@/lib/analysis/compose";
import { evaluability } from "@/lib/analysis/evaluability";
import { normalizeDeal } from "@/lib/analysis/normalize";
import sample from "@/lib/fixtures/analysis-legacy-1.0.json";
import { extractionSchema, type Extraction } from "@/lib/llm/prompt";
import { computeEstimate } from "@/lib/rates/engine";
import { computeScore } from "@/lib/rates/score";
import { analysisSchema, type Analysis } from "@/lib/schema";

type Deal = Analysis["deal"];

const NO_USAGE: Deal["usage"] = {
  organic: false,
  paid_ads: false,
  whitelisting: false,
  spark_ads: false,
  duration_months: null,
  territory: null,
  // Mission #160 — normalizeDeal garantit ce champ : il existe toujours après
  // normalisation, trié par la liste fermée de la table (lib/rates/zones.ts).
  territory_zones: [],
  perpetual: false,
};

// Deal extrait en production pour « Tu postes 1 vidéo sur ton TikTok, on te paie 250 € ».
const POSTS_ON_OWN_ACCOUNT: Deal = {
  // Mission #116 — relu par le schéma : les champs ajoutés depuis prennent
  // leur valeur par défaut, comme pour une analyse enregistrée.
  ...analysisSchema.shape.deal.parse(sample.deal),
  brand: null,
  deliverables: [{ type: "video", platform: "tiktok", quantity: 1, format: null }],
  publication_required: true,
  usage: NO_USAGE,
  exclusivity: { present: false, duration_months: null, category: null },
  raw_footage: false,
  ip_transfer: "none",
  revisions: { count: null, unlimited: false },
  payment: { amount_eur: 250, currency: "EUR", terms_days: null, schedule: null },
};

function extraction(deal: Deal): Extraction {
  return extractionSchema.parse({
    ...sample,
    deal,
    negotiate: [],
    counter_offer: { changes: [] },
    ready_to_send_message: { tone: "cordial", text: "Merci !" },
  });
}

describe("normalizeDeal", () => {
  it("publier sur son compte implique un usage organique", () => {
    const deal = normalizeDeal(POSTS_ON_OWN_ACCOUNT);
    expect(deal.usage.organic).toBe(true);
    expect(POSTS_ON_OWN_ACCOUNT.usage.organic).toBe(false);
  });

  it("ne déduit aucun autre drapeau, ni durée, ni territoire", () => {
    const deal = normalizeDeal(POSTS_ON_OWN_ACCOUNT);
    expect(deal.usage).toEqual({ ...NO_USAGE, organic: true });
    // Mission #215 — `diffusion` est le SECOND champ que la normalisation
    // complète, et le seul autre : tout le reste est recopié tel quel.
    expect({ ...deal, usage: NO_USAGE, diffusion: POSTS_ON_OWN_ACCOUNT.diffusion }).toEqual(POSTS_ON_OWN_ACCOUNT);
  });

  // Mission #215 — UNE SEULE DIRECTION.
  //
  // Le cas vient d'un tour de négociation : `publication_required` peut passer
  // à true (groupe « publication ») alors que `diffusion` n'est pas dans le
  // schéma du tour et resterait celle de l'offre d'origine. L'écran dirait
  // alors « Publication sur tes comptes : Oui » et, deux blocs plus bas, que la
  // marque diffuse seule.
  it("une publication demandée ne peut pas coexister avec « la marque diffuse seule »", () => {
    expect(POSTS_ON_OWN_ACCOUNT.diffusion).toBe("unspecified");
    expect(normalizeDeal(POSTS_ON_OWN_ACCOUNT).diffusion).toBe("creator");
    const contradictoire = { ...POSTS_ON_OWN_ACCOUNT, diffusion: "brand_only" as const };
    expect(normalizeDeal(contradictoire).diffusion).toBe("creator");
  });

  it("et JAMAIS l'inverse : un false ne fabrique pas « la marque diffuse seule »", () => {
    // `publication_required === false` confond « l'offre dit non » et « l'offre
    // n'en parle pas » : c'est l'ambiguïté que la #215 est venue lever, elle ne
    // va pas la refabriquer ici.
    const sans = { ...POSTS_ON_OWN_ACCOUNT, publication_required: false };
    expect(normalizeDeal(sans).diffusion).toBe("unspecified");
    expect(normalizeDeal({ ...sans, diffusion: "creator" as const }).diffusion).toBe("creator");
  });

  it("sans publication sur le compte, rien ne change", () => {
    const deal = { ...POSTS_ON_OWN_ACCOUNT, publication_required: false };
    // Depuis la mission #058, la normalisation reconstruit toujours le deal
    // (quantités et durées à 0 ramenées à null) : c'est l'égalité des valeurs
    // qui compte, plus celle des références.
    expect(normalizeDeal(deal)).toStrictEqual(deal);
  });

  it("ne passe jamais un drapeau de vrai à faux", () => {
    const rich: Deal = {
      ...POSTS_ON_OWN_ACCOUNT,
      publication_required: false,
      usage: { organic: true, paid_ads: true, whitelisting: true, spark_ads: true, duration_months: 6, territory: "France", territory_zones: [], perpetual: true },
    };
    expect(normalizeDeal(rich)).toEqual(rich);
    const published = { ...rich, publication_required: true };
    // Mission #215 — un seul champ change, et c'est `diffusion` : voir le test
    // de la cohérence à sens unique ci-dessus.
    expect(normalizeDeal(published)).toEqual({ ...published, diffusion: "creator" });
  });
});

describe("composeAnalysis sur un deal normalisé", () => {
  it("la fixture 22 quitte « incomplete » et tout lit la même donnée", () => {
    expect(evaluability(POSTS_ON_OWN_ACCOUNT)).toBe("incomplete");
    const analysis = composeAnalysis(extraction(POSTS_ON_OWN_ACCOUNT));
    const normalized = normalizeDeal(POSTS_ON_OWN_ACCOUNT);
    // Périmètre et prix connus ; ses conditions ne le sont pas (mission #017).
    expect(analysis.evaluability).toBe("terms_unknown");
    expect(analysis.deal.usage.organic).toBe(true);
    expect(analysis.estimate.total_low).toBe(computeEstimate(normalized).total_low);
    const withTerms: Deal = { ...POSTS_ON_OWN_ACCOUNT, usage: { ...NO_USAGE, duration_months: 3 }, revisions: { count: 2, unlimited: false } };
    const complete = composeAnalysis(extraction(withTerms));
    const normalizedWithTerms = normalizeDeal(withTerms);
    expect(complete.evaluability).toBe("complete");
    expect(complete.score).toEqual(computeScore(normalizedWithTerms, computeEstimate(normalizedWithTerms)));
  });
});
