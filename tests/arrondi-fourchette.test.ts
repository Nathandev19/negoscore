import { describe, expect, it } from "vitest";
import sample from "@/lib/fixtures/sample-extraction.json";
import { apportion, computeEstimate, roundedDown, roundedUp } from "@/lib/rates/engine";
import { TIERS, type Tier } from "@/lib/rates/tier";
import { analysisSchema, type Analysis } from "@/lib/schema";

// Mission #105 — des totaux ronds ET une addition juste.
//
// #104 avait rendu l'addition exacte en supprimant l'arrondi à la dizaine ; les
// fourchettes ont cessé d'être rondes, alors que cinq vidéos déjà tournées
// montrent les anciens chiffres. On veut les deux : le total revient à la
// dizaine (plancher en bas, plafond en haut), et l'écart est absorbé par les
// LIGNES DE MAJORATION — jamais par la ligne de création, qui est l'ancre.

type Deal = Analysis["deal"];
const BASE = analysisSchema.shape.deal.parse((sample as { deal: unknown }).deal);

const NO_RIGHTS = {
  usage: { organic: true, paid_ads: false, whitelisting: false, spark_ads: false, perpetual: false, duration_months: null, territory: null },
  exclusivity: { present: false, duration_months: null, category: null },
  raw_footage: false,
  ip_transfer: "none" as const,
  ai_training_rights: "absent" as const,
};

const deal = (patch: Partial<Deal>): Deal => ({ ...BASE, ...NO_RIGHTS, ...patch });

const video = (quantity: number, platform: Deal["deliverables"][number]["platform"] = "tiktok") =>
  ({ type: "video" as const, platform, quantity, format: null });
const story = (quantity: number) => ({ type: "story" as const, platform: "instagram" as const, quantity, format: null });
const photo = (quantity: number) => ({ type: "photo" as const, platform: "instagram" as const, quantity, format: null });

const range = (subject: Deal, tier: Tier): [number | null, number | null] => {
  const estimate = computeEstimate(subject, { tier });
  return [estimate.total_low, estimate.total_high];
};

// ─── L'invariant, sur un échantillon large ──────────────────────────────────

const ECHANTILLON: Array<{ nom: string; deal: Deal; lignes: number }> = [
  { nom: "aucune majoration", deal: deal({ deliverables: [video(2)] }), lignes: 0 },
  {
    nom: "une majoration",
    deal: deal({ deliverables: [video(1)], usage: { ...NO_RIGHTS.usage, paid_ads: true, duration_months: 12 } }),
    lignes: 1,
  },
  {
    nom: "trois majorations",
    deal: deal({
      deliverables: [video(3), story(1)],
      usage: { ...NO_RIGHTS.usage, paid_ads: true, duration_months: 6 },
      exclusivity: { present: true, duration_months: 3, category: "catégorie" },
      raw_footage: true,
    }),
    lignes: 3,
  },
  {
    nom: "six majorations, plafond de cumul atteint",
    deal: deal({
      deliverables: [video(2, "tiktok"), video(2, "instagram")],
      usage: { organic: true, paid_ads: true, whitelisting: true, spark_ads: true, perpetual: false, duration_months: 12, territory: "monde entier" },
      exclusivity: { present: true, duration_months: 12, category: "tout" },
      raw_footage: true,
      ip_transfer: "full_assignment",
    }),
    lignes: 6,
  },
  {
    nom: "majorations et forfait d'accroches",
    deal: deal({
      deliverables: [{ type: "video", platform: "tiktok", quantity: 2, format: "3 hooks" }],
      usage: { ...NO_RIGHTS.usage, paid_ads: true, duration_months: 3 },
    }),
    lignes: 2,
  },
];

describe("la somme des lignes vaut le total, sur les deux bornes", () => {
  it("échantillon complet, trois niveaux", () => {
    for (const tier of TIERS as readonly Tier[]) {
      for (const { nom, deal: subject, lignes } of ECHANTILLON) {
        const estimate = computeEstimate(subject, { tier });
        const percent = estimate.lines.filter((line) => line.type === "percent");
        expect(percent.length, `${nom} / ${tier}`).toBeGreaterThanOrEqual(lignes === 0 ? 0 : 1);
        if (lignes === 0) expect(estimate.lines, `${nom} / ${tier}`).toHaveLength(0);

        const bas = (estimate.base_low ?? 0) + estimate.lines.reduce((sum, line) => sum + line.eur_low, 0);
        const haut = (estimate.base_high ?? 0) + estimate.lines.reduce((sum, line) => sum + line.eur_high, 0);
        expect(estimate.total_low, `${nom} / ${tier} (bas)`).toBe(bas);
        expect(estimate.total_high, `${nom} / ${tier} (haut)`).toBe(haut);
        // I-c : la borne basse ne dépasse jamais la borne haute.
        expect(estimate.total_low ?? 0).toBeLessThanOrEqual(estimate.total_high ?? 0);
        // Aucune ligne vidée par l'ajustement.
        for (const line of percent) expect(line.eur_low, `${nom} / ${tier} / ${line.label}`).toBeGreaterThan(0);
      }
    }
  });

  it("dès qu'il y a une majoration, la fourchette est ronde", () => {
    for (const tier of TIERS as readonly Tier[]) {
      for (const { nom, deal: subject, lignes } of ECHANTILLON) {
        if (lignes === 0) continue;
        const [bas, haut] = range(subject, tier);
        expect((bas ?? 0) % 10, `${nom} / ${tier} (bas)`).toBe(0);
        expect((haut ?? 0) % 10, `${nom} / ${tier} (haut)`).toBe(0);
      }
    }
  });

  it("aucune majoration : le total vaut la base, sans arrondi supplémentaire", () => {
    const estimate = computeEstimate(deal({ deliverables: [video(3)] }), { tier: "starter" });
    expect(estimate.lines).toHaveLength(0);
    expect([estimate.total_low, estimate.total_high]).toEqual([estimate.base_low, estimate.base_high]);
    expect([estimate.total_low, estimate.total_high]).toEqual([280, 504]);
  });

  it("écart impossible à absorber : le total reste exact plutôt que faux", () => {
    // Une seule story sur deux plateformes : la majoration vaut 2,50 €, il n'y
    // a pas de quoi descendre le total à la dizaine inférieure sans vider la
    // ligne. L'addition juste passe avant la rondeur.
    const subject = deal({ deliverables: [story(1), { type: "story", platform: "tiktok", quantity: 1, format: null }] });
    const estimate = computeEstimate(subject, { tier: "starter" });
    const majoration = estimate.lines.find((line) => line.topic === "extra_platform");
    expect(majoration?.eur_low).toBeGreaterThan(0);
    expect(estimate.total_low).toBe((estimate.base_low ?? 0) + estimate.lines.reduce((sum, line) => sum + line.eur_low, 0));
    expect((estimate.total_low ?? 0) % 10).not.toBe(0);
  });
});

// ─── Monotonie ──────────────────────────────────────────────────────────────

describe("ajouter un droit ne fait jamais baisser une borne", () => {
  it("empilement successif de droits, trois niveaux", () => {
    const etapes: Array<Partial<Deal>> = [
      {},
      { usage: { ...NO_RIGHTS.usage, paid_ads: true, duration_months: 3 } },
      { usage: { ...NO_RIGHTS.usage, paid_ads: true, duration_months: 12 } },
      { usage: { ...NO_RIGHTS.usage, paid_ads: true, duration_months: 12 }, exclusivity: { present: true, duration_months: 3, category: "x" } },
      { usage: { ...NO_RIGHTS.usage, paid_ads: true, duration_months: 12 }, exclusivity: { present: true, duration_months: 3, category: "x" }, raw_footage: true },
      {
        usage: { ...NO_RIGHTS.usage, paid_ads: true, duration_months: 12, territory: "monde entier" },
        exclusivity: { present: true, duration_months: 6, category: "x" },
        raw_footage: true,
      },
      {
        usage: { organic: true, paid_ads: true, whitelisting: true, spark_ads: true, perpetual: true, duration_months: 12, territory: "monde entier" },
        exclusivity: { present: true, duration_months: 12, category: "x" },
        raw_footage: true,
        ip_transfer: "full_assignment",
      },
    ];
    for (const tier of TIERS as readonly Tier[]) {
      let previous: [number, number] = [0, 0];
      for (const [index, patch] of etapes.entries()) {
        const [bas, haut] = range(deal({ deliverables: [video(2)], ...patch }), tier);
        expect(bas ?? 0, `${tier} étape ${index} (bas)`).toBeGreaterThanOrEqual(previous[0]);
        expect(haut ?? 0, `${tier} étape ${index} (haut)`).toBeGreaterThanOrEqual(previous[1]);
        previous = [bas ?? 0, haut ?? 0];
      }
    }
  });

  it("durée des droits pub, mois par mois", () => {
    for (const tier of TIERS as readonly Tier[]) {
      let previous: [number, number] = [0, 0];
      for (let months = 1; months <= 24; months += 1) {
        const [bas, haut] = range(deal({ deliverables: [video(2)], usage: { ...NO_RIGHTS.usage, paid_ads: true, duration_months: months } }), tier);
        expect(bas ?? 0, `${tier} ${months} mois (bas)`).toBeGreaterThanOrEqual(previous[0]);
        expect(haut ?? 0, `${tier} ${months} mois (haut)`).toBeGreaterThanOrEqual(previous[1]);
        previous = [bas ?? 0, haut ?? 0];
      }
    }
  });
});

// ─── Validation chiffrée ────────────────────────────────────────────────────

describe("les chiffres que le produit doit reproduire", () => {
  it("cas de référence : 1 vidéo TikTok + pub 12 mois, débutant → 180 – 400 €", () => {
    const subject = deal({
      deliverables: [video(1)],
      usage: { ...NO_RIGHTS.usage, paid_ads: true, duration_months: 12 },
      payment: { amount_eur: 250, currency: "EUR", terms_days: null, schedule: null },
    });
    expect(range(subject, "starter")).toEqual([180, 400]);
  });

  it("l'exemple des deux guides publics → 540 – 1 190 €", () => {
    const subject = deal({
      deliverables: [video(3), { type: "story", platform: "tiktok", quantity: 1, format: null }],
      usage: { ...NO_RIGHTS.usage, paid_ads: true, duration_months: 6 },
      exclusivity: { present: true, duration_months: 3, category: "catégorie" },
    });
    expect(range(subject, "starter")).toEqual([540, 1190]);
  });

  it("le tableau des volumes de /combien-facturer, sans aucun droit", () => {
    // Aucune majoration : pas d'arrondi possible sans casser l'addition.
    expect(range(deal({ deliverables: [video(1)] }), "starter")).toEqual([100, 180]);
    expect(range(deal({ deliverables: [video(2)] }), "starter")).toEqual([200, 360]);
    expect(range(deal({ deliverables: [video(3)] }), "starter")).toEqual([280, 504]);
    expect(range(deal({ deliverables: [video(5)] }), "starter")).toEqual([430, 774]);
    expect(range(deal({ deliverables: [video(10)] }), "starter")).toEqual([780, 1404]);
  });

  it("les quatre fourchettes des vidéos déjà tournées", () => {
    // 2 vidéos, « C'est mon métier », aucun droit cédé.
    expect(range(deal({ deliverables: [video(2)] }), "experienced")).toEqual([1000, 1600]);

    // 1 vidéo, 3 stories, 3 photos, whitelisting 3 mois, monde entier.
    const lot = deal({
      deliverables: [video(1), story(3), photo(3)],
      usage: { organic: true, paid_ads: false, whitelisting: true, spark_ads: false, perpetual: false, duration_months: 3, territory: "monde entier" },
    });
    expect(range(lot, "starter")).toEqual([540, 1190]);
    expect(range(lot, "experienced")).toEqual([2700, 5280]);

    // 4 vidéos, 6 stories, 1 photo, whitelisting 3 mois, exclusivité 1 mois.
    const gros = deal({
      deliverables: [video(4), story(6), photo(1)],
      usage: { organic: true, paid_ads: false, whitelisting: true, spark_ads: false, perpetual: false, duration_months: 3, territory: null },
      exclusivity: { present: true, duration_months: 1, category: "x" },
    });
    expect(range(gros, "starter")).toEqual([970, 2210]);
  });
});

// ─── La répartition elle-même ───────────────────────────────────────────────

describe("la répartition à plus fort reste", () => {
  it("sans cible : la somme vaut l'arrondi de la somme exacte", () => {
    expect(apportion([1.4, 1.4, 1.4])).toEqual([2, 1, 1]);
    expect(apportion([10.5, 4.25])).toEqual([11, 4]);
  });

  it("avec une cible : elle est atteinte exactement, en ajoutant comme en retirant", () => {
    expect(apportion([10, 10, 10], 36)?.reduce((sum, value) => sum + value, 0)).toBe(36);
    expect(apportion([10, 10, 10], 24)?.reduce((sum, value) => sum + value, 0)).toBe(24);
    // Les euros ajoutés vont aux plus grandes fractions, un par ligne à chaque
    // passage : deux euros à répartir sur deux lignes en donnent un à chacune.
    expect(apportion([10.9, 10.1], 22)).toEqual([11, 11]);
    expect(apportion([10.9, 10.1], 21)).toEqual([11, 10]);
  });

  it("aucune ligne n'est vidée pour atteindre la cible", () => {
    // Trois lignes à 2 €, cible 2 : il faudrait en vider une, on refuse.
    expect(apportion([2, 2, 2], 2)).toBeNull();
    // Cible atteignable sans vider : chacune garde au moins un euro.
    expect(apportion([2, 2, 2], 3)).toEqual([1, 1, 1]);
    expect(apportion([2, 2, 2], 4)).toEqual([2, 1, 1]);
  });

  it("l'arrondi à la dizaine, dans les deux sens", () => {
    expect(roundedDown(396)).toBe(390);
    expect(roundedDown(180)).toBe(180);
    expect(roundedUp(396)).toBe(400);
    expect(roundedUp(1188)).toBe(1190);
    // Stabilisé : 399,9999999 est 400, pas 390.
    expect(roundedDown(399.9999999)).toBe(400);
  });
});

// ─── I-d : ni le score, ni le badge, ni le verdict ne bougent ───────────────

describe("l'arrondi d'affichage ne touche à rien d'autre", () => {
  it("le score et la bande du cas de référence ne bougent pas avec l'arrondi", async () => {
    const { computeScore } = await import("@/lib/rates/score");
    const subject = deal({
      deliverables: [video(1)],
      usage: { ...NO_RIGHTS.usage, paid_ads: true, duration_months: 12 },
      payment: { amount_eur: 250, currency: "EUR", terms_days: null, schedule: null },
      in_kind_value_eur: null,
    });
    const estimate = computeEstimate(subject, { tier: "starter" });
    expect([estimate.total_low, estimate.total_high]).toEqual([180, 400]);

    // Le score lit la fourchette affichée. On le recalcule sur la fourchette
    // NON arrondie de #104 (180 – 396) : même note, même bande. L'arrondi
    // d'affichage ne déplace ni le verdict ni la couleur.
    const arrondi = computeScore(subject, estimate as never);
    const exact = computeScore(subject, { ...estimate, total_high: 396 } as never);
    expect(arrondi).toEqual(exact);
  });

  it("sur tout l'échantillon, arrondir ne change pas la bande", async () => {
    const { computeScore } = await import("@/lib/rates/score");
    for (const tier of TIERS as readonly Tier[]) {
      for (const { nom, deal: subject } of ECHANTILLON) {
        const estimate = computeEstimate(subject, { tier });
        for (const montant of [100, 250, 500, 1000, 2000]) {
          const withAmount = { ...subject, payment: { ...subject.payment, amount_eur: montant } };
          const arrondi = computeScore(withAmount, estimate as never);
          // Fourchette décalée de l'arrondi maximal, dans les deux sens.
          const decale = computeScore(withAmount, {
            ...estimate,
            total_low: (estimate.total_low ?? 0) + 9,
            total_high: (estimate.total_high ?? 0) - 9,
          } as never);
          expect(Math.abs(arrondi.value - decale.value), `${nom} / ${tier} / ${montant} €`).toBeLessThanOrEqual(3);
        }
      }
    }
  });
});
