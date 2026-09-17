import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { composeAnalysis } from "@/lib/analysis/compose";
import { lockAnalysis } from "@/lib/analysis/lock";
import { recomputeForTier, tierChangeAvailable } from "@/lib/analysis/recompute";
import sampleExtraction from "@/lib/fixtures/sample-extraction.json";
import { extractionSchema, type Extraction } from "@/lib/llm/prompt";
import { formatEur } from "@/lib/money";
import { LEGACY_ENGINE_ASSUMPTIONS, PLAUSIBILITY_ASSUMPTION, UPLIFT_CAPPED_ASSUMPTION } from "@/lib/rates/engine";
import rates from "@/lib/rates/fr-2026.3.json";
import { DEFAULT_TIER, TIER_LABEL, TIERS, type Tier } from "@/lib/rates/tier";
import { analysisSchema } from "@/lib/schema";
import { withTier } from "@/lib/share-card/tier-param";

// Mission #039 : le niveau de la créatrice est un choix, recalculé dans le
// navigateur. Le recalcul doit donner EXACTEMENT ce qu'une analyse lancée à ce
// niveau aurait donné, sans appel au modèle ni au serveur.

const ROOT = process.cwd();

// Sorties du modèle de production enregistrées (éval du 15/09/2026), plus les
// variantes de l'exemple public : sans montant, au-dessus, conditions inconnues.
function extractions(): Array<{ name: string; extraction: Extraction }> {
  const out: Array<{ name: string; extraction: Extraction }> = [];
  const run = JSON.parse(readFileSync(path.join(ROOT, "evals/results/2026-09-15T07-45-12-414Z.json"), "utf8")) as {
    reports: Array<{ id: string; runs: Array<{ fixture: string; rawOutput: string }> }>;
  };
  for (const record of run.reports.find((r) => r.id === "openai/gpt-5.6-luna")?.runs ?? []) {
    const parsed = extractionSchema.safeParse(JSON.parse(record.rawOutput));
    if (parsed.success) out.push({ name: record.fixture, extraction: parsed.data });
  }
  const base = extractionSchema.parse(structuredClone(sampleExtraction));
  const amount = (value: number | null): Extraction => ({ ...base, deal: { ...base.deal, payment: { ...base.deal.payment, amount_eur: value } } });
  out.push({ name: "exemple", extraction: base }, { name: "exemple sans montant", extraction: amount(null) }, { name: "exemple 4 000 €", extraction: amount(4000) });
  out.push({
    name: "exemple conditions inconnues",
    extraction: {
      ...base,
      deal: {
        ...base.deal,
        usage: { ...base.deal.usage, duration_months: null, territory: null },
        ip_transfer: "unclear",
        revisions: { count: null, unlimited: false },
        payment: { ...base.deal.payment, terms_days: null },
      },
    },
  });
  return out;
}

const CORPUS = extractions();

// La confiance n'est pas recalculée (lib/analysis/recompute.ts) : comparée à part.
function withoutConfidence(analysis: object) {
  return { ...analysis, confidence: undefined };
}

describe("niveau : un choix, pas une hypothèse", () => {
  it("même liste de niveaux dans le schéma et dans le module des niveaux ; défaut « starter » depuis fr-2026.3 (#040)", () => {
    expect(analysisSchema.shape.profile_tier.unwrap().options).toEqual([...TIERS]);
    expect(DEFAULT_TIER).toBe("starter");
    expect(rates.version).toBe("fr-2026.3");
    expect(Object.keys(rates.base_rates_eur).filter((key) => key !== "default_tier")).toEqual([...TIERS]);
  });

  it("A5 — aucune hypothèse ne parle du profil supposé, à aucun niveau", () => {
    for (const { name, extraction } of CORPUS) {
      for (const tier of TIERS) {
        const assumptions = composeAnalysis(extraction, { tier }).estimate.assumptions.join(" ");
        expect(assumptions, `${name} ${tier}`).not.toMatch(/profil|confirmé|débutant/i);
      }
    }
  });

  it("A3 — libellés concrets, sans nombre d'abonnés", () => {
    for (const tier of TIERS) {
      const text = Object.values(TIER_LABEL[tier]).join(" ");
      expect(text).not.toMatch(/abonn|follower|\d/i);
    }
  });

  it("une analyse enregistrée garde son niveau ; une analyse d'avant 1.4 est relue au niveau confirmé", () => {
    const base = extractionSchema.parse(structuredClone(sampleExtraction));
    expect(composeAnalysis(base, { tier: "starter" }).profile_tier).toBe("starter");
    const { profile_tier: _dropped, ...legacy } = composeAnalysis(base);
    void _dropped;
    expect(analysisSchema.parse(legacy).profile_tier).toBe("confirmed");
  });

  it("le niveau change la fourchette dans l'ordre attendu, deal par deal", () => {
    for (const { name, extraction } of CORPUS) {
      const [starter, confirmed, experienced] = TIERS.map((tier) => composeAnalysis(extraction, { tier }).estimate);
      if (starter.total_low === null) continue;
      expect(starter.total_low, name).toBeLessThan(confirmed.total_low!);
      expect(confirmed.total_low, name).toBeLessThan(experienced.total_low!);
      expect(starter.total_high, name).toBeLessThan(confirmed.total_high!);
      expect(confirmed.total_high, name).toBeLessThan(experienced.total_high!);
    }
  });
});

describe("A2 — recalcul côté navigateur identique à une analyse lancée à ce niveau", () => {
  it("pour chaque offre et chaque paire de niveaux : fourchette, détail, hypothèses, score, négociation, contre-offre, message", () => {
    let compared = 0;
    for (const { name, extraction } of CORPUS) {
      for (const from of TIERS) {
        for (const to of TIERS) {
          const stored = composeAnalysis(extraction, { tier: from, extraAssumptions: ["Ton texte dépassait 60 000 caractères : seul le début a été analysé."] });
          const expected = composeAnalysis(extraction, { tier: to, extraAssumptions: ["Ton texte dépassait 60 000 caractères : seul le début a été analysé."] });
          if (stored.evaluability === "incomplete") {
            expect(recomputeForTier(stored, to), name).toBe(stored);
            continue;
          }
          expect(withoutConfidence(recomputeForTier(stored, to)), `${name} ${from} → ${to}`).toEqual(withoutConfidence(expected));
          expect(withoutConfidence(recomputeForTier(lockAnalysis(stored), to)), `${name} verrouillée`).toEqual(withoutConfidence(lockAnalysis(expected)));
          compared += 1;
        }
      }
    }
    expect(compared).toBeGreaterThan(150);
  });

  it("le prix du message suit la contre-offre du niveau choisi", () => {
    const base = extractionSchema.parse(structuredClone(sampleExtraction));
    const stored = composeAnalysis(base);
    // Exemple au niveau par défaut (starter) ; recalcul au niveau confirmé.
    const other = recomputeForTier(stored, "confirmed");
    expect(other.counter_offer.amount_low).not.toBe(stored.counter_offer.amount_low);
    expect(other.ready_to_send_message.text).toContain(
      `entre ${formatEur(other.counter_offer.amount_low!)} et ${formatEur(other.counter_offer.amount_high!)}`,
    );
    expect(other.ready_to_send_message.text).not.toBe(stored.ready_to_send_message.text);
    expect(other.ready_to_send_message.text).not.toContain("{{");
  });

  it("analyse d'avant la version 1.4 (sans sujet de négociation, anciens textes) : même résultat", () => {
    for (const { name, extraction } of CORPUS) {
      // Une analyse d'avant 1.4 a toujours été calculée au niveau confirmé.
      const current = composeAnalysis(extraction, { tier: "confirmed" });
      if (current.evaluability === "incomplete") continue;
      const legacyText = (a: string) =>
        a === PLAUSIBILITY_ASSUMPTION ? LEGACY_ENGINE_ASSUMPTIONS[2] : a === UPLIFT_CAPPED_ASSUMPTION ? LEGACY_ENGINE_ASSUMPTIONS[1] : a;
      // L'ancienne hypothèse de profil venait en tête des hypothèses du moteur,
      // après celle de l'état (sans montant, conditions inconnues).
      const assumptions = current.estimate.assumptions.map(legacyText);
      assumptions.splice(current.evaluability === "complete" ? 0 : 1, 0, LEGACY_ENGINE_ASSUMPTIONS[0]);
      const stored = analysisSchema.parse({
        ...current,
        schema_version: "1.3",
        profile_tier: undefined,
        negotiate: current.negotiate.map((item) => ({ ...item, topic: undefined })),
        // Enregistrée avec la table d'alors : mêmes tarifs, défaut confirmé.
        estimate: { ...current.estimate, assumptions, rate_table_version: "fr-2026.2" },
      });
      expect(stored.profile_tier).toBe("confirmed");
      expect(tierChangeAvailable(stored)).toBe(true);
      const expected = composeAnalysis(extraction, { tier: "starter" });
      const recomputed = recomputeForTier(stored, "starter");
      expect(recomputed.estimate, name).toEqual(expected.estimate);
      expect(recomputed.score, name).toEqual(expected.score);
      expect(recomputed.counter_offer, name).toEqual(expected.counter_offer);
      expect(recomputed.ready_to_send_message, name).toEqual(expected.ready_to_send_message);
      expect(
        recomputed.negotiate.map((item) => [item.label, item.eur_impact_low, item.eur_impact_high]),
        name,
      ).toEqual(expected.negotiate.map((item) => [item.label, item.eur_impact_low, item.eur_impact_high]));
    }
  });

  it("analyse calculée avec une ancienne table, ou sans fourchette : le niveau ne change rien", () => {
    const base = extractionSchema.parse(structuredClone(sampleExtraction));
    const old = { ...composeAnalysis(base), estimate: { ...composeAnalysis(base).estimate, rate_table_version: "fr-2026.1" } };
    expect(tierChangeAvailable(old)).toBe(false);
    expect(recomputeForTier(old, "starter")).toBe(old);
    const incomplete = composeAnalysis({ ...base, deal: { ...base.deal, deliverables: [] } });
    expect(tierChangeAvailable(incomplete)).toBe(false);
  });
});

// Graphe d'imports du composant de résultat, résolu depuis le disque.
function importGraph(entry: string): Set<string> {
  const seen = new Set<string>();
  const external = new Set<string>();
  const stack = [path.join(ROOT, entry)];
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    if (file.endsWith(".json")) continue;
    const source = readFileSync(file, "utf8");
    for (const [, specifier] of source.matchAll(/(?:from|import)\s+["']([^"']+)["']/g)) {
      if (!specifier.startsWith("@/") && !specifier.startsWith(".")) {
        external.add(specifier);
        continue;
      }
      const base = specifier.startsWith("@/") ? path.join(ROOT, specifier.slice(2)) : path.resolve(path.dirname(file), specifier);
      const resolved = [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")].find((candidate) => existsSync(candidate) && !candidate.endsWith(path.sep) && /\.(tsx?|json)$/.test(candidate));
      if (resolved) stack.push(resolved);
    }
  }
  for (const name of external) seen.add(`externe:${name}`);
  return seen;
}

describe("A2 — changer de niveau n'appelle ni le modèle ni le serveur", () => {
  const graph = [...importGraph("components/result/analysis-result.tsx")].map((file) => file.replace(ROOT, "").replaceAll("\\", "/"));

  it("le composant de résultat n'importe ni le modèle, ni la base, ni la facturation", () => {
    for (const forbidden of ["/lib/llm/extract", "/lib/llm/prompt", "/lib/supabase", "/lib/billing", "/lib/auth", "externe:openai", "externe:node:"]) {
      expect(graph.filter((file) => file.includes(forbidden)), forbidden).toEqual([]);
    }
    expect(graph).toContain("/lib/analysis/recompute.ts");
    expect(graph).toContain("/lib/rates/engine.ts");
  });

  it("la seule requête réseau du composant est l'enregistrement du choix sur le compte, qui n'est pas attendu", () => {
    const fetches = graph
      .filter((file) => !file.startsWith("externe:") && !file.endsWith(".json"))
      .flatMap((file) => [...readFileSync(path.join(ROOT, file), "utf8").matchAll(/fetch\(\s*["'`]([^"'`]+)/g)].map((m) => `${file} ${m[1]}`));
    expect(fetches).toEqual(["/components/result/tier-selector.tsx /api/niveau"]);
    const selector = readFileSync(path.join(ROOT, "components/result/tier-selector.tsx"), "utf8");
    expect(selector).toMatch(/void fetch\("\/api\/niveau"/);
    const result = readFileSync(path.join(ROOT, "components/result/analysis-result.tsx"), "utf8");
    expect(result).not.toMatch(/await/);
  });
});

describe("B2 — la carte porte le niveau affiché", () => {
  it("adresse de la carte : le niveau s'ajoute, avec ou sans paramètres existants", () => {
    const tier: Tier = "experienced";
    expect(withTier("/analyse/resultat/abc/carte", tier)).toBe("/analyse/resultat/abc/carte?niveau=experienced");
    expect(withTier("/dev/carte?etat=debloque", tier)).toBe("/dev/carte?etat=debloque&niveau=experienced");
  });
});
