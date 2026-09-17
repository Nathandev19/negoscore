import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AnalysisResult } from "@/components/result/analysis-result";
import {
  composeAnalysis,
  INCOMPLETE_ASSUMPTION,
  TERMS_UNKNOWN_ASSUMPTION,
  UNPRICED_ASSUMPTION,
} from "@/lib/analysis/compose";
import {
  evaluability,
  incompleteRequestMessage,
  knownTerms,
  missingInformation,
  priceKnown,
  scopeKnown,
  TERM_KEYS,
  termsKnown,
  termsRequestMessage,
} from "@/lib/analysis/evaluability";
import { lockAnalysis } from "@/lib/analysis/lock";
import { BAND_LABEL } from "@/lib/display";
import sample from "@/lib/fixtures/analysis-legacy-1.0.json";
import { extractionSchema, PRICE_PLACEHOLDER, type Extraction } from "@/lib/llm/prompt";
import { computeEstimate } from "@/lib/rates/engine";
import { computeScore } from "@/lib/rates/score";
import { analysisSchema, type Analysis } from "@/lib/schema";

type Deal = Analysis["deal"];

const EMPTY_DEAL: Deal = {
  brand: null,
  deliverables: [],
  publication_required: false,
  usage: {
    organic: false,
    paid_ads: false,
    whitelisting: false,
    spark_ads: false,
    duration_months: null,
    territory: null,
    perpetual: false,
  },
  exclusivity: { present: false, duration_months: null, category: null },
  raw_footage: false,
  ip_transfer: "none",
  ai_training_rights: "absent",
  revisions: { count: null, unlimited: false },
  payment: { amount_eur: null, currency: "EUR", terms_days: null, schedule: null },
  in_kind_value_eur: null,
  deadlines: [],
  kill_fee: null,
  termination: null,
  governing_law: null,
};

function deal(overrides: Partial<Deal>): Deal {
  return { ...EMPTY_DEAL, ...overrides };
}

function extraction(d: Deal, overrides: Partial<Extraction> = {}): Extraction {
  return extractionSchema.parse({
    language: "fr",
    confidence: "medium",
    input_quality: { readable: true, missing_critical: [] },
    deal: d,
    good_points: [],
    negotiate: [{ label: "Facturer les droits pub", why: "Ils ont de la valeur.", priority: 1, topic: "paid_ads" }],
    red_flags: [],
    counter_offer: { changes: ["Droits pub facturés à part"] },
    ready_to_send_message: { tone: "cordial", text: `Mon tarif pour ce projet se situe ${PRICE_PLACEHOLDER}.` },
    ...overrides,
  });
}

// Rendu serveur de la page résultat, vue propriétaire puis vue verrouillée.
function renderAll(analysis: Analysis): string {
  const unlocked = renderToStaticMarkup(createElement(AnalysisResult, { analysis, unlockHref: "/connexion" }));
  const locked = renderToStaticMarkup(
    createElement(AnalysisResult, { analysis: lockAnalysis(analysis), unlockHref: "/connexion" }),
  );
  return `${unlocked}\n${locked}`;
}

function expectNoQualityVerdict(analysis: Analysis) {
  const html = renderAll(analysis);
  const serialized = JSON.stringify(analysis);
  for (const label of Object.values(BAND_LABEL)) {
    expect(html).not.toContain(label);
    expect(serialized).not.toContain(label);
  }
  expect(html).not.toMatch(/\/100/);
  expect(analysis.score).toBeNull();
  return html;
}

// CASE A — le DM cosmétique mesuré en production : 32/100, « Deal faible ».
const CASE_A = deal({
  brand: "Aubépine",
  deliverables: [{ type: "video", platform: "tiktok", quantity: 2, format: null }],
  usage: { ...EMPTY_DEAL.usage, paid_ads: true, duration_months: 6, territory: "TikTok et Instagram" },
  exclusivity: { present: true, duration_months: 3, category: "cosmétique" },
  raw_footage: true,
  ip_transfer: "license",
  revisions: { count: 3, unlimited: false },
  payment: { amount_eur: 300, currency: "EUR", terms_days: 60, schedule: null },
});

// CASE B — le message de l'audit du 16/09/2026.
const CASE_B = deal({ ip_transfer: "unclear", ai_training_rights: "unclear" });

// CASE C — livrables, usage et durée connus, aucun prix.
const CASE_C = deal({
  brand: "Vitalune",
  deliverables: [{ type: "video", platform: "tiktok", quantity: 4, format: null }],
  usage: { ...EMPTY_DEAL.usage, paid_ads: true, duration_months: 6 },
  raw_footage: true,
  ip_transfer: "license",
});

// CASE D — prix connu, droits d'usage inconnus.
const CASE_D = deal({
  brand: "Frimousse",
  deliverables: [{ type: "video", platform: "tiktok", quantity: 2, format: null }],
  payment: { amount_eur: 300, currency: "EUR", terms_days: null, schedule: null },
});

// CASE E — offre complète et correcte.
const CASE_E = deal({
  brand: "Linéa",
  deliverables: [{ type: "video", platform: "instagram", quantity: 1, format: null }],
  publication_required: true,
  usage: { ...EMPTY_DEAL.usage, organic: true, duration_months: 3, territory: "France" },
  ip_transfer: "license",
  revisions: { count: 2, unlimited: false },
  payment: { amount_eur: 900, currency: "EUR", terms_days: 30, schedule: null },
});

describe("règle d'évaluabilité", () => {
  it("périmètre = au moins un livrable et au moins un usage", () => {
    expect(scopeKnown(CASE_A)).toBe(true);
    expect(scopeKnown(CASE_D)).toBe(false);
    expect(scopeKnown(deal({ usage: { ...EMPTY_DEAL.usage, organic: true } }))).toBe(false);
    const perpetualOnly = deal({ ...CASE_D, usage: { ...EMPTY_DEAL.usage, perpetual: true } });
    expect(scopeKnown(perpetualOnly)).toBe(true);
  });

  it("prix = montant ou valeur des produits offerts", () => {
    expect(priceKnown(CASE_A)).toBe(true);
    expect(priceKnown(CASE_C)).toBe(false);
    expect(priceKnown(deal({ in_kind_value_eur: 89 }))).toBe(true);
    expect(priceKnown(deal({ payment: { ...EMPTY_DEAL.payment, amount_eur: 0 } }))).toBe(true);
  });

  it("trois états seulement, le périmètre avant le prix", () => {
    expect(evaluability(CASE_A)).toBe("complete");
    expect(evaluability(CASE_B)).toBe("incomplete");
    expect(evaluability(CASE_C)).toBe("unpriced");
    expect(evaluability(CASE_D)).toBe("incomplete");
    expect(evaluability(CASE_E)).toBe("complete");
    expect(evaluability(deal({ ...CASE_C, in_kind_value_eur: 89 }))).toBe("complete");
  });

  it("ne lit pas le jugement du modèle : missing_critical ne change pas l'état", () => {
    const flagged = composeAnalysis(
      extraction(CASE_E, { input_quality: { readable: false, missing_critical: ["Budget", "Droits", "Livrables"] } }),
    );
    expect(flagged.evaluability).toBe("complete");
    const silent = composeAnalysis(extraction(CASE_B));
    expect(silent.evaluability).toBe("incomplete");
  });
});

describe("CASE A — offre complète mesurée en production", () => {
  it("reste « complete », 32/100 « Deal faible », confiance moyenne, strictement comme avant", () => {
    const analysis = composeAnalysis(extraction(CASE_A));
    expect(analysis.evaluability).toBe("complete");
    expect(analysis.score).toEqual({ value: 32, band: "weak" });
    expect(analysis.score).toEqual(computeScore(CASE_A, computeEstimate(CASE_A)));
    expect(BAND_LABEL[analysis.score!.band]).toBe("Deal faible");
    expect(analysis.confidence).toBe("medium");

    const computed = computeEstimate(CASE_A);
    expect(analysis.estimate.total_low).toBe(computed.total_low);
    expect(analysis.estimate.total_high).toBe(computed.total_high);
    expect(analysis.estimate.assumptions).toEqual(computed.assumptions);
    expect(analysis.counter_offer.amount_low).toBe(computed.total_low);
    expect(analysis.ready_to_send_message.text).toMatch(/entre .+€ et .+€/);

    const html = renderAll(analysis);
    expect(html).toContain("Deal faible");
    expect(html).toContain("Ta contre-offre chiffrée");
    expect(html).not.toContain("Offre à chiffrer");
    expect(html).not.toContain("Informations insuffisantes");
  });
});

describe("CASE B — message sans contenu, droits ni budget", () => {
  const analysis = composeAnalysis(
    extraction(CASE_B, {
      confidence: "low",
      input_quality: { readable: true, missing_critical: ["Budget non précisé", "Droits d'utilisation non précisés"] },
      red_flags: [{ label: "Offre très incomplète", severity: "high", why: "Rien n'est précisé." }],
      ready_to_send_message: { tone: "cordial", text: "Quel budget avez-vous prévu ?" },
    }),
  );

  it("« incomplete » : ni score, ni estimation, ni contre-offre chiffrée", () => {
    expect(analysis.evaluability).toBe("incomplete");
    expect(analysis.score).toBeNull();
    expect(analysis.estimate).toMatchObject({ base_low: null, base_high: null, lines: [], total_low: null, total_high: null });
    expect(analysis.estimate.assumptions).toEqual([INCOMPLETE_ASSUMPTION]);
    expect(analysis.counter_offer.amount_low).toBeNull();
    expect(analysis.counter_offer.amount_high).toBeNull();
    expect(analysis.negotiate.every((n) => n.eur_impact_low === null && n.eur_impact_high === null)).toBe(true);
  });

  it("ni 50/100 ni « Deal correct » nulle part, et la liste de ce qui manque", () => {
    const html = expectNoQualityVerdict(analysis);
    expect(JSON.stringify(analysis)).not.toMatch(/\b50\b/);
    expect(html).toContain("Informations insuffisantes");
    expect(html).toContain("Impossible d&#x27;évaluer ce deal tant que certains éléments ne sont pas précisés.");
    expect(html).not.toContain("Ce que ça vaut");
    expect(html).not.toContain("Ta contre-offre chiffrée");
    expect(missingInformation(analysis)).toEqual([
      "Budget non précisé",
      "Droits d'utilisation non précisés",
      "Les contenus attendus : combien, de quel type, sur quelles plateformes",
    ]);
  });

  it("le message demande les éléments manquants, sans aucun tarif", () => {
    const text = analysis.ready_to_send_message.text;
    expect(text).toContain("les contenus attendus");
    expect(text).toContain("l'utilisation prévue des contenus");
    expect(text).toContain("le budget prévu");
    expect(text).not.toMatch(/€|\d/);
    expect(text).not.toContain(PRICE_PLACEHOLDER);
  });
});

describe("CASE C — périmètre connu, aucun prix", () => {
  const analysis = composeAnalysis(extraction(CASE_C));

  it("« unpriced » : fourchette présente et marquée indicative, aucun score", () => {
    expect(analysis.evaluability).toBe("unpriced");
    expect(analysis.score).toBeNull();
    expect(analysis.confidence).toBe("low");
    expect(analysis.estimate.base_low).not.toBeNull();
    expect(analysis.estimate.total_low).not.toBeNull();
    expect(analysis.estimate.total_high).not.toBeNull();
    expect(analysis.counter_offer.amount_low).toBe(analysis.estimate.total_low);
    expect(analysis.ready_to_send_message.text).toMatch(/entre .+€ et .+€/);
    expect(analysis.estimate.lines.length).toBeGreaterThan(0);
    expect(analysis.estimate.assumptions).toContain(UNPRICED_ASSUMPTION);
    expect(analysis.negotiate[0].eur_impact_low).not.toBeNull();
  });

  it("aucun libellé de qualité, le verdict annonce une offre à chiffrer", () => {
    const html = expectNoQualityVerdict(analysis);
    expect(html).toContain("Offre à chiffrer");
    expect(html).toContain("Cette offre ne précise pas de rémunération.");
    expect(html).toContain("Ce que ça vaut");
    expect(html).toContain("Fourchette estimée");
    expect(html).toContain("Fourchette indicative");
  });
});

describe("CASE D — prix connu, droits d'usage inconnus", () => {
  it("« incomplete » : le prix ne suffit pas, le message demande l'usage sans tarif", () => {
    const analysis = composeAnalysis(extraction(CASE_D));
    expect(analysis.evaluability).toBe("incomplete");
    expect(analysis.score).toBeNull();
    expect(analysis.estimate.total_low).toBeNull();
    expect(analysis.counter_offer.amount_low).toBeNull();
    expect(analysis.ready_to_send_message.text).toContain("l'utilisation prévue des contenus");
    expect(analysis.ready_to_send_message.text).not.toContain("le budget prévu");
    expect(analysis.ready_to_send_message.text).not.toMatch(/entre .+€/);
    expectNoQualityVerdict(analysis);
    expect(missingInformation(analysis)).toEqual([
      "Les droits d'utilisation : ce que la marque fera des contenus et pendant combien de temps",
    ]);
  });
});

describe("CASE E — offre complète et correcte", () => {
  it("« complete », non pénalisée : score et estimation identiques au calcul direct", () => {
    const analysis = composeAnalysis(extraction(CASE_E, { confidence: "high" }));
    expect(analysis.evaluability).toBe("complete");
    const estimate = computeEstimate(CASE_E);
    expect(analysis.score).toEqual(computeScore(CASE_E, estimate));
    expect(analysis.score!.value).toBeGreaterThanOrEqual(70);
    expect(analysis.estimate.total_low).toBe(estimate.total_low);
    expect(analysis.estimate.assumptions).not.toContain(UNPRICED_ASSUMPTION);
    expect(analysis.confidence).toBe("high");
    expect(renderAll(analysis)).toContain(BAND_LABEL[analysis.score!.band]);
  });
});

describe("analyses enregistrées avant la version 1.1", () => {
  it("une analyse 1.0 sans le champ est relue comme « complete » et garde son score", () => {
    expect("evaluability" in sample).toBe(false);
    const parsed = analysisSchema.parse(sample);
    expect(parsed.schema_version).toBe("1.0");
    expect(parsed.evaluability).toBe("complete");
    expect(parsed.score).toEqual({ value: 32, band: "weak" });
    expect(renderAll(parsed)).toContain("Deal faible");
  });

  it("une nouvelle analyse est en version 1.4", () => {
    expect(composeAnalysis(extraction(CASE_A)).schema_version).toBe("1.4");
  });

  it("le modèle ne produit pas l'évaluabilité", () => {
    expect(Object.keys(extractionSchema.shape)).not.toContain("evaluability");
  });
});

describe("message d'une offre incomplète en anglais", () => {
  it("pose les mêmes questions, sans tarif", () => {
    const text = incompleteRequestMessage(CASE_B, "en");
    expect(text).toContain("the budget planned");
    expect(text).toContain("the expected content");
    expect(text).not.toMatch(/€|\d/);
  });
});

// CASE F — « Tu postes 1 vidéo sur ton TikTok, on te paie 250 € » : 85/100 avant la #017.
const CASE_F = deal({
  deliverables: [{ type: "video", platform: "tiktok", quantity: 1, format: null }],
  publication_required: true,
  usage: { ...EMPTY_DEAL.usage, organic: true },
  payment: { amount_eur: 250, currency: "EUR", terms_days: null, schedule: null },
});

describe("conditions connues", () => {
  it("au moins deux conditions renseignées, chacune lue telle qu'écrite", () => {
    expect(termsKnown(CASE_F)).toBe(false);
    expect(knownTerms(CASE_F)).toEqual([]);
    const one = deal({ ...CASE_F, payment: { ...CASE_F.payment, terms_days: 30 } });
    expect(termsKnown(one)).toBe(false);
    expect(termsKnown(deal({ ...one, revisions: { count: null, unlimited: true } }))).toBe(true);
    expect(knownTerms(deal({ ...CASE_F, usage: { ...CASE_F.usage, perpetual: true }, exclusivity: { present: true, duration_months: null, category: null } }))).toEqual(["duration", "exclusivity"]);
    expect(knownTerms(deal({ ...CASE_F, usage: { ...CASE_F.usage, territory: "France" }, ip_transfer: "license" }))).toEqual(["territory", "ip_transfer"]);
    expect(knownTerms(deal({ ...CASE_F, ip_transfer: "unclear" }))).toEqual([]);
    expect(knownTerms(CASE_A)).toEqual([...TERM_KEYS]);
  });

  it("quatrième état réservé à un deal au périmètre et au prix connus", () => {
    expect(evaluability(CASE_F)).toBe("terms_unknown");
    expect(evaluability(deal({ ...CASE_F, payment: EMPTY_DEAL.payment }))).toBe("unpriced");
    expect(evaluability(deal({ ...CASE_F, deliverables: [] }))).toBe("incomplete");
  });
});

describe("CASE F — prix connu, conditions inconnues", () => {
  const analysis = composeAnalysis(
    extraction(CASE_F, { input_quality: { readable: true, missing_critical: ["Nom de la marque", "Délai et modalités de paiement"] } }),
  );

  it("« terms_unknown » : estimation conservée, score null, hypothèse explicite", () => {
    const estimate = computeEstimate(CASE_F);
    // 85 avant la #019 ; 250 € pile sur la borne basse ne vaut plus que +18.
    expect(computeScore(CASE_F, estimate)).toEqual({ value: 73, band: "good" });
    expect(analysis.evaluability).toBe("terms_unknown");
    expect(analysis.score).toBeNull();
    expect(analysis.estimate.total_low).toBe(estimate.total_low);
    expect(analysis.estimate.total_high).toBe(estimate.total_high);
    expect(analysis.estimate.assumptions).toContain(TERMS_UNKNOWN_ASSUMPTION);
    expect(analysis.counter_offer.amount_low).toBe(375);
    expect(analysis.counter_offer.amount_high).toBe(estimate.total_high);
  });

  it("« Offre à préciser », comparaison au montant, liste des conditions, aucun libellé de qualité", () => {
    const html = expectNoQualityVerdict(analysis);
    expect(html).toContain("Offre à préciser");
    expect(html).toContain("On peut chiffrer ce que ça vaut, pas si le deal est bon : la marque ne dit rien de ses conditions.");
    expect(html).toContain("Montant proposé");
    expect(html).toContain("Le montant proposé est tout en bas de notre fourchette.");
    expect(html).toContain("Ce que ça vaut");
    // Plafonnée à quatre : droits et durée, exclusivité, délai de paiement ;
    // « Nom de la marque », le territoire et les révisions passent après.
    expect(missingInformation(analysis)).toEqual([
      "La durée d'utilisation des contenus",
      "Qui détient les droits sur les contenus : licence ou cession",
      "L'existence ou non d'une exclusivité",
      "Délai et modalités de paiement",
    ]);
  });

  it("le message demande les conditions, sans tarif", () => {
    const text = analysis.ready_to_send_message.text;
    expect(text).toContain("les conditions de la collaboration");
    expect(text).toContain("le délai de paiement");
    expect(text).toContain("le nombre de révisions prévues");
    expect(text).not.toMatch(/€|\d/);
    expect(text).not.toContain(PRICE_PLACEHOLDER);
    expect(termsRequestMessage(CASE_F, "en")).toContain("the payment terms");
  });
});

describe("mission #018 — licence seule, produits offerts, liste plafonnée", () => {
  it("« licence » seule ne compte pas ; avec une durée ou un territoire, elle compte", () => {
    const licence = deal({ ...CASE_F, ip_transfer: "license" });
    expect(knownTerms(licence)).toEqual([]);
    const withPayment = deal({ ...licence, payment: { ...licence.payment, terms_days: 30 } });
    expect(knownTerms(withPayment)).toEqual(["payment_terms"]);
    expect(evaluability(withPayment)).toBe("terms_unknown");
    expect(knownTerms(deal({ ...licence, usage: { ...licence.usage, territory: "France" } }))).toEqual(["territory", "ip_transfer"]);
    expect(knownTerms(deal({ ...licence, usage: { ...licence.usage, duration_months: 6 } }))).toEqual(["duration", "ip_transfer"]);
    expect(knownTerms(deal({ ...licence, usage: { ...licence.usage, perpetual: true } }))).toEqual(["duration", "ip_transfer"]);
  });

  it("une cession totale compte toujours", () => {
    expect(knownTerms(deal({ ...CASE_F, ip_transfer: "full_assignment" }))).toEqual(["ip_transfer"]);
    const withPayment = deal({ ...CASE_F, ip_transfer: "full_assignment", payment: { ...CASE_F.payment, terms_days: 30 } });
    expect(evaluability(withPayment)).toBe("complete");
  });

  it("une offre payée en produits est comparée à la fourchette, en disant que ce ne sont pas des euros", () => {
    const products = deal({ ...CASE_F, payment: EMPTY_DEAL.payment, in_kind_value_eur: 89 });
    const analysis = composeAnalysis(extraction(products));
    expect(analysis.evaluability).toBe("terms_unknown");
    expect(analysis.estimate.total_low).toBeGreaterThan(89);
    const html = renderAll(analysis);
    expect(html).toContain("La valeur des produits offerts est en dessous de notre fourchette. Ce sont des produits, pas de l&#x27;argent.");
    expect(html).toContain("Produits offerts (valeur, pas de l&#x27;argent)");
    expect(html).not.toContain("Le montant proposé est");
  });

  it("au plus quatre éléments : rémunération, droits et durée, exclusivité, délai de paiement", () => {
    const analysis = composeAnalysis(
      extraction(CASE_B, {
        input_quality: {
          readable: true,
          missing_critical: ["Nom de la marque", "Délai de paiement", "Exclusivité éventuelle", "Durée des droits", "Budget prévu", "Date de livraison"],
        },
      }),
    );
    expect(missingInformation(analysis)).toEqual(["Budget prévu", "Durée des droits", "Les contenus attendus : combien, de quel type, sur quelles plateformes", "Exclusivité éventuelle"]);
  });
});
