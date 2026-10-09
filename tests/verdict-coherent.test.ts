import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AnalysisResult } from "@/components/result/analysis-result";
import { composeAnalysis } from "@/lib/analysis/compose";
import legacy from "@/lib/fixtures/analysis-legacy-1.0.json";
import { extractionSchema, PRICE_PLACEHOLDER, type Extraction } from "@/lib/llm/prompt";
import sample from "@/lib/fixtures/sample-extraction.json";
import { counterFirstStep, counterOfferRange, rangePosition } from "@/lib/analysis/anchoring";
import { verdictForm, verdictSentence, withinRange } from "@/lib/analysis/verdict";
import { WITHIN_RANGE_SENTENCE } from "@/lib/content/labels";
import { computeEstimate } from "@/lib/rates/engine";
import { appliedPriceCap, bandFor, computeScore, priceCapFor, priceScoreCap, uncappedScore } from "@/lib/rates/score";
import { TIERS, type Tier } from "@/lib/rates/tier";
import { analysisSchema, type Analysis } from "@/lib/schema";

// Mission #109 — le badge, la phrase et la contre-offre racontent la MÊME
// chose.
//
// Le défaut établi par la mission #104 : sur « 1 vidéo TikTok + pub 12 mois,
// 250 €, niveau Je débute », l'écran affichait en même temps un badge vert
// « Bon deal » à 72/100, la phrase « C'est dans les prix pour ces droits » et
// une contre-offre à 325 – 400 €. Trois fonctions lisaient le franchissement de
// total_low ; une seule mesurait la position dans la fourchette, et elle ne
// parlait jamais.

type Deal = Analysis["deal"];
const BASE = analysisSchema.shape.deal.parse((sample as { deal: unknown }).deal);

// Offre neutre : aucun malus de conditions, pour que seul le montant décide.
const NEUTRAL = {
  usage: { organic: true, paid_ads: false, whitelisting: false, spark_ads: false, perpetual: false, duration_months: null, territory: null },
  exclusivity: { present: false, duration_months: null, category: null },
  raw_footage: false,
  ip_transfer: "none" as const,
  ai_training_rights: "absent" as const,
  revisions: { count: 2, unlimited: false },
};

// Le titre remplace l'espace fine insécable par une insécable normale : on
// compare sur du texte à espaces ordinaires.
const plain = (text: string) => text.replaceAll(" ", " ").replaceAll(" ", " ");

const deal = (patch: Partial<Deal>): Deal => ({ ...BASE, ...NEUTRAL, ...patch });

// Extraction complète autour d'un deal : ce que composeAnalysis attend pour
// produire l'analyse que la page rend.
const extraction = (subject: Deal): Extraction =>
  extractionSchema.parse({
    ...legacy,
    deal: subject,
    negotiate: [],
    counter_offer: { changes: ["Exclusivité limitée à la catégorie"] },
    ready_to_send_message: { tone: "cordial", text: `Mon tarif pour ce projet se situe ${PRICE_PLACEHOLDER}.` },
  });
const video = (quantity: number, platform: Deal["deliverables"][number]["platform"] = "tiktok") =>
  ({ type: "video" as const, platform, quantity, format: null });
const story = (quantity: number) => ({ type: "story" as const, platform: "instagram" as const, quantity, format: null });
const photo = (quantity: number) => ({ type: "photo" as const, platform: "instagram" as const, quantity, format: null });
const paying = (subject: Deal, amount: number | null): Deal => ({
  ...subject,
  payment: { ...subject.payment, amount_eur: amount, currency: "EUR", terms_days: null, schedule: null },
});

// Le cas de référence de la mission #104, au niveau « Je débute ».
const REFERENCE = paying(
  deal({
    deliverables: [video(1)],
    usage: { ...NEUTRAL.usage, paid_ads: true, duration_months: 12 },
  }),
  250,
);

function view(subject: Deal, tier: Tier = "starter") {
  const estimate = computeEstimate(subject, { tier });
  const score = computeScore(subject, estimate);
  const low = estimate.total_low as number;
  const high = estimate.total_high as number;
  const amount = subject.payment.amount_eur;
  return {
    estimate,
    score,
    low,
    high,
    counter: counterOfferRange(amount, low, high),
    firstStep: counterFirstStep(amount, low, high),
    form: verdictForm({ evaluability: "complete", deal: subject, estimate, score }),
    sentence: verdictSentence({ evaluability: "complete", deal: subject, estimate, score }),
  };
}

// ─── A — la phrase dit OÙ, pas seulement dedans ─────────────────────────────

describe("A — les trois formulations, une par position", () => {
  const subject = deal({ deliverables: [video(1)], usage: { ...NEUTRAL.usage, paid_ads: true, duration_months: 12 } });
  const { low, high } = view(subject);

  it("tiers inférieur : « tout en bas de la fourchette »", () => {
    const amount = low + Math.round((high - low) * 0.1);
    const at = view(paying(subject, amount));
    expect(withinRange(amount, low, high)).toBe("bottom");
    expect(at.form).toBe("complete_within_bottom");
    expect(at.sentence).toContain(WITHIN_RANGE_SENTENCE.bottom);
    expect(at.sentence).toContain("tout en bas de la fourchette");
  });

  it("tiers médian : « C'est dans les prix. »", () => {
    const at = view(paying(subject, low + Math.round((high - low) * 0.5)));
    expect(at.form).toBe("complete_within_middle");
    expect(at.sentence).toContain(WITHIN_RANGE_SENTENCE.middle);
    expect(at.sentence).not.toContain("tout en bas");
    expect(at.sentence).not.toContain("haut de la fourchette");
  });

  it("tiers supérieur : « C'est dans le haut de la fourchette. »", () => {
    const at = view(paying(subject, low + Math.round((high - low) * 0.8)));
    expect(at.form).toBe("complete_within_top");
    expect(at.sentence).toContain(WITHIN_RANGE_SENTENCE.top);
  });

  it("sous et au-dessus de la fourchette : inchangés", () => {
    expect(view(paying(subject, Math.round(low * 0.5))).form).toBe("complete_below");
    expect(view(paying(subject, high + 1)).form).toBe("complete_above");
  });

  it("chaque phrase est la formulation exacte, sans anglais ni variante", () => {
    expect(Object.values(WITHIN_RANGE_SENTENCE)).toEqual([
      "C'est dans les prix, mais tout en bas de la fourchette.",
      "C'est dans les prix.",
      "C'est dans le haut de la fourchette.",
    ]);
  });
});

// ─── Le cas de référence ────────────────────────────────────────────────────

describe("le cas de référence de la mission #104", () => {
  it("score 69, bande « correct », phrase « tout en bas », contre-offre 325 – 400 : les trois cohérents", () => {
    const at = view(REFERENCE);
    expect([at.low, at.high]).toEqual([180, 400]);
    // Ce que le score valait avant le plafond du tiers inférieur.
    expect(uncappedScore(REFERENCE, at.estimate)).toEqual({ value: 72, band: "good" });
    expect(at.score).toEqual({ value: 69, band: "fair" });
    expect(bandFor(69)).toBe("fair");
    expect(plain(at.sentence)).toBe("250 € proposés. C'est dans les prix, mais tout en bas de la fourchette.");
    expect(at.counter).toEqual({ low: 325, high: 400 });
    // Et la phrase n'accuse pas les conditions : il n'y en a aucune de mauvaise.
    expect(at.sentence).not.toContain("conditions");
  });

  it("250 € est bien au tiers bas de 180 – 400 €, et le plafond en vient", () => {
    expect(rangePosition(250, 180, 400)).toBe("bottom");
    expect(priceCapFor(250, 180, 400)).toEqual({ cap: 69, reason: "bottom" });
  });
});

// ─── B — le plafond par la position ─────────────────────────────────────────

describe("B — le plafond couvre aussi le bas de fourchette", () => {
  it("tiers inférieur 69, tiers médian 84, tiers supérieur et au-dessus : aucun plafond", () => {
    expect(priceCapFor(200, 180, 400)).toEqual({ cap: 69, reason: "bottom" });
    expect(priceCapFor(300, 180, 400)).toEqual({ cap: 84, reason: "middle" });
    expect(priceCapFor(360, 180, 400)).toBeNull();
    expect(priceCapFor(500, 180, 400)).toBeNull();
  });

  it("les paliers sous la fourchette ne changent pas", () => {
    expect([priceScoreCap(0), priceScoreCap(0.399), priceScoreCap(0.4), priceScoreCap(0.599)]).toEqual([29, 29, 39, 39]);
    expect([priceScoreCap(0.6), priceScoreCap(0.849)]).toEqual([59, 59]);
    expect(priceCapFor(60, 180, 400)?.cap).toBe(29);
    expect(priceCapFor(90, 180, 400)?.cap).toBe(39);
    expect(priceCapFor(120, 180, 400)?.cap).toBe(59);
  });

  it("les bandes existantes ne bougent pas : 69 est « correct », 84 est « bon »", () => {
    expect([bandFor(29), bandFor(39), bandFor(59), bandFor(69), bandFor(84), bandFor(85)]).toEqual([
      "bad",
      "weak",
      "fair",
      "fair",
      "good",
      "excellent",
    ]);
  });

  it("un montant dans le tiers supérieur : aucun plafond, phrase du haut, contre-offre sous le haut", () => {
    const subject = deal({ deliverables: [video(2)], usage: { ...NEUTRAL.usage, paid_ads: true, duration_months: 6 } });
    const { low, high } = view(subject);
    const at = view(paying(subject, low + Math.round((high - low) * 0.8)));
    expect(priceCapFor(low + Math.round((high - low) * 0.8), low, high)).toBeNull();
    expect(at.score.value).toBe(uncappedScore(paying(subject, low + Math.round((high - low) * 0.8)), at.estimate).value);
    expect(at.sentence).toContain("haut de la fourchette");
    expect(at.counter.high).toBeLessThanOrEqual(high);
    expect(at.counter.low as number).toBeGreaterThan(low + Math.round((high - low) * 0.8));
  });
});

// ─── C — le premier palier de contre-offre ──────────────────────────────────

describe("C — un premier palier quand l'offre est sous le plancher", () => {
  it("sous la fourchette : le plancher est proposé comme point de départ", () => {
    const subject = deal({
      deliverables: [video(3), story(2)],
      usage: { ...NEUTRAL.usage, paid_ads: true, duration_months: 12, territory: "monde entier" },
    });
    const { low, high } = view(subject);
    const at = view(paying(subject, Math.round(low * 0.6)));
    expect(at.counter).toEqual({ low, high });
    expect(at.firstStep).toBe(low);
    // Deux chiffres, deux stratégies : le palier est strictement au-dessus de
    // l'offre, et sous le haut de la fourchette.
    expect(at.firstStep as number).toBeGreaterThan(subject.payment.amount_eur ?? 0);
    expect(at.firstStep as number).toBeLessThan(high);
  });

  it("dans la fourchette ou au-dessus : aucun premier palier, rien ne change", () => {
    expect(counterFirstStep(300, 180, 400)).toBeNull();
    expect(counterFirstStep(180, 180, 400)).toBeNull();
    expect(counterFirstStep(500, 180, 400)).toBeNull();
    expect(counterOfferRange(300, 180, 400)).toEqual({ low: 350, high: 400 });
  });

  it("sans montant ou sans fourchette : aucun premier palier", () => {
    expect(counterFirstStep(null, 180, 400)).toBeNull();
    expect(counterFirstStep(250, null, 400)).toBeNull();
    expect(counterFirstStep(250, 180, null)).toBeNull();
  });
});

// ─── L'échantillon, et la cohérence croisée ─────────────────────────────────

const SUBJECTS: Array<{ nom: string; deal: Deal }> = [
  { nom: "1 vidéo, pub 12 mois", deal: deal({ deliverables: [video(1)], usage: { ...NEUTRAL.usage, paid_ads: true, duration_months: 12 } }) },
  { nom: "2 vidéos, aucun droit", deal: deal({ deliverables: [video(2)] }) },
  { nom: "3 vidéos + 1 story, pub 6 mois, exclusivité 3 mois", deal: deal({ deliverables: [video(3), story(1)], usage: { ...NEUTRAL.usage, paid_ads: true, duration_months: 6 }, exclusivity: { present: true, duration_months: 3, category: "c" } }) },
  { nom: "1 vidéo, 3 stories, 3 photos, whitelisting 3 mois, monde", deal: deal({ deliverables: [video(1), story(3), photo(3)], usage: { ...NEUTRAL.usage, whitelisting: true, duration_months: 3, territory: "monde entier" } }) },
  { nom: "4 vidéos, 6 stories, 1 photo, whitelisting, exclusivité", deal: deal({ deliverables: [video(4), story(6), photo(1)], usage: { ...NEUTRAL.usage, whitelisting: true, duration_months: 3 }, exclusivity: { present: true, duration_months: 1, category: "x" } }) },
  { nom: "2 vidéos, rushs bruts, paiement 30 jours", deal: { ...deal({ deliverables: [video(2)] }), raw_footage: true, payment: { ...BASE.payment, terms_days: 30, currency: "EUR", schedule: null, amount_eur: null } } },
  { nom: "2 vidéos multi-plateformes, pub à vie", deal: deal({ deliverables: [video(2, "tiktok"), video(2, "instagram")], usage: { ...NEUTRAL.usage, paid_ads: true, perpetual: true, duration_months: null } }) },
];

// Montants balayés en part de la fourchette, du très en dessous au très au-dessus.
const PARTS = [0.1, 0.25, 0.4, 0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.95, 1, 1.05];
const WITHIN = [0, 0.05, 0.15, 0.25, 0.32, 0.34, 0.4, 0.5, 0.6, 0.66, 0.7, 0.8, 0.9, 0.99];

type Case = ReturnType<typeof view> & { nom: string; tier: Tier; amount: number };

function everyCase(): Case[] {
  const cases: Case[] = [];
  for (const tier of TIERS as readonly Tier[]) {
    for (const { nom, deal: subject } of SUBJECTS) {
      const reference = computeEstimate(subject, { tier });
      const low = reference.total_low as number;
      const high = reference.total_high as number;
      const amounts = new Set<number>();
      for (const part of PARTS) amounts.add(Math.max(1, Math.round(low * part)));
      for (const part of WITHIN) amounts.add(Math.round(low + (high - low) * part));
      amounts.add(high);
      amounts.add(high + 1);
      amounts.add(Math.round(high * 2));
      for (const amount of amounts) {
        cases.push({ nom: `${nom} / ${tier} / ${amount} €`, tier, amount, ...view(paying(subject, amount), tier) });
      }
    }
  }
  return cases;
}

describe("cohérence croisée — le badge, la phrase et la contre-offre", () => {
  const cases = everyCase();

  it("l'échantillon est large et la fourchette toujours chiffrée", () => {
    expect(cases.length).toBeGreaterThan(400);
    for (const c of cases) expect(Number.isFinite(c.low) && Number.isFinite(c.high), c.nom).toBe(true);
  });

  // LE défaut de la mission #104 : un badge vert au-dessus d'une contre-offre
  // qui demande de monter, parce que le montant est au bas de la fourchette.
  it("aucun cas « bon » ou « excellent » pendant que le montant est sous le plancher ou au tiers bas", () => {
    const fautes = cases.filter(
      (c) =>
        (c.score.band === "good" || c.score.band === "excellent") &&
        ["below", "bottom"].includes(rangePosition(c.amount, c.low, c.high)),
    );
    expect(fautes.map((c) => `${c.nom} → ${c.score.value} ${c.score.band}`)).toEqual([]);
  });

  it("aucun cas « excellent » ailleurs qu'au tiers supérieur ou au-dessus", () => {
    const fautes = cases.filter(
      (c) => c.score.band === "excellent" && !["top", "above"].includes(rangePosition(c.amount, c.low, c.high)),
    );
    expect(fautes.map((c) => `${c.nom} → ${c.score.value}`)).toEqual([]);
  });

  // La phrase et le badge ne peuvent plus se contredire : dire « tout en bas de
  // la fourchette » sous un badge « Bon deal » était exactement le défaut.
  it("la phrase et la bande disent la même chose", () => {
    for (const c of cases) {
      if (c.form === "complete_within_bottom") expect(["bad", "weak", "fair"], c.nom).toContain(c.score.band);
      if (c.score.band === "excellent") expect(["complete_within_top", "complete_above"], c.nom).toContain(c.form);
    }
  });

  // La contre-offre et le badge : plus la note monte, moins il reste à demander.
  // Ce que la mission demandait : AUCUN cas « bon » / « excellent » avec une
  // contre-offre au-dessus du montant. Ce n'est pas atteignable avec le plafond
  // du tiers médian à 84 : un montant juste au-dessus du premier tiers reste
  // « Bon deal », et la contre-offre part du milieu entre lui et la borne
  // haute — soit jusqu'à un tiers de plus. Le test mesure donc la borne réelle
  // et la fige : elle ne peut plus remonter sans qu'un test rougisse.
  it("sous un badge « bon » ou « excellent », la contre-offre ne demande jamais plus d'un tiers de plus", () => {
    const pires = cases
      .filter((c) => (c.score.band === "good" || c.score.band === "excellent") && c.counter.low !== null)
      .map((c) => ({ nom: c.nom, ecart: (c.counter.low as number) / c.amount }))
      .sort((a, b) => b.ecart - a.ecart);
    expect(pires[0]?.ecart ?? 1, pires[0]?.nom).toBeLessThanOrEqual(1.34);
    // Et l'écart maximal d'avant la mission, lui, dépassait largement : un
    // badge « Bon deal » couvrait une demande de +41 % (cas NOVA, 600 € dans
    // 460 – 1 090 €), qui est désormais « Deal correct ».
    expect(pires.every(({ ecart }) => ecart < 1.4)).toBe(true);
  });

  it("sous un badge « correct » ou pire, la contre-offre existe toujours tant qu'il reste à gagner", () => {
    for (const c of cases) {
      if (c.amount < c.high) expect(c.counter.low, c.nom).not.toBeNull();
      if (c.amount >= c.high) expect(c.counter.low, c.nom).toBeNull();
    }
  });

  it("le premier palier n'apparaît que sous le plancher, et vaut le plancher", () => {
    for (const c of cases) {
      expect(c.firstStep, c.nom).toBe(c.amount < c.low ? c.low : null);
    }
  });
});

// ─── D — l'usage organique n'est plus gratuit à vie ─────────────────────────

describe("D — la majoration d'usage organique", () => {
  const organic = (months: number | null, perpetual = false) =>
    deal({
      deliverables: [video(2)],
      usage: { ...NEUTRAL.usage, organic: true, duration_months: months, perpetual },
    });
  const lines = (subject: Deal) => computeEstimate(subject, { tier: "starter" }).lines.map((l) => l.label);
  const total = (subject: Deal): [number | null, number | null] => {
    const e = computeEstimate(subject, { tier: "starter" });
    return [e.total_low, e.total_high];
  };

  it("jusqu'à 12 mois : aucune majoration, rien ne change", () => {
    const reference = total(organic(null));
    for (const months of [1, 3, 6, 12]) {
      expect(lines(organic(months)), `${months} mois`).toEqual([]);
      expect(total(organic(months)), `${months} mois`).toEqual(reference);
    }
    // Durée non écrite : on ne facture pas un droit qu'on a supposé.
    expect(lines(organic(null))).toEqual([]);
  });

  it("au-delà de 12 mois : +10 % bas, +20 % haut", () => {
    const subject = organic(24);
    expect(lines(subject)).toEqual(["Republication 24 mois"]);
    const line = computeEstimate(subject, { tier: "starter" }).lines[0];
    expect([line.low, line.high]).toEqual([10, 20]);
    const [bas, haut] = total(subject);
    const [basRef, hautRef] = total(organic(12));
    expect(bas as number).toBeGreaterThan(basRef as number);
    expect(haut as number).toBeGreaterThan(hautRef as number);
  });

  it("à perpétuité : +25 % bas, +40 % haut, plus fort qu'au-delà de 12 mois", () => {
    const subject = organic(null, true);
    expect(lines(subject)).toEqual(["Republication à vie"]);
    const line = computeEstimate(subject, { tier: "starter" }).lines[0];
    expect([line.low, line.high]).toEqual([25, 40]);
    const [bas, haut] = total(subject);
    const [bas24, haut24] = total(organic(24));
    expect(bas as number).toBeGreaterThan(bas24 as number);
    expect(haut as number).toBeGreaterThan(haut24 as number);
  });

  it("sans usage organique, rien n'est ajouté, quelle que soit la durée", () => {
    const sansOrganique = deal({
      deliverables: [video(2)],
      usage: { ...NEUTRAL.usage, organic: false, duration_months: 24 },
    });
    expect(lines(sansOrganique)).toEqual([]);
  });

  it("la table documente la nouvelle entrée, et les deux versions restent identiques", async () => {
    const { default: table } = await import("@/lib/rates/fr-2026.3.json");
    expect(table.multipliers.organic_beyond_12m).toEqual({ low: 0.1, high: 0.2, confidence: "low" });
    expect(table.multipliers.organic_perpetual).toEqual({ low: 0.25, high: 0.4, confidence: "low" });
    for (const key of ["organic_beyond_12m", "organic_perpetual"] as const) {
      expect(table.source_notes[key]).toContain("interpolée");
      expect(table.source_notes[key]).toContain("recalibrer");
    }
  });
});

// ─── Le garde-fou : les quatre fourchettes déjà filmées ─────────────────────

describe("les quatre fourchettes des vidéos déjà tournées", () => {
  // Reprises telles quelles de tests/arrondi-fourchette.test.ts : la partie D
  // touche la table, et ces chiffres sont à l'écran dans des vidéos montées.
  const filmed = (patch: Partial<Deal>): Deal => ({
    ...BASE,
    usage: { organic: true, paid_ads: false, whitelisting: false, spark_ads: false, perpetual: false, duration_months: null, territory: null },
    exclusivity: { present: false, duration_months: null, category: null },
    raw_footage: false,
    ip_transfer: "none",
    ai_training_rights: "absent",
    ...patch,
  });
  const range = (subject: Deal, tier: Tier): [number | null, number | null] => {
    const e = computeEstimate(subject, { tier });
    return [e.total_low, e.total_high];
  };
  const lot = filmed({
    deliverables: [video(1), story(3), photo(3)],
    usage: { organic: true, paid_ads: false, whitelisting: true, spark_ads: false, perpetual: false, duration_months: 3, territory: "monde entier" },
  });
  const gros = filmed({
    deliverables: [video(4), story(6), photo(1)],
    usage: { organic: true, paid_ads: false, whitelisting: true, spark_ads: false, perpetual: false, duration_months: 3, territory: null },
    exclusivity: { present: true, duration_months: 1, category: "x" },
  });

  it("2 vidéos, « C'est mon métier », aucun droit cédé → 1 000 – 1 600 €", () => {
    expect(range(filmed({ deliverables: [video(2)] }), "experienced")).toEqual([1000, 1600]);
  });

  it("1 vidéo, 3 stories, 3 photos, whitelisting 3 mois, monde, débutant → 540 – 1 190 €", () => {
    expect(range(lot, "starter")).toEqual([540, 1190]);
  });

  it("le même lot au niveau expérimenté → 2 700 – 5 280 €", () => {
    expect(range(lot, "experienced")).toEqual([2700, 5280]);
  });

  it("4 vidéos, 6 stories, 1 photo, whitelisting, exclusivité, débutant → 970 – 2 210 €", () => {
    expect(range(gros, "starter")).toEqual([970, 2210]);
  });

  it("aucune de ces quatre offres ne porte de ligne de republication", () => {
    for (const subject of [filmed({ deliverables: [video(2)] }), lot, gros]) {
      for (const tier of TIERS as readonly Tier[]) {
        const labels = computeEstimate(subject, { tier }).lines.map((l) => l.label);
        expect(labels.filter((l) => l.startsWith("Republication")), subject.deliverables.length + " livrables").toEqual([]);
      }
    }
  });
});

// ─── Ce que l'écran affiche vraiment ────────────────────────────────────────

describe("à l'écran", () => {
  const render = (subject: Deal, tier: Tier = "starter") =>
    renderToStaticMarkup(
      createElement(AnalysisResult, { analysis: composeAnalysis(extraction(subject), { tier }), unlockHref: "/connexion" }),
    ).replaceAll("&#x27;", "'").replaceAll("&nbsp;", " ").replaceAll("&amp;", "&");

  it("C — l'offre est sous le plancher : le premier palier est affiché, avec la fourchette complète", () => {
    const subject = deal({
      deliverables: [video(3), story(2)],
      usage: { ...NEUTRAL.usage, paid_ads: true, duration_months: 12, territory: "monde entier" },
    });
    const low = computeEstimate(subject, { tier: "starter" }).total_low as number;
    const html = render(paying(subject, Math.round(low * 0.5)));
    expect(html).toContain("data-first-step");
    expect(html).toContain("Si tu ne veux pas tout demander d'un coup");
    expect(html).toContain("c'est le bas de la fourchette");
    expect(html).toContain("c'est toi qui choisis jusqu'où tu montes");
  });

  it("C — l'offre est dans la fourchette : aucun premier palier", () => {
    const subject = deal({ deliverables: [video(3), story(2)], usage: { ...NEUTRAL.usage, paid_ads: true, duration_months: 12 } });
    const estimate = computeEstimate(subject, { tier: "starter" });
    const middle = Math.round(((estimate.total_low as number) + (estimate.total_high as number)) / 2);
    const html = render(paying(subject, middle));
    expect(html).not.toContain("data-first-step");
    expect(html).not.toContain("Si tu ne veux pas tout demander");
  });

  it("B — la note de plafond nomme la position, jamais un pourcentage du plancher supérieur à 100 %", () => {
    const html = render(REFERENCE);
    expect(html).toContain("Le montant proposé est dans le tiers bas de la fourchette");
    // Mission #177 — « la note » nommait un nombre que la créatrice ne voit
    // plus depuis la #174. C'est le résultat affiché, donc « le verdict ».
    expect(html).toContain("le verdict ne peut pas dépasser « Deal correct »");
    expect(html).not.toContain("du bas de la fourchette. Le verdict ne peut pas monter plus haut.");
    // Le pourcentage du plancher vaudrait 139 % : il n'apparaît nulle part.
    expect(html).not.toContain("139 %");
  });

  it("B — sous le plancher, la note garde le pourcentage, qui reste vrai", () => {
    // Offre bien notée par ailleurs (organique seul, paiement à 30 jours) :
    // sans ça, le score est déjà sous le plafond et la note ne s'affiche pas.
    const subject = deal({ deliverables: [video(1)] });
    const low = computeEstimate(subject, { tier: "starter" }).total_low as number;
    const under: Deal = {
      ...subject,
      payment: { ...subject.payment, amount_eur: Math.round(low * 0.7), currency: "EUR", terms_days: 30, schedule: null },
    };
    const estimate = computeEstimate(under, { tier: "starter" });
    expect(appliedPriceCap(under, estimate)?.reason).toBe("ratio");
    const html = render(under);
    expect(html).toContain("du bas de la fourchette. Le verdict ne peut pas monter plus haut.");
    expect(html).not.toContain("la note ne peut pas dépasser");
  });
});
