import { composeAnalysis } from "@/lib/analysis/compose";
import { lockAnalysis, type ResultView } from "@/lib/analysis/lock";
import sampleExtraction from "@/lib/fixtures/sample-extraction.json";
import { extractionSchema, type Extraction } from "@/lib/llm/prompt";

// États de la page de résultat pour la prévisualisation de développement
// (app/dev/resultat) et pour les tests. Chaque analyse passe par le vrai
// moteur (composeAnalysis) : fourchette, score, évaluabilité et phrase de
// verdict sont ceux que verrait un utilisateur. Aucun appel au modèle.

export const PREVIEW_STATES = [
  "verrouille",
  "debloque",
  "complete",
  "au-dessus",
  "unpriced",
  "incomplete",
  "terms_unknown",
  "quantite-inconnue",
  "prix-plafonne",
  "commission",
] as const;
export type PreviewState = (typeof PREVIEW_STATES)[number];

// L'extraction de l'exemple public, passée par le vrai moteur.
export function baseExtraction(): Extraction {
  return extractionSchema.parse(structuredClone(sampleExtraction));
}

function withAmount(extraction: Extraction, amount: number | null): Extraction {
  return { ...extraction, deal: { ...extraction.deal, payment: { ...extraction.deal.payment, amount_eur: amount } } };
}

export function previewAnalysis(state: PreviewState): { analysis: ResultView; unlocked: boolean } {
  const base = baseExtraction();
  const reference = composeAnalysis(base);
  const { total_low: low, total_high: high } = reference.estimate;

  switch (state) {
    case "verrouille":
      return { analysis: lockAnalysis(reference), unlocked: false };
    case "debloque":
      return { analysis: reference, unlocked: true };
    case "complete": {
      // Montant au milieu de la fourchette calculée : « dans les prix ».
      const middle = low !== null && high !== null ? Math.round((low + high) / 2) : 800;
      return { analysis: composeAnalysis(withAmount(base, middle)), unlocked: true };
    }
    case "au-dessus":
      return { analysis: composeAnalysis(withAmount(base, (high ?? 1000) + 300)), unlocked: true };
    case "unpriced":
      return { analysis: composeAnalysis(withAmount(base, null)), unlocked: true };
    case "incomplete":
      return {
        analysis: composeAnalysis({ ...base, deal: { ...base.deal, deliverables: [] } }),
        unlocked: true,
      };
    case "quantite-inconnue":
      // Bonne offre dont la marque ne dit pas combien de vidéos elle veut : score
      // plafonné à « Deal correct », raison affichée près du score.
      return {
        analysis: composeAnalysis({
          ...base,
          deal: {
            ...base.deal,
            deliverables: [{ type: "video", platform: "tiktok", quantity: null, format: null }],
            usage: { ...base.deal.usage, paid_ads: false, duration_months: 6, territory: "France" },
            exclusivity: { present: false, duration_months: null, category: null },
            raw_footage: false,
            revisions: { count: 2, unlimited: false },
            payment: { ...base.deal.payment, amount_eur: 900, terms_days: 30 },
          },
        }),
        unlocked: true,
      };
    case "commission": {
      // Mission #116 — l'offre réelle du 24/09 : 2 vidéos TikTok, 15 % sur les
      // ventes via un code promo, aucun fixe, droits pub 6 mois. Elle sert à
      // voir de ses yeux les cinq points à obtenir et la ligne « Commission »,
      // sans lancer d'analyse payante.
      return {
        analysis: composeAnalysis({
          ...base,
          deal: {
            ...base.deal,
            deliverables: [{ type: "video", platform: "tiktok", quantity: 2, format: null }],
            usage: { ...base.deal.usage, paid_ads: true, duration_months: 6, territory: null },
            exclusivity: { present: false, duration_months: null, category: null },
            raw_footage: false,
            revisions: { count: 2, unlimited: false },
            payment: { ...base.deal.payment, amount_eur: null, terms_days: null },
            in_kind_value_eur: null,
            variable_pay: { present: true, rate_percent: 15, base: null, per_sale_eur: null, attribution_days: null, payout: null },
          },
          red_flags: [
            { label: "Aucune rémunération fixe", severity: "high", why: "Tu n'as aucune garantie de paiement si les ventes générées sont faibles." },
          ],
        }),
        unlocked: true,
      };
    }
    case "prix-plafonne": {
      // Mission #050 : offre correcte sur tout le reste (droits limités, délai
      // court, pas d'exclusivité), mais payée un peu plus de la moitié du bas
      // de la fourchette. Le score est plafonné par le prix, et la raison est
      // affichée près du score.
      const clean = {
        ...base,
        deal: {
          ...base.deal,
          usage: { ...base.deal.usage, paid_ads: false, duration_months: 6, territory: "France" },
          exclusivity: { present: false, duration_months: null, category: null },
          raw_footage: false,
          revisions: { count: 2, unlimited: false },
          payment: { ...base.deal.payment, terms_days: 30 },
        },
      };
      const floor = composeAnalysis(clean).estimate.total_low;
      return { analysis: composeAnalysis(withAmount(clean, Math.round((floor ?? 500) * 0.56))), unlocked: true };
    }
    case "terms_unknown":
      return {
        analysis: composeAnalysis({
          ...base,
          deal: {
            ...base.deal,
            usage: { ...base.deal.usage, duration_months: null, territory: null, perpetual: false },
            exclusivity: { present: false, duration_months: null, category: null },
            ip_transfer: "unclear",
            revisions: { count: null, unlimited: false },
            payment: { ...base.deal.payment, terms_days: null },
          },
        }),
        unlocked: true,
      };
  }
}
