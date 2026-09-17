import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TermsUnknownCard } from "@/components/result/verdict-card";
import { evaluability, priceKnown } from "@/lib/analysis/evaluability";
import { normalizeDeal } from "@/lib/analysis/normalize";
import { verdictForm, verdictSentence } from "@/lib/analysis/verdict";
import { dealRecapRows } from "@/lib/display";
import { computeFrLegal } from "@/lib/legal/fr";
import { computeEstimate, countFilledFields } from "@/lib/rates/engine";
import { appliedPriceCap, computeScore, priceRatio } from "@/lib/rates/score";
import { shareCardTexts } from "@/lib/share-card/element";
import type { Analysis } from "@/lib/schema";

// Mission #057 — deux corrections :
//   A. le seuil légal des 1 000 € se compte « avantages en nature inclus »,
//      il doit donc s'évaluer même sans argent ;
//   B. un 0 n'est pas une valeur : ni en euros, ni en produits.

type Deal = Analysis["deal"];

function deal(part: Partial<Deal> = {}): Deal {
  return normalizeDeal({
    brand: "Marque",
    deliverables: [{ type: "video", platform: "tiktok", quantity: 2, format: null }],
    publication_required: true,
    usage: { organic: true, paid_ads: true, whitelisting: false, spark_ads: false, perpetual: false, duration_months: 6, territory: "France" },
    exclusivity: { present: false, duration_months: null, category: null },
    raw_footage: false,
    ip_transfer: "license",
    ai_training_rights: "absent",
    revisions: { count: 2, unlimited: false },
    payment: { amount_eur: null, currency: "EUR", terms_days: 30, schedule: null },
    in_kind_value_eur: null,
    deadlines: [],
    kill_fee: null,
    termination: null,
    governing_law: null,
    ...part,
  } as Deal);
}

const paiement = (amount_eur: number | null): Deal["payment"] => ({ amount_eur, currency: "EUR", terms_days: 30, schedule: null });

// Analyse minimale pour les composants d'affichage.
function analysis(part: Partial<Deal>): Analysis {
  const d = deal(part);
  const estimate = computeEstimate(d);
  const state = evaluability(d);
  return {
    schema_version: "1.4",
    language: "fr",
    confidence: "medium",
    input_quality: { readable: true, missing_critical: [] },
    deal: d,
    evaluability: state,
    profile_tier: "starter",
    estimate,
    score: state === "complete" ? computeScore(d, estimate) : null,
    good_points: [],
    negotiate: [],
    red_flags: [],
    fr_legal: computeFrLegal(d),
    escalate_to_professional: { needed: false, reasons: [] },
    counter_offer: { amount_low: null, amount_high: null, changes: [] },
    ready_to_send_message: { text: "", tone: "neutral" },
  } as unknown as Analysis;
}

describe("A — seuil légal des 1 000 €, avantages en nature inclus", () => {
  it("produits seuls au-dessus du seuil : le seuil est atteint", () => {
    const legal = computeFrLegal(deal({ payment: paiement(null), in_kind_value_eur: 1500 }));
    expect(legal.threshold_1000_reached).toBe("yes");
    expect(legal.written_contract_required).toBe(true);
    expect(legal.note).toContain("Le montant de cette offre atteint ce seuil");
  });

  it("produits seuls sous le seuil : le seuil n'est pas atteint", () => {
    const legal = computeFrLegal(deal({ payment: paiement(null), in_kind_value_eur: 89 }));
    expect(legal.threshold_1000_reached).toBe("no");
    expect(legal.written_contract_required).toBe(false);
    expect(legal.note).toContain("reste sous ce seuil");
  });

  it("argent seul : comportement inchangé", () => {
    expect(computeFrLegal(deal({ payment: paiement(1200) })).threshold_1000_reached).toBe("yes");
    expect(computeFrLegal(deal({ payment: paiement(800) })).threshold_1000_reached).toBe("no");
  });

  it("argent et produits : les deux s'additionnent", () => {
    expect(computeFrLegal(deal({ payment: paiement(800), in_kind_value_eur: 250 })).threshold_1000_reached).toBe("yes");
    // Chacun pris seul reste sous le seuil : c'est bien la somme qui compte.
    expect(computeFrLegal(deal({ payment: paiement(800) })).threshold_1000_reached).toBe("no");
    expect(computeFrLegal(deal({ payment: paiement(null), in_kind_value_eur: 250 })).threshold_1000_reached).toBe("no");
  });

  it("les deux inconnus : le seuil reste inconnu", () => {
    const legal = computeFrLegal(deal({ payment: paiement(null), in_kind_value_eur: null }));
    expect(legal.threshold_1000_reached).toBe("unknown");
    expect(legal.written_contract_required).toBe(false);
    expect(legal.note).toContain("Le montant n'est pas connu");
  });

  it("le texte affiché n'a pas changé : les avantages en nature y sont toujours annoncés", () => {
    expect(computeFrLegal(deal({ payment: paiement(1200) })).note).toContain("avantages en nature inclus");
  });
});

describe("B — un 0 vaut une absence, partout où le champ est lu", () => {
  const zeroProduits: Partial<Deal> = { payment: paiement(null), in_kind_value_eur: 0 };
  const zeroArgent: Partial<Deal> = { payment: paiement(0), in_kind_value_eur: null };

  it("normalisation : les deux champs à 0 deviennent null, une vraie valeur est gardée", () => {
    expect(deal(zeroProduits).in_kind_value_eur).toBeNull();
    expect(deal(zeroArgent).payment.amount_eur).toBeNull();
    expect(deal({ in_kind_value_eur: 89 }).in_kind_value_eur).toBe(89);
    expect(deal({ payment: paiement(300) }).payment.amount_eur).toBe(300);
  });

  it("évaluabilité : une offre à 0 n'est pas chiffrée", () => {
    expect(priceKnown(deal(zeroProduits))).toBe(false);
    expect(priceKnown(deal(zeroArgent))).toBe(false);
    expect(evaluability(deal(zeroProduits))).toBe("unpriced");
    expect(evaluability(deal(zeroArgent))).toBe("unpriced");
    expect(evaluability(deal({ payment: paiement(null), in_kind_value_eur: 89 }))).toBe("complete");
  });

  it("moteur : un 0 ne compte pas comme un champ renseigné", () => {
    expect(countFilledFields(deal(zeroProduits))).toBe(countFilledFields(deal({ payment: paiement(null) })));
    expect(countFilledFields(deal({ in_kind_value_eur: 89 }))).toBe(countFilledFields(deal(zeroProduits)) + 1);
  });

  it("score : un montant à 0 ne donne ni rapport de prix ni plafond", () => {
    const d = deal(zeroArgent);
    const estimate = computeEstimate(d);
    expect(priceRatio(d, estimate)).toBeNull();
    expect(appliedPriceCap(d, estimate)).toBeNull();
    // Sans la correction, r valait 0 et le score était plafonné à 29.
    expect(computeScore(d, estimate).value).toBeGreaterThan(29);
  });

  it("seuil légal : un 0 ne rend pas le seuil calculable", () => {
    expect(computeFrLegal(deal(zeroProduits)).threshold_1000_reached).toBe("unknown");
    expect(computeFrLegal(deal(zeroArgent)).threshold_1000_reached).toBe("unknown");
    expect(computeFrLegal(deal(zeroProduits)).missing_mandatory_clauses).toContain("Valeur des avantages en nature");
  });

  it("phrase de verdict : aucune offre à 0 € n'est annoncée", () => {
    for (const part of [zeroProduits, zeroArgent]) {
      const a = analysis(part);
      expect(verdictForm(a)).toBe("unpriced");
      expect(verdictSentence(a)).toBe("Aucun montant dans cette offre. C'est la première chose à demander.");
    }
  });

  it("bloc « Le deal proposé » : aucune ligne à 0 €", () => {
    for (const part of [zeroProduits, zeroArgent]) {
      const labels = dealRecapRows(deal(part)).map((row) => row.label);
      expect(labels).not.toContain("Produits offerts");
      expect(labels).not.toContain("Rémunération");
    }
    expect(dealRecapRows(deal({ in_kind_value_eur: 89 })).map((row) => row.label)).toContain("Produits offerts");
  });

  it("carte « Offre à préciser » : ni montant ni produits à 0", () => {
    const a = analysis(zeroProduits);
    const html = renderToStaticMarkup(<TermsUnknownCard deal={a.deal} estimate={a.estimate} missing={[]} />).replace(
      /&#x27;/g,
      "'",
    );
    expect(html).not.toContain("Produits offerts (valeur, pas de l'argent)");
    expect(html).not.toContain("Montant proposé");
  });

  it("carte partageable : elle ne propose pas 0 €", () => {
    for (const part of [zeroProduits, zeroArgent]) {
      expect(shareCardTexts(analysis(part)).proposes).toBeNull();
    }
    expect(shareCardTexts(analysis({ payment: paiement(null), in_kind_value_eur: 89 })).proposes).toContain("en produits");
  });

  it("les analyses déjà enregistrées avec un 0 sont nettoyées au chargement", () => {
    const source = readFileSync(path.join(process.cwd(), "lib/analysis/load.ts"), "utf8");
    expect(source).toContain("normalizeDeal(parsed.data.deal)");
  });
});
