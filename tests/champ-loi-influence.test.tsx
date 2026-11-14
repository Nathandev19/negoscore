import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LegalNotice } from "@/components/result/analysis-blocks";
import { computeFrLegal, diffusionDe, hasRightsTransfer, legalNoticeView } from "@/lib/legal/fr";
import sampleExtraction from "@/lib/fixtures/sample-extraction.json";
import { analysisSchema, type Analysis } from "@/lib/schema";

// Mission #214 — LE PRODUIT AFFIRMAIT UNE OBLIGATION LÉGALE SANS SA CONDITION
// D'APPLICATION.
//
// L'obligation de contrat écrit au-delà de 1 000 € HT vient de la loi du
// 9 juin 2023 sur l'influence commerciale, dont l'article 1er n'ouvre le champ
// qu'aux personnes qui mobilisent leur notoriété auprès de leur audience. Une
// prestation d'UGC pur — la marque diffuse, le créateur ne publie rien — sort
// de ce champ. Le produit l'affirmait pourtant pour tous les deals, l'offre
// d'exemple comprise.
//
// Ce qui reste vrai partout : l'article L131-3 du Code de la propriété
// intellectuelle, sans condition de notoriété et sans seuil de montant.

type Deal = Analysis["deal"];

const BASE: Deal = analysisSchema.shape.deal.parse((sampleExtraction as { deal: unknown }).deal);

const deal = (patch: Partial<Deal>): Deal => ({ ...BASE, ...patch });
const usage = (patch: Partial<Deal["usage"]>): Deal["usage"] => ({ ...BASE.usage, ...patch });

// Aucun canal déclaré : ni publication du créateur, ni diffusion par la marque.
const RIEN_DECLARE = usage({ organic: false, paid_ads: false, whitelisting: false, spark_ads: false });

const AU_DESSUS: Deal["payment"] = { amount_eur: 2400, currency: "EUR", terms_days: 30, schedule: null };

describe("le mode de diffusion, lu sur ce que le modèle extrait déjà", () => {
  it("publication demandée sur le compte du créateur : le champ de la loi est réuni", () => {
    expect(diffusionDe(deal({ publication_required: true }))).toBe("createur");
    // Même quand la marque diffuse aussi de son côté : la notoriété EST
    // mobilisée auprès de l'audience du créateur.
    expect(diffusionDe(deal({ publication_required: true, usage: usage({ organic: true, paid_ads: true }) }))).toBe("createur");
  });

  it("aucune publication demandée et la marque diffuse seule : hors du champ", () => {
    expect(diffusionDe(deal({ publication_required: false, usage: usage({ organic: true, paid_ads: false }) }))).toBe("marque");
    expect(diffusionDe(deal({ publication_required: false, usage: usage({ organic: false, paid_ads: true }) }))).toBe("marque");
  });

  it("rien de déclaré : « inconnu », parce que `publication_required: false` ne dit pas « non »", () => {
    // Le prompt dit « true seulement si le créateur doit publier sur son
    // propre compte » : false confond « l'offre dit non » et « l'offre n'en
    // parle pas ». Sans diffusion par la marque écrite POSITIVEMENT, le
    // produit n'a rien pour trancher.
    expect(diffusionDe(deal({ publication_required: false, usage: RIEN_DECLARE }))).toBe("inconnu");
  });

  it("marquage blanc et Spark Ads : « inconnu », jamais rangés d'office d'un côté", () => {
    // La publicité part du compte du créateur, ou pousse une publication du
    // créateur : ce ne sont pas « exclusivement les canaux de la marque », et
    // ce n'est pas une publication du créateur établie. Trancher demanderait
    // une base que la mission ne donne pas.
    expect(diffusionDe(deal({ publication_required: false, usage: usage({ whitelisting: true }) }))).toBe("inconnu");
    expect(diffusionDe(deal({ publication_required: false, usage: usage({ spark_ads: true }) }))).toBe("inconnu");
  });
});

describe("l'obligation de contrat écrit ne s'affirme que dans le champ de la loi", () => {
  const avecPublication = computeFrLegal(deal({ publication_required: true, payment: AU_DESSUS }));
  const marqueSeule = computeFrLegal(deal({ publication_required: false, usage: usage({ organic: true }), payment: AU_DESSUS }));
  const doute = computeFrLegal(deal({ publication_required: false, usage: RIEN_DECLARE, payment: AU_DESSUS }));

  it("champ réuni : l'obligation est affirmée, avec le seuil et le décret qui le fixe", () => {
    expect(avecPublication.diffusion).toBe("createur");
    expect(avecPublication.written_contract_required).toBe(true);
    expect(avecPublication.note).toContain("un contrat écrit est obligatoire au-delà de");
    expect(avecPublication.note).toContain("décret");
    expect(avecPublication.note).toContain("2025-1137");
    expect(avecPublication.note).toContain("demande un contrat écrit avant de commencer");
  });

  it("hors champ : l'obligation N'est PAS affirmée, et la sortie du champ est dite", () => {
    expect(marqueSeule.diffusion).toBe("marque");
    expect(marqueSeule.written_contract_required).toBe(false);
    expect(marqueSeule.note).toContain("sort donc du champ de cette loi");
    expect(marqueSeule.note).not.toContain("est obligatoire au-delà de");
    expect(marqueSeule.note).not.toContain("demande un contrat écrit avant de commencer");
  });

  it("doute : « peut être obligatoire », et jamais une affirmation ferme", () => {
    expect(doute.diffusion).toBe("inconnu");
    expect(doute.written_contract_required).toBe(false);
    expect(doute.note).toContain("selon la façon dont les vidéos seront diffusées");
    expect(doute.note).toContain("un contrat écrit peut être obligatoire");
    expect(doute.note).not.toContain("est obligatoire au-delà de");
    expect(doute.note).not.toContain("sort donc du champ");
  });

  it("le seuil reste un fait sur le MONTANT : il est atteint dans les trois branches", () => {
    // C'est bien la condition d'entrée qui change le verdict, pas le calcul du
    // montant : si le seuil tombait avec le champ, le défaut serait seulement
    // déplacé.
    for (const legal of [avecPublication, marqueSeule, doute]) {
      expect(legal.threshold_1000_reached).toBe("yes");
    }
  });

  it("aucun montant, aussi grand qu'il soit, n'ouvre l'obligation hors du champ", () => {
    for (const montant of [1000, 5000, 100000]) {
      const hors = computeFrLegal(
        deal({
          publication_required: false,
          usage: usage({ organic: true }),
          payment: { amount_eur: montant, currency: "EUR", terms_days: 30, schedule: null },
        }),
      );
      expect(hors.written_contract_required, String(montant)).toBe(false);
    }
  });
});

describe("point 4 — la gravité des constats suit la base qui les porte", () => {
  it("les sept mentions du contrat écrit ne s'annoncent que dans le champ de la loi", () => {
    const creux = { brand: null, deliverables: [], payment: { amount_eur: null, currency: "EUR", terms_days: null, schedule: null } };
    const dedans = computeFrLegal(deal({ ...creux, publication_required: true }));
    const dehors = computeFrLegal(deal({ ...creux, publication_required: false, usage: usage({ organic: true }) }));
    const doute = computeFrLegal(deal({ ...creux, publication_required: false, usage: RIEN_DECLARE }));

    expect(dedans.missing_mandatory_clauses).toContain("Identification des parties");
    expect(dedans.missing_mandatory_clauses.length).toBeGreaterThan(2);
    // Hors du champ et dans le doute, les annoncer « absentes » refabriquerait
    // l'affirmation sans sa condition, un cran plus bas.
    expect(dehors.missing_mandatory_clauses).toEqual([]);
    expect(doute.missing_mandatory_clauses).toEqual([]);
  });
});

describe("point 3 — le volet L131-3, dans TOUS les cas de cession", () => {
  const sansRien = { usage: usage({ organic: false, paid_ads: false, whitelisting: false, spark_ads: false, duration_months: null, territory: null, territory_zones: [] }) };

  it("il est là quelle que soit la branche, et quel que soit le montant", () => {
    for (const patch of [
      { publication_required: true },
      { publication_required: false, usage: usage({ organic: true }) },
      { publication_required: false, usage: RIEN_DECLARE },
    ]) {
      const legal = computeFrLegal(deal({ ...patch, payment: { amount_eur: 50, currency: "EUR", terms_days: 30, schedule: null } }));
      expect(legal.rights_transfer, JSON.stringify(patch)).toBe(true);
      expect(legal.note).toContain("l'article L131-3 du Code de la propriété intellectuelle");
      expect(legal.note).toContain("une mention distincte dans l'acte");
      expect(legal.note).toContain("quant à son étendue et à sa destination, quant au lieu et quant à la durée");
    }
  });

  it("« unclear » est une cession : c'est même le cas où tout manque", () => {
    expect(hasRightsTransfer(deal({ ip_transfer: "unclear" }))).toBe(true);
    expect(hasRightsTransfer(deal({ ip_transfer: "license" }))).toBe(true);
    expect(hasRightsTransfer(deal({ ip_transfer: "full_assignment" }))).toBe(true);
    // Aucune utilisation prévue : rien à délimiter, donc pas de volet.
    expect(hasRightsTransfer(deal({ ip_transfer: "none" }))).toBe(false);
    const aucune = computeFrLegal(deal({ ip_transfer: "none" }));
    expect(aucune.rights_transfer).toBe(false);
    expect(aucune.missing_rights_clauses).toEqual([]);
    expect(aucune.note).not.toContain("L131-3");
  });

  it("les quatre points sont ceux que l'article nomme, et chacun se déclenche seul", () => {
    const tout = computeFrLegal(deal({ ip_transfer: "unclear", ...sansRien }));
    expect(tout.missing_rights_clauses).toEqual([
      "Mention distincte de chacun des droits cédés",
      "Étendue et destination de l'exploitation (supports et usages)",
      "Lieu de l'exploitation (territoire)",
      "Durée de l'exploitation",
    ]);

    // Chaque point disparaît dès que l'offre l'écrit, et lui seul.
    expect(computeFrLegal(deal({ ip_transfer: "license", ...sansRien })).missing_rights_clauses).not.toContain(
      "Mention distincte de chacun des droits cédés",
    );
    expect(
      computeFrLegal(deal({ ip_transfer: "unclear", usage: { ...sansRien.usage, paid_ads: true } })).missing_rights_clauses,
    ).not.toContain("Étendue et destination de l'exploitation (supports et usages)");
    expect(
      computeFrLegal(deal({ ip_transfer: "unclear", usage: { ...sansRien.usage, territory: "France" } })).missing_rights_clauses,
    ).not.toContain("Lieu de l'exploitation (territoire)");
    expect(
      computeFrLegal(deal({ ip_transfer: "unclear", usage: { ...sansRien.usage, territory_zones: ["france"] } })).missing_rights_clauses,
    ).not.toContain("Lieu de l'exploitation (territoire)");
    expect(
      computeFrLegal(deal({ ip_transfer: "unclear", usage: { ...sansRien.usage, duration_months: 6 } })).missing_rights_clauses,
    ).not.toContain("Durée de l'exploitation");
    // « Sans limitation de durée » EST une durée écrite : elle ne manque pas.
    expect(
      computeFrLegal(deal({ ip_transfer: "unclear", usage: { ...sansRien.usage, perpetual: true } })).missing_rights_clauses,
    ).not.toContain("Durée de l'exploitation");
  });
});

describe("l'écran : deux listes, un seul résumé, et le compte qui tient", () => {
  const puces = (html: string) => [...html.matchAll(/<li[^>]*>(.*?)<\/li>/g)].map((match) => match[1]);
  const lisible = (html: string) => html.replaceAll("&#x27;", "'");

  it("le nombre annoncé reste égal au nombre de puces, SOMME des deux listes", () => {
    // L'invariant des missions #104 et #115, qu'une deuxième liste pouvait
    // casser en silence : le résumé décrivait une liste, l'écran en rendait
    // deux.
    for (const patch of [
      { publication_required: true, ip_transfer: "unclear" as const },
      { publication_required: true, ip_transfer: "none" as const },
      { publication_required: false, usage: usage({ organic: true }), ip_transfer: "unclear" as const },
      { publication_required: false, usage: RIEN_DECLARE, ip_transfer: "license" as const },
      { publication_required: false, usage: usage({ organic: true }), ip_transfer: "none" as const },
    ]) {
      const legal = computeFrLegal(deal({ brand: null, ...patch }));
      const vue = legalNoticeView(legal);
      const html = renderToStaticMarkup(<LegalNotice legal={legal} />);
      const rendues = puces(html);
      expect(rendues.length, JSON.stringify(patch)).toBe(vue.clauses.length + vue.rights.length);
      for (const puce of rendues) expect(puce.trim()).not.toBe("");
      const annonce = lisible(html).match(/(\d+) (?:mentions? obligatoires?|points? à obtenir)/g) ?? [];
      const total = annonce.reduce((somme, bout) => somme + Number(bout.match(/\d+/)![0]), 0);
      if (rendues.length > 1) expect(total, JSON.stringify(patch)).toBe(rendues.length);
    }
  });

  it("les deux listes pleines : le résumé les annonce toutes les deux, dans une seule phrase", () => {
    // Le cas qui casserait l'invariant s'il n'était pas traité : si le résumé
    // n'annonçait que la première liste, l'écran rendrait plus de puces qu'il
    // n'en annonce — exactement le défaut des missions #104 et #115.
    const legal = computeFrLegal(
      deal({
        brand: null,
        publication_required: true,
        ip_transfer: "unclear",
        usage: usage({ duration_months: null, territory: null, territory_zones: [] }),
      }),
    );
    const vue = legalNoticeView(legal);
    expect(vue.clauses.length).toBeGreaterThan(0);
    expect(vue.rights.length).toBeGreaterThan(0);
    expect(vue.hint).toContain(`${vue.clauses.length} mentions obligatoires absentes de l'offre, et`);
    expect(vue.hint).toContain(`${vue.rights.length} points à obtenir sur la cession de droits.`);
  });

  it("le volet L131-3 est rendu sous son propre titre, avec ses puces", () => {
    const legal = computeFrLegal(
      deal({
        publication_required: false,
        usage: usage({ organic: true, duration_months: null, territory: null, territory_zones: [] }),
        ip_transfer: "unclear",
      }),
    );
    const html = lisible(renderToStaticMarkup(<LegalNotice legal={legal} />));
    expect(html).toContain("Cession de droits — ce que l'offre ne délimite pas");
    expect(html).toContain("Lieu de l'exploitation (territoire)");
    // Et pas le titre des mentions du contrat écrit, qui n'a pas lieu d'être.
    expect(html).not.toContain("Mentions absentes de l'offre");
  });

  it("une entrée invisible du volet L131-3 n'est ni comptée ni affichée", () => {
    // Même règle que #104/#115 : le filtre couvre les DEUX listes.
    const legal = computeFrLegal(deal({ publication_required: true, ip_transfer: "unclear" }));
    const vue = legalNoticeView({ ...legal, missing_rights_clauses: ["Durée de l'exploitation", "   ", "\u2063", "\ufeff"] });
    expect(vue.rights).toEqual(["Durée de l'exploitation"]);
    expect(vue.hint).toContain("1 point à obtenir sur la cession de droits");
  });
});

describe("aucune référence que les trois fournies", () => {
  const source = readFileSync("lib/legal/fr.ts", "utf8");

  it("les seules références du fichier sont la loi de 2023, son décret et L131-3", () => {
    const articles = [...new Set(source.match(/\bL\d{3}-\d+/g) ?? [])];
    expect(articles).toEqual(["L131-3"]);
    const numeros = [...new Set(source.match(/\d{4}-\d{3,4}/g) ?? [])];
    expect(numeros.sort()).toEqual(["2023-451", "2025-1137"]);
    const dates = [...new Set(source.match(/\d{1,2}(?:er)? [a-zà-ÿ]+ (?:19|20)\d\d/gi) ?? [])];
    expect(dates.sort()).toEqual(["1er janvier 2026", "9 juin 2023"]);
  });

  it("ni code ni juridiction inventés", () => {
    for (const interdit of [/code de commerce/i, /code civil/i, /code de la consommation/i, /RGPD/, /article\s+\d+\s+du\s+code/i]) {
      expect(source, String(interdit)).not.toMatch(interdit);
    }
  });

  it("les montants et le numéro de décret ne se coupent pas en fin de ligne", () => {
    const note = computeFrLegal(deal({ publication_required: true, payment: AU_DESSUS })).note;
    expect(note).toContain("1\u202f000\u00a0€\u00a0HT");
    expect(note).toContain("décret n°\u00a02025-1137");
    expect(note).toContain("1er\u00a0janvier 2026");
  });
});

describe("une analyse enregistrée avant cette mission", () => {
  it("se relit sans erreur, en « inconnu », et n'affiche pas de volet qu'elle n'a pas relevé", () => {
    const stored = {
      applicable: true,
      threshold_1000_reached: "yes",
      written_contract_required: true,
      missing_mandatory_clauses: ["Modalités de paiement"],
      note: "En France, un contrat écrit est obligatoire quand une collaboration dépasse 1 000 € HT.",
    };
    const parsed = analysisSchema.shape.fr_legal.safeParse(stored);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    // « inconnu » : elle n'a pas relevé la diffusion, donc on ne la connaît
    // pas. Rien de plus, rien de moins.
    expect(parsed.data.diffusion).toBe("inconnu");
    expect(parsed.data.rights_transfer).toBe(false);
    expect(parsed.data.missing_rights_clauses).toEqual([]);
    const html = renderToStaticMarkup(<LegalNotice legal={parsed.data} />);
    expect(html).not.toContain("Cession de droits");
    // Sa note est le texte enregistré le jour de l'analyse : on ne réécrit pas
    // une mesure. computeFrLegal la réécrit dès qu'un recalcul passe.
    expect(html).toContain("En France, un contrat");
  });
});

describe("droit étranger : rien n'est affirmé, dans aucune branche", () => {
  it("la vérification française ne s'applique pas, et aucune liste ne sort", () => {
    const legal = computeFrLegal(
      deal({ publication_required: true, ip_transfer: "unclear", governing_law: "Droit de l'État de New York", payment: AU_DESSUS }),
    );
    expect(legal.applicable).toBe(false);
    expect(legal.written_contract_required).toBe(false);
    expect(legal.rights_transfer).toBe(false);
    expect(legal.missing_mandatory_clauses).toEqual([]);
    expect(legal.missing_rights_clauses).toEqual([]);
    expect(legal.note).not.toContain("L131-3");
    expect(legal.note).not.toContain("9 juin 2023");
    // Le bloc entier ne s'affiche pas.
    expect(renderToStaticMarkup(<LegalNotice legal={legal} />)).toBe("");
  });
});
