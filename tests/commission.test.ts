import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { composeAnalysis } from "@/lib/analysis/compose";
import { dealRecapRows } from "@/lib/display";
import sampleExtraction from "@/lib/fixtures/sample-extraction.json";
import { extractionSchema, type Extraction } from "@/lib/llm/prompt";
import { commissionRedFlags, hasVariablePay, NO_FIXED_PAY_FLAG, variablePayOf } from "@/lib/negotiation/commission";
import { messageCoverage } from "@/lib/negotiation/coverage";
import { topicsOf } from "@/lib/negotiation/topics";
import { analysisSchema, type Analysis } from "@/lib/schema";

// Mission #116 — une offre à commission dit ce qu'il faut obtenir.
//
// Offre réelle du 24/09 : 2 vidéos TikTok, 15 % sur les ventes via un code
// promo, aucun fixe, droits pub 6 mois.

const base = () => extractionSchema.parse(structuredClone(sampleExtraction)) as Extraction;

const COMMISSION = { present: true, rate_percent: 15, base: null, per_sale_eur: null, attribution_days: null, payout: null };

const affiliation = (over: Partial<Extraction["deal"]> = {}): Extraction => ({
  ...base(),
  deal: {
    ...base().deal,
    brand: "Marque",
    deliverables: [{ type: "video", platform: "tiktok", quantity: 2, format: null }],
    usage: { organic: true, paid_ads: true, whitelisting: false, spark_ads: false, perpetual: false, duration_months: 6, territory: null },
    exclusivity: { present: false, duration_months: null, category: null },
    raw_footage: false,
    ip_transfer: "license",
    ai_training_rights: "absent",
    revisions: { count: 2, unlimited: false },
    payment: { amount_eur: null, currency: "EUR", terms_days: null, schedule: null },
    in_kind_value_eur: null,
    variable_pay: COMMISSION,
    ...over,
  },
  negotiate: [{ label: "Encadrer les droits pub", why: "Six mois de diffusion, c'est un droit qui se paie.", priority: 1, topic: "paid_ads" }],
  red_flags: [{ label: "Aucune rémunération fixe", severity: "high", why: "Tu n'as aucune garantie de paiement si les ventes générées sont faibles." }],
});

const labels = (analysis: Analysis) => analysis.negotiate.map((point) => point.label);

// ─── A — lire la commission ─────────────────────────────────────────────────

describe("A — le schéma et la compatibilité", () => {
  it("une analyse enregistrée SANS le champ se relit, avec « aucune commission »", () => {
    const stored = composeAnalysis(base()) as unknown as Record<string, unknown>;
    const deal = { ...(stored.deal as Record<string, unknown>) };
    delete deal.variable_pay;
    const parsed = analysisSchema.safeParse({ ...stored, deal });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.deal.variable_pay).toEqual({ present: false, rate_percent: null, base: null, per_sale_eur: null, attribution_days: null, payout: null });
      expect(hasVariablePay(parsed.data.deal)).toBe(false);
    }
  });

  it("toute lecture tolère un champ absent, même hors du schéma", () => {
    expect(hasVariablePay({} as never)).toBe(false);
    expect(variablePayOf({}).present).toBe(false);
    expect(dealRecapRows({ ...composeAnalysis(base()).deal, variable_pay: undefined } as never).some((row) => row.label === "Commission")).toBe(false);
  });

  it("une commission déclarée par le taux seul compte comme une commission", () => {
    expect(hasVariablePay({ variable_pay: { ...COMMISSION, present: false } })).toBe(true);
    expect(hasVariablePay({ variable_pay: { ...COMMISSION, present: false, rate_percent: null, per_sale_eur: 2 } })).toBe(true);
  });

  it("A3 — « Le deal proposé » montre ce que l'outil a lu, et ce qui manque", () => {
    const rows = dealRecapRows(composeAnalysis(affiliation()).deal);
    const row = rows.find((entry) => entry.label === "Commission");
    expect(row?.value).toContain("15 %");
    expect(row?.value).toContain("assiette non précisée");
    expect(row?.value).toContain("attribution non précisée");
    expect(row?.value).toContain("versement non précisé");
  });

  it("le détail écrit dans l'offre est repris tel quel", () => {
    const rows = dealRecapRows(
      composeAnalysis(affiliation({ variable_pay: { present: true, rate_percent: 15, base: "prix de vente HT", per_sale_eur: null, attribution_days: 30, payout: "mensuel, dès 50 €" } })).deal,
    );
    const row = rows.find((entry) => entry.label === "Commission");
    expect(row?.value).toContain("sur prix de vente HT");
    expect(row?.value).toContain("attribution 30 jours");
    expect(row?.value).toContain("versement : mensuel, dès 50 €");
  });
});

// ─── B — dire ce qu'il faut obtenir ─────────────────────────────────────────

describe("B — les cinq points", () => {
  // Mission #117 — le contexte de la #116 : une offre qui annonce 15 % et RIEN
  // d'autre. Le taux étant écrit, son point ne s'ajoute pas ; les quatre autres
  // si. C'est ce que « dire ce qu'il faut obtenir » veut dire : ce qui manque.
  it("l'offre du contexte : les points de ce qui manque, et le fixe porte 200 – 360 €", () => {
    const analysis = composeAnalysis(affiliation(), { tier: "starter" });
    expect([analysis.estimate.base_low, analysis.estimate.base_high]).toEqual([200, 360]);
    const list = labels(analysis);
    expect(list).toContain("Obtenir un fixe qui couvre au moins la création");
    expect(list).toContain("Faire écrire sur quoi porte le pourcentage");
    expect(list).toContain("Faire écrire combien de temps une vente reste rattachée à ton code");
    expect(list).toContain("Vérifier que les publicités de la marque n'annulent pas ton attribution");
    expect(list).toContain("Faire écrire quand la commission est versée, et à partir de quel seuil");
    // Le taux EST écrit : on ne le redemande pas.
    expect(list).not.toContain("Faire écrire combien te rapporte chaque vente");
    const fixe = analysis.negotiate.find((point) => point.label.startsWith("Obtenir un fixe"));
    expect(fixe?.why.replace(/[  ]/g, " ")).toContain("200 € – 360 €");
  });

  it("B1 porte la CRÉATION, jamais le total", () => {
    const analysis = composeAnalysis(affiliation(), { tier: "starter" });
    const fixe = analysis.negotiate.find((point) => point.label.startsWith("Obtenir un fixe"));
    // Le total inclut les droits pub : il ne doit pas apparaître.
    expect(fixe?.why).not.toContain(String(analysis.estimate.total_low));
    expect(fixe?.why).not.toContain(String(analysis.estimate.total_high));
  });

  it("B4 ne s'ajoute PAS sans droits publicitaires", () => {
    const sansPub = affiliation({
      usage: { organic: true, paid_ads: false, whitelisting: false, spark_ads: false, perpetual: false, duration_months: null, territory: null },
    });
    const list = labels(composeAnalysis(sansPub));
    expect(list).not.toContain("Vérifier que les publicités de la marque n'annulent pas ton attribution");
    // Les quatre autres restent.
    expect(list).toContain("Obtenir un fixe qui couvre au moins la création");
    expect(list).toContain("Faire écrire quand la commission est versée, et à partir de quel seuil");
  });

  it("B1 disparaît quand l'offre annonce déjà un fixe", () => {
    const avecFixe = affiliation({ payment: { amount_eur: 400, currency: "EUR", terms_days: null, schedule: null } });
    expect(labels(composeAnalysis(avecFixe))).not.toContain("Obtenir un fixe qui couvre au moins la création");
  });

  it("aucun point n'est doublé quand le modèle traite déjà le sujet", () => {
    const dejaTraite: Extraction = {
      ...affiliation(),
      negotiate: [
        { label: "Demander un fixe garanti", why: "Le travail se paie d'avance.", priority: 1, topic: "other" },
        { label: "Préciser l'assiette de la commission", why: "15 % de quoi ?", priority: 2, topic: "other" },
      ],
    };
    const list = labels(composeAnalysis(dejaTraite));
    expect(list).not.toContain("Obtenir un fixe qui couvre au moins la création");
    expect(list).not.toContain("Faire écrire sur quoi porte le pourcentage");
    // Ceux qui manquaient, eux, s'ajoutent.
    expect(list).toContain("Faire écrire combien de temps une vente reste rattachée à ton code");
  });

  it("les priorités restent 1, 2, 3… après ajout", () => {
    const analysis = composeAnalysis(affiliation());
    expect(analysis.negotiate.map((point) => point.priority)).toEqual(analysis.negotiate.map((_, index) => index + 1));
  });
});

// ─── C — le signal dit la sortie ────────────────────────────────────────────

describe("C — le red flag", () => {
  it("commission sans fixe : le signal dit ce qui rend l'offre défendable", () => {
    const flags = composeAnalysis(affiliation()).red_flags;
    const flag = flags.find((entry) => entry.label === "Aucune rémunération fixe");
    expect(flag?.severity).toBe("high");
    expect(flag?.why).toContain("couvre au moins la création");
    expect(flag?.why).toContain("bonus, pas un salaire");
    // Un seul, jamais deux.
    expect(flags.filter((entry) => /fixe/i.test(entry.label))).toHaveLength(1);
  });

  it("commission ET fixe : le signal « aucune rémunération fixe » disparaît", () => {
    const avecFixe = affiliation({ payment: { amount_eur: 400, currency: "EUR", terms_days: null, schedule: null } });
    const analysis = composeAnalysis(avecFixe, { tier: "starter" });
    expect(analysis.red_flags.some((flag) => /aucune rémunération fixe/i.test(flag.label))).toBe(false);
    // Et le fixe est situé normalement dans la fourchette.
    expect(analysis.evaluability).toBe("complete");
    expect(analysis.score).not.toBeNull();
  });

  it("le signal est ajouté même si le modèle ne l'a pas vu", () => {
    const sansSignal: Extraction = { ...affiliation(), red_flags: [] };
    expect(composeAnalysis(sansSignal).red_flags[0]).toEqual(NO_FIXED_PAY_FLAG);
  });

  it("sans commission, la liste du modèle passe telle quelle", () => {
    const flags = [{ label: "Exclusivité longue", severity: "medium" as const, why: "Six mois, c'est long." }];
    const deal = composeAnalysis(base()).deal;
    expect(commissionRedFlags(deal, flags)).toEqual(flags);
  });
});

// ─── L'invariant qui compte le plus ─────────────────────────────────────────

describe("une offre SANS commission ne change en rien", () => {
  it("sortie identique, à l'octet près, sur un échantillon de cas", () => {
    const cas: Array<Partial<Extraction["deal"]>> = [
      {},
      { payment: { amount_eur: 800, currency: "EUR", terms_days: 30, schedule: null } },
      { usage: { organic: true, paid_ads: true, whitelisting: true, spark_ads: false, perpetual: false, duration_months: 12, territory: "monde entier" } },
      { exclusivity: { present: true, duration_months: 6, category: "cosmétique" } },
      { raw_footage: true, ip_transfer: "full_assignment" },
      { deliverables: [] },
      { payment: { amount_eur: null, currency: "EUR", terms_days: null, schedule: null } },
    ];
    for (const patch of cas) {
      const extraction = { ...base(), deal: { ...base().deal, ...patch } } as Extraction;
      const avec = composeAnalysis(extraction);
      // La même analyse, calculée en retirant le champ du deal d'entrée.
      const sansChamp = { ...extraction, deal: { ...extraction.deal, variable_pay: undefined } } as unknown as Extraction;
      expect(JSON.stringify(composeAnalysis(sansChamp)), JSON.stringify(patch)).toBe(JSON.stringify(avec));
      // Et aucun des cinq points n'apparaît.
      expect(labels(avec).some((label) => /commission|attribution|versée/.test(label)), JSON.stringify(patch)).toBe(false);
    }
  });
});

// ─── La preuve qu'aucun euro n'est associé à la commission ──────────────────

describe("aucun euro n'est jamais attribué à la commission", () => {
  const analysis = composeAnalysis(affiliation(), { tier: "starter" });

  it("les points de commission ne portent aucun impact chiffré", () => {
    for (const point of analysis.negotiate) {
      if (!/commission|attribution|versée/.test(point.label)) continue;
      expect(point.eur_impact_low, point.label).toBeNull();
      expect(point.eur_impact_high, point.label).toBeNull();
    }
  });

  it("la fourchette et la contre-offre ne doivent rien à la commission", () => {
    const sansCommission = composeAnalysis({ ...affiliation(), deal: { ...affiliation().deal, variable_pay: { ...COMMISSION, present: false, rate_percent: null } } }, { tier: "starter" });
    expect(analysis.estimate.total_low).toBe(sansCommission.estimate.total_low);
    expect(analysis.estimate.total_high).toBe(sansCommission.estimate.total_high);
    expect(analysis.counter_offer.amount_low).toBe(sansCommission.counter_offer.amount_low);
    expect(analysis.estimate.lines.map((line) => line.label)).toEqual(sansCommission.estimate.lines.map((line) => line.label));
  });

  it("recherche exhaustive : aucun montant n'apparaît jamais à côté d'un taux", () => {
    const textes = [
      ...analysis.negotiate.flatMap((point) => [point.label, point.why]),
      ...analysis.red_flags.flatMap((flag) => [flag.label, flag.why]),
      analysis.ready_to_send_message.text,
      ...analysis.counter_offer.changes,
      ...dealRecapRows(analysis.deal).map((row) => `${row.label} ${row.value}`),
    ];
    // Un pourcentage suivi ou précédé d'un montant à moins de 40 caractères :
    // c'est la forme qu'aurait une estimation de gains.
    const GAIN = /\d+\s*%[^.]{0,40}\d[\d  \s.,]*\s*€|\d[\d  \s.,]*\s*€[^.]{0,40}\d+\s*%/;
    for (const texte of textes) expect(GAIN.test(texte), texte).toBe(false);
  });

  it("une commission PAR VENTE est montrée telle quelle, jamais multipliée", () => {
    const parVente = composeAnalysis(
      affiliation({ variable_pay: { present: true, rate_percent: null, base: null, per_sale_eur: 3, attribution_days: null, payout: null } }),
      { tier: "starter" },
    );
    const row = dealRecapRows(parVente.deal).find((entry) => entry.label === "Commission");
    expect(row?.value.replace(/[  ]/g, " ")).toContain("3 € par vente");
    // Aucun gain estimé, aucune projection : le montant écrit, et rien d'autre.
    expect(row?.value.toLowerCase()).not.toContain("estim");
    expect(row?.value.toLowerCase()).not.toContain("gain");
    expect(row?.value.toLowerCase()).not.toContain("potentiel");
    // Aucun multiple du montant par vente dans la ligne : 3 € par vente ne
    // devient jamais « 300 € ». Le contrôle porte sur la LIGNE, parce que
    // 300 € est par ailleurs une borne légitime de la fourchette.
    const ligne = (row?.value ?? "").replace(/[  \s]/g, "");
    for (const multiple of [30, 100, 300, 3000]) expect(ligne.includes(`${multiple}€`), `${multiple} €`).toBe(false);
    // Et la commission par vente ne se retrouve dans aucun point chiffré.
    for (const point of parVente.negotiate) {
      if (!/commission|attribution|versée/.test(point.label)) continue;
      expect(point.eur_impact_low, point.label).toBeNull();
      expect(point.eur_impact_high, point.label).toBeNull();
    }
  });

  it("le code lui-même ne multiplie jamais un taux par un montant", () => {
    const source = readFileSync("lib/negotiation/commission.ts", "utf8");
    expect(source).not.toContain("rate_percent *");
    expect(source).not.toContain("* pay.rate_percent");
    expect(source).not.toContain("per_sale_eur *");
    // Le seul chiffre autorisé est celui de la création.
    expect(source).toContain("formatEurRange(baseLow, baseHigh)");
  });
});

// ─── D — le message porte les nouveaux points ───────────────────────────────

describe("D — la règle de couverture de #115 s'applique aux nouveaux points", () => {
  it("les cinq points ont un sujet reconnu par le détecteur", () => {
    const analysis = composeAnalysis(affiliation());
    for (const point of analysis.negotiate) {
      expect(topicsOf(point.label).length, point.label).toBeGreaterThan(0);
    }
  });

  it("le message couvre tous les points, et porte le chiffre du fixe", () => {
    const analysis = composeAnalysis(affiliation(), { tier: "starter" });
    const text = analysis.ready_to_send_message.text;
    expect(messageCoverage(analysis, text).ok).toBe(true);
    expect(text.replace(/[  ]/g, " ")).toContain("entre 300 € et 620 €");
  });
});

// ─── Mission #117 — ne demander que ce que l'offre ne dit pas ───────────────

describe("#117 — chaque point suit le champ qui lui correspond", () => {
  // Les quatre libellés conditionnés à un champ. Le cinquième, celui des
  // publicités, ne l'est pas : cette information n'est jamais écrite.
  const TAUX = "Faire écrire combien te rapporte chaque vente";
  const ASSIETTE = "Faire écrire sur quoi porte le pourcentage";
  const ATTRIBUTION = "Faire écrire combien de temps une vente reste rattachée à ton code";
  const VERSEMENT = "Faire écrire quand la commission est versée, et à partir de quel seuil";
  const PUBS = "Vérifier que les publicités de la marque n'annulent pas ton attribution";
  const CONDITIONNES = [TAUX, ASSIETTE, ATTRIBUTION, VERSEMENT];

  const avec = (pay: Partial<Analysis["deal"]["variable_pay"]>, over: Partial<Extraction["deal"]> = {}) =>
    composeAnalysis(affiliation({ variable_pay: { present: true, rate_percent: null, base: null, per_sale_eur: null, attribution_days: null, payout: null, ...pay }, ...over }), {
      tier: "starter",
    });

  // 1 — l'offre réelle du 24/09 : elle précise TOUT.
  it("offre entièrement renseignée : aucun des quatre points, seul celui des publicités reste", () => {
    const analysis = avec({ rate_percent: 15, base: "montant HT hors frais de port", attribution_days: 30, payout: "le 15 du mois suivant, à partir de 50 € cumulés" });
    const list = labels(analysis);
    for (const point of CONDITIONNES) expect(list, point).not.toContain(point);
    expect(list).toContain(PUBS);
  });

  it("… et sans droits pub payante, il ne reste aucun point de commission", () => {
    const analysis = avec(
      { rate_percent: 15, base: "montant HT", attribution_days: 30, payout: "mensuel dès 50 €" },
      { usage: { organic: true, paid_ads: false, whitelisting: false, spark_ads: false, perpetual: false, duration_months: null, territory: null } },
    );
    const list = labels(analysis);
    for (const point of [...CONDITIONNES, PUBS]) expect(list, point).not.toContain(point);
  });

  // 2 — partiellement renseignée : taux et versement écrits, le reste non.
  it("offre partiellement renseignée : exactement assiette et attribution", () => {
    const analysis = avec({ rate_percent: 15, base: null, attribution_days: null, payout: "le 15 du mois suivant" });
    const list = labels(analysis);
    expect(list).toContain(ASSIETTE);
    expect(list).toContain(ATTRIBUTION);
    expect(list).not.toContain(TAUX);
    expect(list).not.toContain(VERSEMENT);
    // Le point assiette NE REDEMANDE PAS le taux : il le reprend pour poser la
    // question, il ne le réclame pas.
    const assiette = analysis.negotiate.find((point) => point.label === ASSIETTE);
    expect(assiette?.why.replace(/[\u202f\u00a0]/g, " ")).toContain("15 % de quoi ?");
    expect(assiette?.label).not.toContain("taux");
    expect(assiette?.why).not.toContain("demande le pourcentage");
  });

  it("une commission par vente en euros tient lieu de taux", () => {
    const list = labels(avec({ per_sale_eur: 3, base: "prix de vente" }));
    expect(list).not.toContain(TAUX);
    expect(list).not.toContain(ASSIETTE);
  });

  // 3 — aucune précision : les quatre points.
  it("offre sans aucune précision : les quatre points apparaissent", () => {
    const list = labels(avec({}));
    for (const point of CONDITIONNES) expect(list, point).toContain(point);
    expect(list).toContain(PUBS);
    // Sans taux écrit, le point assiette pose la question sans chiffre.
    const assiette = avec({}).negotiate.find((point) => point.label === ASSIETTE);
    expect(assiette?.why).toContain("Un pourcentage de quoi ?");
  });

  it("chaque champ, un par un : il suffit qu'il soit écrit pour que son point disparaisse", () => {
    const cas: Array<[Partial<Analysis["deal"]["variable_pay"]>, string]> = [
      [{ rate_percent: 15 }, TAUX],
      [{ per_sale_eur: 2 }, TAUX],
      [{ base: "prix de vente" }, ASSIETTE],
      [{ attribution_days: 30 }, ATTRIBUTION],
      [{ payout: "mensuel" }, VERSEMENT],
    ];
    for (const [pay, disparu] of cas) {
      const list = labels(avec(pay));
      expect(list, `${JSON.stringify(pay)} → ${disparu}`).not.toContain(disparu);
      // Les autres, eux, restent : un champ écrit n'en masque pas un autre.
      for (const autre of CONDITIONNES) {
        if (autre === disparu) continue;
        if (disparu === TAUX && autre === ASSIETTE && pay.base !== undefined) continue;
        expect(list, `${JSON.stringify(pay)} → ${autre}`).toContain(autre);
      }
    }
  });

  // 4 — aucune commission : rien de tout cela.
  it("offre sans commission : aucun de ces points, comme avant", () => {
    const list = labels(composeAnalysis(base(), { tier: "starter" }));
    for (const point of [...CONDITIONNES, PUBS]) expect(list, point).not.toContain(point);
  });

  it("l'outil ne contredit jamais ce qu'il vient de lire", () => {
    // Pour chaque champ écrit, aucun texte affiché ne doit dire qu'il manque.
    const analysis = avec({ rate_percent: 15, base: "montant HT hors frais de port", attribution_days: 30, payout: "le 15 du mois suivant, à partir de 50 € cumulés" });
    const textes = analysis.negotiate.flatMap((point) => [point.label, point.why]).join(" ");
    for (const demande of ["sans assiette écrite", "sans ce nombre écrit", "ne dit pas à quelle date le versement tombe", "sans dire ce qu'elle rapporte"]) {
      expect(textes, demande).not.toContain(demande);
    }
  });
});
