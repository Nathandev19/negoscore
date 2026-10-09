import { describe, expect, it } from "vitest";
import { composeAnalysis } from "@/lib/analysis/compose";
import { baseExtraction, PREVIEW_STATES, previewAnalysis } from "@/lib/fixtures/preview-states";
import { BAND_LABEL } from "@/lib/display";
import { bandFor, comparedAmountOf, priceCapFor } from "@/lib/rates/score";

// Mission #172, point 1 — LA NOTE ET LA BANDE DISENT DEUX CHOSES OPPOSÉES.
//
// Le cas rapporté : 3 vidéos, 400 €, 89 € de produits, droits pub 6 mois,
// quatre zones, exclusivité 3 mois. Fourchette 610 – 1 310 €.
// La page affiche la bande « Faible » À CÔTÉ de la note 58/100 — et 58 est
// dans la tranche que l'échelle elle-même appelle « correct ».
//
// La note se lit en premier. Deux lectures opposées sur la même ligne.

function casRapporte() {
  const base = baseExtraction();
  return {
    ...base,
    deal: {
      ...base.deal,
      brand: null,
      deliverables: [{ type: "video" as const, platform: "tiktok" as const, quantity: 3, format: "30 s, 2 hooks" }],
      usage: {
        ...base.deal.usage,
        organic: true,
        paid_ads: true,
        perpetual: false,
        duration_months: 6,
        territory: "France, Belgique, Suisse et États-Unis",
        territory_zones: ["france", "europe_francophone", "amerique_nord"],
      },
      exclusivity: { present: true, duration_months: 3, category: "skincare" },
      raw_footage: false,
      revisions: { count: 2, unlimited: false },
      payment: { ...base.deal.payment, amount_eur: 400, terms_days: 30 },
      in_kind_value_eur: 89,
    },
  };
}

describe("la note affichée et la bande affichée nomment la même chose", () => {
  it("le cas rapporté est bien reproduit : 610 – 1 310 €, bande « Faible », note 58", () => {
    const { estimate, score } = composeAnalysis(casRapporte() as never, { tier: "starter" });
    expect(estimate.total_low).toBe(610);
    expect(estimate.total_high).toBe(1310);
    expect(score?.band).toBe("weak");
    expect(score?.value).toBe(58);
  });

  // ─── LA GARDE DEMANDÉE ──────────────────────────────────────────────────
  //
  // `it.fails` : cette assertion ÉCHOUE sur le code d'aujourd'hui, et c'est
  // le constat. Elle n'est pas désactivée — vitest la lance, et le jour où
  // elle PASSERA, c'est ce fichier qui échouera, en demandant qu'on retire le
  // `.fails`. Un défaut mesuré qui ne peut pas être oublié.
  //
  // Pourquoi elle n'est pas corrigée dans cette mission : aligner le plafond
  // de la #050 sur la règle de bande de la #167 fait bouger HUIT tests, dont
  // l'invariant d'arrondi (un décalage de 9 € sur le plancher déplacerait la
  // note de 8 points, contre 3 au plus aujourd'hui). La mission dit de
  // s'arrêter au-delà de cinq. Le détail est dans le rapport de la #172.
  it.fails("aucune analyse ne porte une note dont la tranche nommée contredit sa bande", () => {
    const { score } = composeAnalysis(casRapporte() as never, { tier: "starter" });
    expect(BAND_LABEL[bandFor(score!.value)]).toBe(BAND_LABEL[score!.band]);
  });

  it("la contradiction tient au plafond de la #050, pas à la bande", () => {
    // La bande vient de la règle de la #167 : sous le plancher, jamais mieux
    // que « faible ». Le plafond, lui, autorise encore 59 — une valeur qui
    // est DANS la tranche « correct ».
    const { deal, estimate, score } = composeAnalysis(casRapporte() as never, { tier: "starter" });
    const plafond = priceCapFor(deal.payment.amount_eur, estimate.total_low, estimate.total_high);
    expect(plafond?.reason).toBe("ratio");
    expect(plafond?.cap).toBe(59);
    // 59 est dans « correct », alors que le montant est sous le plancher.
    expect(bandFor(plafond!.cap)).toBe("fair");
    expect(score!.band).toBe("weak");
    // Et le montant comparé est bien sous le plancher.
    expect(comparedAmountOf(deal)).toBe(400);
    expect(estimate.total_low).toBeGreaterThan(400);
  });

  it("aucune fixture de prévisualisation ne porte cette contradiction", () => {
    // Le défaut n'est pas général : il n'apparaît qu'entre 0,60 et 1 fois le
    // plancher. Les six états d'aperçu sont sains, et doivent le rester.
    for (const etat of PREVIEW_STATES) {
      const { analysis } = previewAnalysis(etat);
      if (analysis.score === null) continue;
      expect(BAND_LABEL[bandFor(analysis.score.value)], etat).toBe(BAND_LABEL[analysis.score.band]);
    }
  });
});
