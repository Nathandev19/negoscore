import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TermsUnknownCard } from "@/components/result/verdict-card";
import { evaluability, knownTerms, priceKnown } from "@/lib/analysis/evaluability";
import { normalizeDeal } from "@/lib/analysis/normalize";
import { verdictForm, verdictSentence } from "@/lib/analysis/verdict";
import { dealRecapRows } from "@/lib/display";
import { computeFrLegal } from "@/lib/legal/fr";
import { computeEstimate, countFilledFields, FOREIGN_CURRENCY_ASSUMPTION } from "@/lib/rates/engine";
import { appliedPriceCap, computeScore, hasUnknownQuantity, priceRatio, UNKNOWN_QUANTITY_SCORE_CAP } from "@/lib/rates/score";
import { verdictCardTexts } from "@/lib/share-card/verdict-card";
import { carteDeLAnalyse } from "@/lib/share-card/verdict-data";
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
    const carte = (part: Partial<Deal>) => verdictCardTexts(carteDeLAnalyse(analysis(part)));
    for (const part of [zeroProduits, zeroArgent]) {
      expect(carte(part).propose).toBeNull();
    }
    // Mission #169 — sans argent, c'est la valeur des produits qui est
    // comparée, donc celle qui s'affiche (comparedAmountOf, #167).
    expect(carte({ payment: paiement(null), in_kind_value_eur: 89 }).propose).toContain("89");
  });

  it("les analyses déjà enregistrées avec un 0 sont nettoyées au chargement", () => {
    const source = readFileSync(path.join(process.cwd(), "lib/analysis/load.ts"), "utf8");
    expect(source).toContain("normalizeDeal(parsed.data.deal)");
  });
});

// Mission #058 — trois champs de plus où 0 vaut absence, et les devises.
describe("A — quantité, durée d'usage et durée d'exclusivité à 0", () => {
  const brut = (part: Partial<Deal>): Deal => ({ ...deal(), ...part }) as Deal;

  it("quantité à 0 : même fourchette, même score, même plafond que null", () => {
    const zero = normalizeDeal(brut({ deliverables: [{ type: "video", platform: "tiktok", quantity: 0, format: null }] }));
    const absent = normalizeDeal(brut({ deliverables: [{ type: "video", platform: "tiktok", quantity: null, format: null }] }));
    expect(zero.deliverables[0].quantity).toBeNull();
    expect(hasUnknownQuantity(zero)).toBe(true);
    const e0 = computeEstimate(zero);
    const eNull = computeEstimate(absent);
    expect([e0.total_low, e0.total_high]).toEqual([eNull.total_low, eNull.total_high]);
    expect(e0.assumptions).toEqual(eNull.assumptions);
    expect(computeScore(zero, e0)).toEqual(computeScore(absent, eNull));
    expect(evaluability(zero)).toBe(evaluability(absent));
    // Le plafond des quantités inconnues s'applique désormais aussi à 0.
    const paye = { payment: paiement(2000), usage: { organic: true, paid_ads: false, whitelisting: false, spark_ads: false, perpetual: false, duration_months: null, territory: "France" } };
    const bienPaye = normalizeDeal(brut({ ...paye, deliverables: [{ type: "video", platform: "tiktok", quantity: 0, format: null }] }));
    expect(computeScore(bienPaye, computeEstimate(bienPaye)).value).toBeLessThanOrEqual(UNKNOWN_QUANTITY_SCORE_CAP);
  });

  it("durée d'usage à 0 : hypothèse des 3 mois, et condition non connue", () => {
    const zero = normalizeDeal(brut({ usage: { organic: true, paid_ads: true, whitelisting: false, spark_ads: false, perpetual: false, duration_months: 0, territory: null } }));
    const absent = normalizeDeal(brut({ usage: { organic: true, paid_ads: true, whitelisting: false, spark_ads: false, perpetual: false, duration_months: null, territory: null } }));
    expect(zero.usage.duration_months).toBeNull();
    const e0 = computeEstimate(zero);
    expect([e0.total_low, e0.total_high]).toEqual(((e) => [e.total_low, e.total_high])(computeEstimate(absent)));
    expect(e0.assumptions).toContain("Durée des droits pub non précisée : 3 mois supposés.");
    expect(e0.lines.map((l) => l.label)).toContain("Droits pub 3 mois");
    expect(knownTerms(zero)).not.toContain("duration");
    expect(knownTerms(zero)).toEqual(knownTerms(absent));
    expect(evaluability(zero)).toBe(evaluability(absent));
  });

  it("durée d'exclusivité à 0 : plus facturée un mois, mêmes chiffres que null", () => {
    const zero = normalizeDeal(brut({ exclusivity: { present: true, duration_months: 0, category: "soins" } }));
    const absent = normalizeDeal(brut({ exclusivity: { present: true, duration_months: null, category: "soins" } }));
    expect(zero.exclusivity.duration_months).toBeNull();
    const e0 = computeEstimate(zero);
    const eNull = computeEstimate(absent);
    expect([e0.total_low, e0.total_high]).toEqual([eNull.total_low, eNull.total_high]);
    expect(e0.lines.map((l) => l.label)).toEqual(eNull.lines.map((l) => l.label));
    expect(e0.lines.map((l) => l.label)).toContain("Exclusivité 3 mois");
    expect(computeScore(zero, e0)).toEqual(computeScore(absent, eNull));
  });
});

describe("B — montant dans une autre devise que l'euro", () => {
  it("une devise étrangère met le montant de côté et le dit", () => {
    for (const devise of ["USD", "usd", "$", "GBP", "£", "CHF", "dollars", "CAD"]) {
      const d = normalizeDeal({ ...deal(), payment: { amount_eur: 300, currency: devise, terms_days: 30, schedule: null } } as Deal);
      expect(d.payment.amount_eur, devise).toBeNull();
      expect(computeEstimate(d).assumptions, devise).toContain(FOREIGN_CURRENCY_ASSUMPTION);
      expect(priceKnown(d), devise).toBe(false);
    }
  });

  it("l'euro, quelle que soit sa graphie, garde son montant", () => {
    for (const devise of ["EUR", "eur", "euro", "euros", "€", "EUR HT", ""]) {
      const d = normalizeDeal({ ...deal(), payment: { amount_eur: 300, currency: devise, terms_days: 30, schedule: null } } as Deal);
      expect(d.payment.amount_eur, devise).toBe(300);
      expect(computeEstimate(d).assumptions, devise).not.toContain(FOREIGN_CURRENCY_ASSUMPTION);
    }
  });

  it("sans montant, une devise étrangère n'invente rien mais l'explique quand même", () => {
    const d = normalizeDeal({ ...deal(), payment: { amount_eur: null, currency: "USD", terms_days: null, schedule: null } } as Deal);
    expect(computeEstimate(d).assumptions).toContain(FOREIGN_CURRENCY_ASSUMPTION);
    expect(evaluability(d)).toBe("unpriced");
  });
});
