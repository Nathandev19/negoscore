import { beforeAll, describe, expect, it } from "vitest";
import { computeEstimate, upliftCap, volumeDiscountFactor } from "@/lib/rates/engine";
import { computeScore, uncappedScore } from "@/lib/rates/score";
import { DEFAULT_TIER, TIERS, type Tier } from "@/lib/rates/tier";
import { analysisSchema, type Analysis } from "@/lib/schema";

// Invariants du moteur de chiffrage et du score : des règles que le moteur ne
// doit JAMAIS violer, vérifiées sur ~400 deals générés à graine fixe et sur des
// cas limites explicites. Un invariant qui échoue ne s'assouplit pas : c'est le
// moteur qui est faux.
//
// Cadrage commun : total_low et total_high valent null sans montant proposé ou
// quand trop peu de champs sont renseignés. Ajouter une information peut faire
// passer un total de null à un nombre : ce n'est pas une violation. Les
// invariants I1 à I10 ne comparent donc que les paires où les deux totaux sont
// des nombres ; I0 vérifie qu'un total ne repasse jamais d'un nombre à null.

type Deal = Analysis["deal"];
type Estimate = ReturnType<typeof computeEstimate>;

// ── Générateur déterministe ─────────────────────────────────────────────────
// LCG de Numerical Recipes : même graine, mêmes deals, mêmes échecs.
function lcg(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
  return {
    next,
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)],
    chance: (p: number) => next() < p,
  };
}

const SEED = 20260917;
const TYPES = ["video", "photo", "story", "live"] as const;
const PLATFORMS = ["tiktok", "instagram", "youtube", "other", null] as const;
const DURATIONS = [null, 0, 1, 2, 3, 5, 6, 7, 12, 13, 24, 36] as const;
const NUMERIC_DURATIONS = DURATIONS.filter((d): d is Exclude<(typeof DURATIONS)[number], null> => d !== null);
const UNITS = [0.25, 0.5, 1, 1.75, 2, 2.25, 3, 4, 4.25, 5, 7.75, 8, 8.25, 9, 12, 20] as const;
const IP = ["none", "license", "full_assignment", "unclear"] as const;
const AI = ["absent", "present", "unclear"] as const;
const TERMS = [null, 15, 30, 45, 60, 90, 120] as const;
const AMOUNTS = [0, 50, 150, 300, 600, 900, 1500, 3000, 6000] as const;

function clone(deal: Deal): Deal {
  return structuredClone(deal);
}

function randomDeal(rng: ReturnType<typeof lcg>): Deal {
  const deliverables = Array.from({ length: rng.int(1, 3) }, () => ({
    type: rng.pick(TYPES),
    platform: rng.pick(PLATFORMS),
    quantity: rng.int(1, 6),
    format: rng.chance(0.1) ? "30 s, 2 hooks" : null,
  }));
  const deal: Deal = {
    // Mission #116 — aucune commission dans l'échantillon : le périmètre est
    // une branche, pas le produit.
    variable_pay: { present: false, rate_percent: null, base: null, per_sale_eur: null, attribution_days: null, payout: null },
    brand: rng.chance(0.8) ? "Marque" : null,
    deliverables,
    publication_required: rng.chance(0.4),
    usage: {
      organic: rng.chance(0.5),
      paid_ads: rng.chance(0.4),
      whitelisting: rng.chance(0.2),
      spark_ads: rng.chance(0.2),
      duration_months: rng.pick(DURATIONS),
      territory: rng.pick([null, "France", "monde entier", "Europe"] as const),
      perpetual: rng.chance(0.15),
    },
    exclusivity: {
      present: rng.chance(0.35),
      duration_months: rng.pick(DURATIONS),
      category: rng.chance(0.5) ? "cosmétique" : null,
    },
    raw_footage: rng.chance(0.3),
    ip_transfer: rng.pick(IP),
    ai_training_rights: rng.pick(AI),
    revisions: { count: rng.pick([null, 1, 2, 3] as const), unlimited: rng.chance(0.15) },
    payment: {
      amount_eur: rng.chance(0.85) ? rng.pick(AMOUNTS) : null,
      currency: "EUR",
      terms_days: rng.pick(TERMS),
      schedule: null,
    },
    in_kind_value_eur: rng.chance(0.1) ? 80 : null,
    deadlines: [],
    kill_fee: null,
    termination: null,
    governing_law: null,
  };
  return analysisSchema.shape.deal.parse(deal);
}

// Deal dont les unités pondérées valent exactement u : vidéos + stories (0,25).
function withUnits(deal: Deal, units: number): Deal {
  const next = clone(deal);
  const videos = Math.floor(units);
  const stories = Math.round((units - videos) * 4);
  next.deliverables = [
    ...(videos > 0 ? [{ type: "video" as const, platform: "tiktok" as const, quantity: videos, format: null }] : []),
    ...(stories > 0 ? [{ type: "story" as const, platform: "tiktok" as const, quantity: stories, format: null }] : []),
  ];
  return next;
}

const PLAIN: Deal = analysisSchema.shape.deal.parse({
  brand: "Marque",
  deliverables: [{ type: "video", platform: "tiktok", quantity: 1, format: null }],
  publication_required: true,
  usage: { organic: true, paid_ads: false, whitelisting: false, spark_ads: false, duration_months: 3, territory: "France", perpetual: false },
  exclusivity: { present: false, duration_months: null, category: null },
  raw_footage: false,
  ip_transfer: "license",
  ai_training_rights: "absent",
  revisions: { count: 2, unlimited: false },
  payment: { amount_eur: 600, currency: "EUR", terms_days: 30, schedule: null },
  in_kind_value_eur: null,
  deadlines: [],
  kill_fee: null,
  termination: null,
  governing_law: null,
});

function buildPopulation(): Deal[] {
  const rng = lcg(SEED);
  const random = Array.from({ length: 400 }, () => randomDeal(rng));
  const bases = [PLAIN, ...random.slice(0, 8)];
  const edges: Deal[] = [];
  for (const base of bases) {
    for (const units of UNITS) edges.push(withUnits(base, units));
    for (const duration of DURATIONS) {
      const d = clone(base);
      d.usage = { ...d.usage, paid_ads: true, whitelisting: true, duration_months: duration };
      d.exclusivity = { present: true, duration_months: duration, category: null };
      edges.push(d);
    }
    for (const ip of IP) for (const ai of AI) edges.push({ ...clone(base), ip_transfer: ip, ai_training_rights: ai });
  }
  return [...random, ...edges];
}

const POPULATION = buildPopulation();

// ── Outils de comparaison ───────────────────────────────────────────────────
// Niveau de la créatrice (mission #039) : les invariants valent À NIVEAU CONSTANT,
// et sont vérifiés pour chacun des trois niveaux.
let tier: Tier = DEFAULT_TIER;
const estimate = (deal: Deal): Estimate => computeEstimate(deal, { tier });
const hasTotals = (e: Estimate) => e.total_low !== null && e.total_high !== null;

type Violation = { label: string; deal: Deal; other: Deal; totals: string };

function report(violations: Violation[]): string {
  if (violations.length === 0) return "";
  const first = violations[0];
  return [
    `${violations.length} violation(s). Première : ${first.label}`,
    `Totaux comparés : ${first.totals}`,
    `Deal de départ : ${JSON.stringify(first.deal)}`,
    `Deal comparé : ${JSON.stringify(first.other)}`,
  ].join("\n");
}

// Vérifie heavy ≥ light sur les deux totaux, seulement si les deux sont des nombres.
function checkNotCheaper(violations: Violation[], label: string, light: Deal, heavy: Deal) {
  const a = estimate(light);
  const b = estimate(heavy);
  if (!hasTotals(a) || !hasTotals(b)) return;
  if (b.total_low! < a.total_low! || b.total_high! < a.total_high!) {
    violations.push({
      label,
      deal: light,
      other: heavy,
      totals: `${a.total_low}–${a.total_high} € puis ${b.total_low}–${b.total_high} €`,
    });
  }
}

function expectNone(violations: Violation[]) {
  expect(violations.length, report(violations)).toBe(0);
}

// ── Contraintes : ajout (plus lourd) et retrait (plus léger) ────────────────
type Constraint = { name: string; has: (d: Deal) => boolean; add: (d: Deal) => Deal; remove: (d: Deal) => Deal };

function flag(name: string, key: "paid_ads" | "whitelisting" | "spark_ads" | "perpetual"): Constraint {
  return {
    name,
    has: (d) => d.usage[key],
    add: (d) => ({ ...clone(d), usage: { ...d.usage, [key]: true } }),
    remove: (d) => ({ ...clone(d), usage: { ...d.usage, [key]: false } }),
  };
}

function platformsOf(d: Deal): Set<string> {
  return new Set(d.deliverables.map((x) => x.platform).filter((p): p is NonNullable<typeof p> => p !== null));
}

const CONSTRAINTS: Constraint[] = [
  flag("publicité payante", "paid_ads"),
  flag("whitelisting", "whitelisting"),
  flag("Spark Ads", "spark_ads"),
  flag("utilisation à vie", "perpetual"),
  {
    name: "raw footage",
    has: (d) => d.raw_footage,
    add: (d) => ({ ...clone(d), raw_footage: true }),
    remove: (d) => ({ ...clone(d), raw_footage: false }),
  },
  {
    name: "exclusivité",
    has: (d) => d.exclusivity.present,
    add: (d) => ({ ...clone(d), exclusivity: { ...d.exclusivity, present: true } }),
    remove: (d) => ({ ...clone(d), exclusivity: { ...d.exclusivity, present: false } }),
  },
  {
    name: "territoire monde",
    has: (d) => d.usage.territory === "monde entier",
    add: (d) => ({ ...clone(d), usage: { ...d.usage, territory: "monde entier" } }),
    remove: (d) => ({ ...clone(d), usage: { ...d.usage, territory: "France" } }),
  },
  {
    name: "cession totale",
    has: (d) => d.ip_transfer === "full_assignment",
    add: (d) => ({ ...clone(d), ip_transfer: "full_assignment" }),
    remove: (d) => ({ ...clone(d), ip_transfer: "license" }),
  },
  {
    // Un livrable de plus, sur une plateforme absente jusque-là.
    name: "plateforme supplémentaire",
    has: (d) => platformsOf(d).size >= 2,
    add: (d) => {
      const used = platformsOf(d);
      const platform = (["tiktok", "instagram", "youtube", "other"] as const).find((p) => !used.has(p)) ?? "other";
      return { ...clone(d), deliverables: [...d.deliverables, { type: "video", platform, quantity: 1, format: null }] };
    },
    remove: (d) => {
      const last = d.deliverables.at(-1);
      const counts = d.deliverables.filter((x) => x.platform === last?.platform).length;
      // Retire le dernier livrable s'il porte seul sa plateforme ; sinon rien.
      return counts === 1 && d.deliverables.length > 1 ? { ...clone(d), deliverables: d.deliverables.slice(0, -1) } : clone(d);
    },
  },
];

const SCORE_ONLY_CONSTRAINTS: Constraint[] = [
  {
    name: "entraînement IA",
    has: (d) => d.ai_training_rights === "present",
    add: (d) => ({ ...clone(d), ai_training_rights: "present" }),
    remove: (d) => ({ ...clone(d), ai_training_rights: "absent" }),
  },
  {
    name: "révisions illimitées",
    has: (d) => d.revisions.unlimited,
    add: (d) => ({ ...clone(d), revisions: { ...d.revisions, unlimited: true } }),
    remove: (d) => ({ ...clone(d), revisions: { ...d.revisions, unlimited: false } }),
  },
];

// ── Invariants ──────────────────────────────────────────────────────────────
describe.each(TIERS)("invariants du moteur de chiffrage, niveau %s", (level) => {
  beforeAll(() => {
    tier = level;
  });

  it("I0 — ajouter une information ne fait jamais passer un total d'un nombre à null", () => {
    const violations: Violation[] = [];
    const additions: Array<[string, (d: Deal) => Deal]> = [
      ...[...CONSTRAINTS, ...SCORE_ONLY_CONSTRAINTS].map((c) => [c.name, c.add] as [string, (d: Deal) => Deal]),
      ["durée des droits", (d) => ({ ...clone(d), usage: { ...d.usage, duration_months: d.usage.duration_months ?? 6 } })],
      ["territoire", (d) => ({ ...clone(d), usage: { ...d.usage, territory: d.usage.territory ?? "France" } })],
      ["marque", (d) => ({ ...clone(d), brand: d.brand ?? "Marque" })],
      ["délai de paiement", (d) => ({ ...clone(d), payment: { ...d.payment, terms_days: d.payment.terms_days ?? 30 } })],
      ["livrable", (d) => ({ ...clone(d), deliverables: [...d.deliverables, { type: "story", platform: null, quantity: 1, format: null }] })],
    ];
    for (const deal of POPULATION) {
      const before = estimate(deal);
      if (!hasTotals(before)) continue;
      for (const [name, add] of additions) {
        const other = add(deal);
        const after = estimate(other);
        if (!hasTotals(after)) {
          violations.push({ label: name, deal, other, totals: `${before.total_low}–${before.total_high} € puis null` });
        }
      }
    }
    expectNone(violations);
  });

  it("I1 — allonger la durée des droits ne fait jamais baisser le total", () => {
    const violations: Violation[] = [];
    for (const deal of POPULATION) {
      for (let i = 1; i < NUMERIC_DURATIONS.length; i++) {
        const shorter = { ...clone(deal), usage: { ...deal.usage, duration_months: NUMERIC_DURATIONS[i - 1] } };
        const longer = { ...clone(deal), usage: { ...deal.usage, duration_months: NUMERIC_DURATIONS[i] } };
        checkNotCheaper(violations, `durée ${NUMERIC_DURATIONS[i - 1]} → ${NUMERIC_DURATIONS[i]} mois`, shorter, longer);
      }
    }
    expectNone(violations);
  });

  it("I2 — l'utilisation à vie n'est jamais moins chère qu'une durée finie", () => {
    const violations: Violation[] = [];
    for (const deal of POPULATION) {
      for (const duration of DURATIONS) {
        const finite = { ...clone(deal), usage: { ...deal.usage, perpetual: false, duration_months: duration } };
        const perpetual = { ...clone(deal), usage: { ...deal.usage, perpetual: true, duration_months: duration } };
        checkNotCheaper(violations, `durée ${duration} → à vie`, finite, perpetual);
      }
    }
    expectNone(violations);
  });

  it("I3 — ajouter une contrainte ne fait jamais baisser le total", () => {
    const violations: Violation[] = [];
    for (const deal of POPULATION) {
      for (const c of CONSTRAINTS) {
        if (!c.has(deal)) checkNotCheaper(violations, `ajout : ${c.name}`, deal, c.add(deal));
      }
    }
    expectNone(violations);
  });

  it("I4 — retirer une contrainte ne fait jamais monter le total", () => {
    const violations: Violation[] = [];
    for (const deal of POPULATION) {
      for (const c of CONSTRAINTS) {
        if (c.has(deal)) checkNotCheaper(violations, `retrait : ${c.name}`, c.remove(deal), deal);
      }
    }
    expectNone(violations);
  });

  it("I5 — cession totale ≥ licence ≥ rien", () => {
    const violations: Violation[] = [];
    for (const deal of POPULATION) {
      const none = { ...clone(deal), ip_transfer: "none" as const };
      const license = { ...clone(deal), ip_transfer: "license" as const };
      const full = { ...clone(deal), ip_transfer: "full_assignment" as const };
      checkNotCheaper(violations, "rien → licence", none, license);
      checkNotCheaper(violations, "licence → cession totale", license, full);
    }
    expectNone(violations);
  });

  it("I6 — ajouter un livrable ne fait jamais baisser le total", () => {
    const violations: Violation[] = [];
    const deals = [...POPULATION, withUnits(PLAIN, 8)];
    for (const deal of deals) {
      const [first] = deal.deliverables;
      if (first) {
        const more = clone(deal);
        // Population générée avec des nombres ; une quantité non précisée vaut un contenu.
        const count = first.quantity ?? 1;
        more.deliverables[0] = { ...first, quantity: count + 1 };
        checkNotCheaper(violations, `quantité ${count} → ${count + 1} (${first.type})`, deal, more);
      }
      const platform = deal.deliverables.find((x) => x.platform !== null)?.platform ?? null;
      const story = { ...clone(deal), deliverables: [...deal.deliverables, { type: "story" as const, platform, quantity: 1, format: null }] };
      checkNotCheaper(violations, "une story de plus", deal, story);
    }
    expectNone(violations);
  });

  it("I7 — dégressivité : prix unitaire non croissant, total strictement croissant", () => {
    const violations: Violation[] = [];
    for (let i = 1; i < UNITS.length; i++) {
      const [u1, u2] = [UNITS[i - 1], UNITS[i]];
      if (volumeDiscountFactor(u2) > volumeDiscountFactor(u1)) {
        violations.push({
          label: `facteur ${u1} → ${u2} unités`,
          deal: withUnits(PLAIN, u1),
          other: withUnits(PLAIN, u2),
          totals: `${volumeDiscountFactor(u1)} puis ${volumeDiscountFactor(u2)}`,
        });
      }
    }
    for (const base of [PLAIN, ...POPULATION.slice(0, 60)]) {
      for (let i = 1; i < UNITS.length; i++) {
        const small = withUnits(base, UNITS[i - 1]);
        const large = withUnits(base, UNITS[i]);
        const a = estimate(small);
        const b = estimate(large);
        if (!hasTotals(a) || !hasTotals(b)) continue;
        if (!(b.total_low! > a.total_low!) || !(b.total_high! > a.total_high!)) {
          violations.push({
            label: `${UNITS[i - 1]} → ${UNITS[i]} unités pondérées`,
            deal: small,
            other: large,
            totals: `${a.total_low}–${a.total_high} € puis ${b.total_low}–${b.total_high} €`,
          });
        }
      }
    }
    expectNone(violations);
  });

  it("I8 — bornes ordonnées et borne basse jamais sous la base", () => {
    const violations: Violation[] = [];
    for (const deal of POPULATION) {
      const e = estimate(deal);
      if (!hasTotals(e)) continue;
      // total_low = floor10(round(base_low × (1 + majorations)) + forfaits). Les
      // majorations et forfaits sont positifs : le brut est ≥ base_low, et
      // l'arrondi à la dizaine inférieure retire au plus 9 € d'un entier.
      if (e.total_low! > e.total_high! || e.total_low! < e.base_low! - 9) {
        violations.push({ label: "bornes", deal, other: deal, totals: `base ${e.base_low}–${e.base_high} €, total ${e.total_low}–${e.total_high} €` });
      }
    }
    expectNone(violations);
  });

  it("I9 — le total ne dépasse jamais le plafond de majoration", () => {
    const violations: Violation[] = [];
    for (const deal of POPULATION) {
      const e = estimate(deal);
      if (!hasTotals(e)) continue;
      const flatHigh = e.lines.filter((l) => l.type === "flat").reduce((sum, l) => sum + l.eur_high, 0);
      // round() ajoute au plus 0,5 € et l'arrondi à la dizaine supérieure au plus 9 € : < 10 €.
      const ceiling = e.base_high! * (1 + upliftCap(deal)) + flatHigh + 10;
      if (e.total_high! > ceiling) {
        violations.push({ label: `plafond ${upliftCap(deal)}`, deal, other: deal, totals: `total_high ${e.total_high} € > ${ceiling} €` });
      }
    }
    expectNone(violations);
  });

  it("I10 — le score ne monte jamais quand une contrainte s'ajoute", () => {
    expectNone(scoreViolations(POPULATION));
  });

  // #035 C4 : le plafond de score quand une quantité est inconnue ne doit pas
  // casser I10. Même vérification, sur la même population dont toutes les
  // quantités deviennent inconnues (le générateur n'en produit pas).
  it("I10 — tient aussi quand la quantité des livrables est inconnue (score plafonné)", () => {
    const unknown = POPULATION.map((deal) => ({ ...clone(deal), deliverables: deal.deliverables.map((d) => ({ ...d, quantity: null })) }));
    // La vérification n'a de sens que si le plafond agit vraiment sur une partie de la population.
    const capped = unknown.filter((deal) => {
      const totals = estimate(deal);
      return hasTotals(totals) && uncappedScore(deal, totals).value > computeScore(deal, totals).value;
    });
    expect(capped.length).toBeGreaterThan(0);
    expectNone(scoreViolations(unknown));
  });

  function scoreViolations(population: Deal[]): Violation[] {
    const violations: Violation[] = [];
    const additions: Array<[string, (d: Deal) => boolean, (d: Deal) => Deal]> = [
      ...[...CONSTRAINTS, ...SCORE_ONLY_CONSTRAINTS].map(
        (c) => [c.name, (d: Deal) => !c.has(d), c.add] as [string, (d: Deal) => boolean, (d: Deal) => Deal],
      ),
      ...TERMS.filter((t): t is Exclude<(typeof TERMS)[number], null> => t !== null).map(
        (t) =>
          [
            `délai de paiement allongé à ${t} jours`,
            (d: Deal) => d.payment.terms_days !== null && d.payment.terms_days < t,
            (d: Deal) => ({ ...clone(d), payment: { ...d.payment, terms_days: t } }),
          ] as [string, (d: Deal) => boolean, (d: Deal) => Deal],
      ),
    ];
    for (const deal of population) {
      const before = estimate(deal);
      if (!hasTotals(before)) continue;
      for (const [name, applies, add] of additions) {
        if (!applies(deal)) continue;
        const other = add(deal);
        const after = estimate(other);
        if (!hasTotals(after)) continue;
        const s1 = computeScore(deal, before).value;
        const s2 = computeScore(other, after).value;
        if (s2 > s1) {
          violations.push({ label: name, deal, other, totals: `score ${s1} puis ${s2} (totaux ${before.total_low}–${before.total_high} € puis ${after.total_low}–${after.total_high} €)` });
        }
      }
    }
    return violations;
  }

  it("générateur reproductible et deals valides", () => {
    expect(POPULATION.length).toBeGreaterThan(400);
    expect(JSON.stringify(buildPopulation())).toBe(JSON.stringify(POPULATION));
    for (const deal of POPULATION) expect(analysisSchema.shape.deal.safeParse(deal).success).toBe(true);
  });
});

// Entre niveaux, à deal constant : un niveau plus haut ne fait jamais baisser la
// fourchette, et ne fait jamais monter le score (le même montant est comparé à
// une fourchette plus haute).
describe("I11 — niveau plus élevé, même deal", () => {
  it("fourchette jamais plus basse, score jamais plus haut", () => {
    const violations: Violation[] = [];
    for (const deal of POPULATION) {
      for (let i = 1; i < TIERS.length; i++) {
        const lower = computeEstimate(deal, { tier: TIERS[i - 1] });
        const higher = computeEstimate(deal, { tier: TIERS[i] });
        if (!hasTotals(lower) || !hasTotals(higher)) continue;
        const s1 = computeScore(deal, lower).value;
        const s2 = computeScore(deal, higher).value;
        if (higher.total_low! < lower.total_low! || higher.total_high! < lower.total_high! || s2 > s1) {
          violations.push({
            label: `${TIERS[i - 1]} → ${TIERS[i]}`,
            deal,
            other: deal,
            totals: `${lower.total_low}–${lower.total_high} € (score ${s1}) puis ${higher.total_low}–${higher.total_high} € (score ${s2})`,
          });
        }
      }
    }
    expectNone(violations);
  });
});
