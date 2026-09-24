import { describe, expect, it } from "vitest";
import sample from "@/lib/fixtures/sample-extraction.json";
import { shortPathTarget, SHORT_PATHS } from "@/lib/acquisition/chemins";
import { verdictForm, verdictSentence } from "@/lib/analysis/verdict";
import { furthestPeriodEnd } from "@/lib/billing/plan-access";
import { entryFor } from "@/lib/lookup";
import { computeEstimate } from "@/lib/rates/engine";
import { computeScore, scoreHonoursPriceCap } from "@/lib/rates/score";
import { analysisSchema, type Analysis } from "@/lib/schema";

// Mission #113 — les points retenus de l'audit #110, corrigés.

type Deal = Analysis["deal"];
const BASE = analysisSchema.shape.deal.parse((sample as { deal: unknown }).deal);
const NEUTRAL = {
  usage: { organic: true, paid_ads: false, whitelisting: false, spark_ads: false, perpetual: false, duration_months: null, territory: null },
  exclusivity: { present: false, duration_months: null, category: null },
  raw_footage: false,
  ip_transfer: "none" as const,
  ai_training_rights: "absent" as const,
  revisions: { count: 2, unlimited: false },
};
const deal = (patch: Partial<Deal>): Deal => ({ ...BASE, ...NEUTRAL, ...patch });
const video = (quantity: number) => ({ type: "video" as const, platform: "tiktok" as const, quantity, format: null });
const lines = (subject: Deal) => computeEstimate(subject, { tier: "starter" }).lines.map((line) => line.label);
const total = (subject: Deal): [number | null, number | null] => {
  const estimate = computeEstimate(subject, { tier: "starter" });
  return [estimate.total_low, estimate.total_high];
};

// ─── A — droits pub à vie : pas de ligne organique en plus ───────────────────

describe("A — la republication est comprise dans des droits pub perpétuels", () => {
  const usage = (over: Partial<Deal["usage"]>): Deal =>
    deal({ deliverables: [video(2)], usage: { ...NEUTRAL.usage, ...over } });

  it("droits pub à vie + republication à vie : UNE seule ligne", () => {
    const subject = usage({ organic: true, paid_ads: true, perpetual: true });
    expect(lines(subject)).toEqual(["Droits pub à vie"]);
    expect(lines(subject).filter((label) => label.startsWith("Republication"))).toEqual([]);
  });

  it("droits pub limités dans le temps + republication longue : DEUX lignes", () => {
    // Le schéma ne porte qu'un seul drapeau « perpetual » pour tout l'usage :
    // « pub 12 mois ET republication à vie » n'y est pas représentable. Le cas
    // équivalent, et représentable, est une durée d'usage au-delà d'un an.
    const subject = usage({ organic: true, paid_ads: true, perpetual: false, duration_months: 24 });
    expect(lines(subject)).toEqual(["Droits pub 24 mois", "Republication 24 mois"]);
  });

  it("republication seule à vie, sans droits pub : UNE ligne, celle de la republication", () => {
    const subject = usage({ organic: true, paid_ads: false, perpetual: true });
    expect(lines(subject)).toEqual(["Republication à vie"]);
  });

  it("le prix d'une offre pub à vie ne bouge pas quand l'organique est coché", () => {
    const avec = usage({ organic: true, paid_ads: true, perpetual: true });
    const sans = usage({ organic: false, paid_ads: true, perpetual: true });
    expect(total(avec)).toEqual(total(sans));
  });
});

// ─── B — une analyse enregistrée ne se contredit plus ───────────────────────

describe("B — le badge et la phrase, sur une analyse enregistrée", () => {
  // Analyse « d'avant la mission #109 » : le montant est au tiers bas, et le
  // score enregistré vaut 81, ce que le plafond d'aujourd'hui n'autoriserait
  // plus. C'est le cas NOVA du dépôt (600 € dans 460 – 1 090 €).
  const stored = (value: number, band: NonNullable<Analysis["score"]>["band"]) => {
    const subject = deal({
      deliverables: [video(1)],
      usage: { ...NEUTRAL.usage, paid_ads: true, duration_months: 12 },
      payment: { ...BASE.payment, amount_eur: 250, currency: "EUR", terms_days: null, schedule: null },
    });
    const estimate = computeEstimate(subject, { tier: "starter" });
    return { evaluability: "complete" as const, deal: subject, estimate, score: { value, band } };
  };

  it("score 81 enregistré, montant au tiers bas : la phrase ne dit plus « tout en bas »", () => {
    const analysis = stored(81, "good");
    expect(analysis.estimate.total_low).toBe(180);
    expect(scoreHonoursPriceCap(analysis.deal, analysis.estimate, analysis.score)).toBe(false);
    expect(verdictForm(analysis)).toBe("complete_within_middle");
    const phrase = verdictSentence(analysis);
    expect(phrase).toContain("C'est dans les prix.");
    expect(phrase).not.toContain("tout en bas");
  });

  it("analyse enregistrée APRÈS #109 : comportement inchangé, la position est dite", () => {
    const analysis = stored(69, "fair");
    expect(scoreHonoursPriceCap(analysis.deal, analysis.estimate, analysis.score)).toBe(true);
    expect(verdictForm(analysis)).toBe("complete_within_bottom");
    expect(verdictSentence(analysis)).toContain("tout en bas de la fourchette");
  });

  it("une analyse recalculée à l'ouverture reste d'accord avec elle-même", () => {
    // Aperçu, démo, changement de niveau : tout est recalculé, le score respecte
    // donc toujours le plafond, et rien ne change pour eux.
    const analysis = stored(0, "bad");
    const recalcule = { ...analysis, score: computeScore(analysis.deal, analysis.estimate) };
    expect(recalcule.score).toEqual({ value: 69, band: "fair" });
    expect(scoreHonoursPriceCap(recalcule.deal, recalcule.estimate, recalcule.score)).toBe(true);
    expect(verdictForm(recalcule)).toBe("complete_within_bottom");
  });

  it("aucun chiffre enregistré n'est retouché : c'est le texte qui s'aligne", () => {
    const analysis = stored(81, "good");
    verdictSentence(analysis);
    expect(analysis.score).toEqual({ value: 81, band: "good" });
  });
});

// ─── C — les recherches dans un objet ───────────────────────────────────────

describe("C — une clé hostile se comporte comme une clé inconnue", () => {
  const HOSTILE = ["__proto__", "constructor", "prototype", "toString", "hasOwnProperty", "valueOf"];

  it("entryFor ne répond que pour les clés vraiment présentes", () => {
    const table = { connu: "valeur" };
    expect(entryFor(table, "connu")).toBe("valeur");
    expect(entryFor(table, "inconnu")).toBeUndefined();
    for (const key of HOSTILE) expect(entryFor(table, key), key).toBeUndefined();
  });

  it("chemins courts : /constructor et /__proto__ ne redirigent plus", () => {
    for (const key of HOSTILE) {
      expect(shortPathTarget(`/${key}`), key).toBeNull();
      expect(shortPathTarget(`/${key.toUpperCase()}`), key).toBeNull();
    }
    expect(shortPathTarget("/inconnu")).toBeNull();
  });

  it("chemins courts : les six chemins légitimes sont inchangés", () => {
    for (const [path, content] of Object.entries(SHORT_PATHS)) {
      const target = shortPathTarget(`/${path}`);
      expect(target, path).toContain(`utm_content=${content}`);
      expect(target, path).toContain("utm_source=tiktok");
      // Tolérance de casse et de barre oblique, comme avant.
      expect(shortPathTarget(`/${path.toUpperCase()}/`), path).toBe(target);
    }
  });
});

// ─── E — la résiliation ne raccourcit pas une période payée ─────────────────

describe("E — la fin d'accès la plus lointaine des deux", () => {
  const PROCHE = "2026-10-24T10:00:00.000Z";
  const LOINTAIN = "2026-11-24T10:00:00.000Z";

  it("période empilée plus lointaine que l'abonnement : elle est gardée", () => {
    expect(furthestPeriodEnd(PROCHE, LOINTAIN)).toBe(LOINTAIN);
    expect(furthestPeriodEnd(LOINTAIN, PROCHE)).toBe(LOINTAIN);
  });

  it("cas normal, une seule période : la date de l'abonnement", () => {
    expect(furthestPeriodEnd(PROCHE, PROCHE)).toBe(PROCHE);
    expect(furthestPeriodEnd(PROCHE, null)).toBe(PROCHE);
    expect(furthestPeriodEnd(null, PROCHE)).toBe(PROCHE);
  });

  it("aucune date, ou des dates illisibles : rien plutôt qu'une date inventée", () => {
    expect(furthestPeriodEnd(null, null)).toBeNull();
    expect(furthestPeriodEnd(undefined, "")).toBeNull();
    expect(furthestPeriodEnd("pas une date", null)).toBeNull();
    // Une date illisible n'écrase jamais une date valable.
    expect(furthestPeriodEnd("pas une date", PROCHE)).toBe(PROCHE);
  });
});
