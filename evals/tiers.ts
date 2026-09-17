import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { composeAnalysis } from "@/lib/analysis/compose";
import { isFarAboveOffer } from "@/lib/rates/engine";
import { TIER_LABEL, TIERS, type Tier } from "@/lib/rates/tier";
import type { Analysis } from "@/lib/schema";
import { collectDeals } from "./survey-deals.ts";

// Mission #039 C : les offres chiffrées du relevé #038, aux TROIS niveaux.
// À quel niveau la table cesse-t-elle de dire que tout le monde est sous-payé ?
// AUCUN APPEL AU MODÈLE : deals déjà extraits, recalculés par le moteur actuel.
// Ne change ni la table, ni le seuil d'alarme, ni le niveau par défaut.
//
// node --import ./evals/register-alias.mjs --disable-warning=MODULE_TYPELESS_PACKAGE_JSON evals/tiers.ts

const ROOT = process.cwd();

type Deal = Analysis["deal"];
type Measure = { low: number | null; high: number | null; ratio: number | null; alarm: boolean; score: string; below: boolean };

function measure(deal: Deal, tier: Tier): Measure {
  const analysis = composeAnalysis(
    {
      language: "fr",
      confidence: "medium",
      input_quality: { readable: true, missing_critical: [] },
      deal,
      good_points: [],
      negotiate: [],
      red_flags: [],
      counter_offer: { changes: [] },
      ready_to_send_message: { tone: "cordial", text: "Bonjour." },
    },
    { tier },
  );
  const amount = analysis.deal.payment.amount_eur;
  const { total_low: low, total_high: high } = analysis.estimate;
  return {
    low,
    high,
    ratio: amount && amount > 0 && low !== null ? Math.round((low / amount) * 100) / 100 : null,
    alarm: isFarAboveOffer(amount, low),
    score: analysis.score ? `${analysis.score.value} ${analysis.score.band}` : analysis.evaluability,
    below: amount !== null && low !== null && amount < low,
  };
}

function quantile(sorted: number[], q: number): number {
  const position = (sorted.length - 1) * q;
  const below = Math.floor(position);
  const above = Math.ceil(position);
  return Math.round((sorted[below] + (sorted[above] - sorted[below]) * (position - below)) * 100) / 100;
}

const format = (n: number) => String(n).replace(".", ",");

function main() {
  // Offres chiffrées : un montant et une fourchette au niveau par défaut (21 dans le relevé #038).
  const offers = collectDeals()
    .filter((row) => row.inStats)
    .map((row) => ({ row, byTier: Object.fromEntries(TIERS.map((tier) => [tier, measure(row.deal, tier)])) as Record<Tier, Measure> }))
    .filter(({ byTier }) => byTier.confirmed.ratio !== null);

  const header = ["Offre", "Montant", ...TIERS.flatMap((tier) => [`${tier} : bas – haut`, "bas/montant", "alarme", "score"])];
  const lines = [`| ${header.join(" | ")} |`, `|${header.map(() => "---").join("|")}|`];
  for (const { row, byTier } of offers) {
    const amount = row.deal.payment.amount_eur;
    const cells = TIERS.flatMap((tier) => {
      const m = byTier[tier];
      return [`${m.low} – ${m.high}`, m.ratio === null ? "—" : format(m.ratio), m.alarm ? "**OUI**" : "non", m.score];
    });
    lines.push(`| ${row.offer} | ${amount} | ${cells.join(" | ")} |`);
  }

  const statsHeader = `| | ${TIERS.map((tier) => `${tier} (« ${TIER_LABEL[tier].title} »)`).join(" | ")} |`;
  const stat = (label: string, value: (tier: Tier) => string) => `| ${label} | ${TIERS.map(value).join(" | ")} |`;
  const ratios = (tier: Tier) => offers.map((o) => o.byTier[tier].ratio as number).sort((a, b) => a - b);
  const count = (tier: Tier, test: (m: Measure) => boolean) => offers.filter((o) => test(o.byTier[tier])).length;
  const stats = [
    statsHeader,
    `|---|${TIERS.map(() => "---").join("|")}|`,
    stat("Offres chiffrées", () => String(offers.length)),
    stat("Montant SOUS la borne basse", (t) => `${count(t, (m) => m.below)} / ${offers.length}`),
    stat("Montant dans la fourchette ou au-dessus", (t) => `${count(t, (m) => !m.below)} / ${offers.length}`),
    stat("Alarme (bas > 3 × montant)", (t) => `${count(t, (m) => m.alarm)} / ${offers.length}`),
    stat("Rapport bas / montant, 1er quartile", (t) => format(quantile(ratios(t), 0.25))),
    stat("Médiane", (t) => format(quantile(ratios(t), 0.5))),
    stat("3e quartile", (t) => format(quantile(ratios(t), 0.75))),
    stat("Rapport ≤ 1 (montant ≥ bas)", (t) => `${ratios(t).filter((r) => r <= 1).length} / ${offers.length}`),
    stat("Scores good ou excellent", (t) => `${count(t, (m) => /good|excellent/.test(m.score))} / ${count(t, (m) => /^\d/.test(m.score))} notées`),
    stat("Scores bad ou weak", (t) => `${count(t, (m) => /bad|weak/.test(m.score))} / ${count(t, (m) => /^\d/.test(m.score))} notées`),
  ];

  const report = [
    "# Relevé aux trois niveaux (mission #039 C)",
    "",
    "Offres chiffrées du relevé #038 (montant et fourchette), recalculées par le moteur actuel (fr-2026.2) à chaque niveau. Aucun appel au modèle. Fixtures synthétiques, pas des offres réelles.",
    "",
    lines.join("\n"),
    "",
    "## Statistiques",
    "",
    stats.join("\n"),
  ].join("\n");

  mkdirSync(path.join(ROOT, "evals/results"), { recursive: true });
  const file = path.join(ROOT, "evals/results/tiers-2026-09-17.md");
  writeFileSync(file, `${report}\n`);
  console.log(report);
  console.log(`\nRésultats : ${path.relative(ROOT, file)}`);
}

main();
