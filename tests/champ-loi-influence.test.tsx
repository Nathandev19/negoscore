import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LegalNotice } from "@/components/result/analysis-blocks";
import { composeAnalysis } from "@/lib/analysis/compose";
import { normalizeDeal } from "@/lib/analysis/normalize";
import {
  computeFrLegal,
  diffusionDe,
  hasRightsTransfer,
  legalNoticeView,
  SEUIL_ASSIETTE,
  SEUIL_CE_QUE_LE_PRODUIT_COMPTE,
} from "@/lib/legal/fr";
import { extractionJsonSchema, extractionSchema, SYSTEM_PROMPT } from "@/lib/llm/prompt";
import sampleExtraction from "@/lib/fixtures/sample-extraction.json";
import { analysisSchema, type Analysis } from "@/lib/schema";

// Mission #214 — LE PRODUIT AFFIRMAIT UNE OBLIGATION LÉGALE SANS SA CONDITION
// D'APPLICATION. Mission #215 — ET IL LA DÉDUISAIT D'UN BOOLÉEN AMBIGU.
//
// L'obligation de contrat écrit à partir de 1 000 € HT vient de la loi du
// 9 juin 2023 sur l'influence commerciale, dont l'article 1er n'ouvre le champ
// qu'aux personnes qui mobilisent leur notoriété auprès de leur audience. Une
// prestation d'UGC pur — la marque diffuse, le créateur ne publie rien — sort
// de ce champ. Le produit l'affirmait pourtant pour tous les deals.
//
// La #214 lisait le champ sur `publication_required` et les drapeaux d'usage,
// faute d'un champ explicite. La #215 le lit sur `deal.diffusion`, trois
// valeurs rendues par le modèle, et sur lui seul. Elle ajoute aussi les deux
// conditions qui manquaient : l'assiette du seuil telle que le décret l'écrit,
// et le seuil comme condition des sept mentions.
//
// Ce qui reste vrai partout : l'article L131-3 du Code de la propriété
// intellectuelle, sans condition de notoriété et sans seuil de montant.

type Deal = Analysis["deal"];

const BASE: Deal = analysisSchema.shape.deal.parse((sampleExtraction as { deal: unknown }).deal);

// Même utilitaire que tests/legal.test.ts : tous les fichiers d'un dossier,
// récursivement, pour qu'une garde ne puisse pas rater un fichier ajouté après
// elle.
function filesIn(dir: string): string[] {
  return readdirSync(path.join(process.cwd(), dir), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name));
}

const deal = (patch: Partial<Deal>): Deal => ({ ...BASE, ...patch });
const usage = (patch: Partial<Deal["usage"]>): Deal["usage"] => ({ ...BASE.usage, ...patch });

const AU_DESSUS: Deal["payment"] = { amount_eur: 2400, currency: "EUR", terms_days: 30, schedule: null };
const SOUS_LE_SEUIL: Deal["payment"] = { amount_eur: 300, currency: "EUR", terms_days: 30, schedule: null };

describe("mission #215 — le mode de diffusion est EXTRAIT, en trois valeurs", () => {
  it("le modèle doit rendre les trois valeurs, et ne peut pas omettre le champ", () => {
    const schema = extractionJsonSchema() as Record<string, unknown>;
    const properties = (schema.properties as Record<string, { properties: Record<string, unknown>; required: string[] }>).deal;
    // `strictify` met toutes les propriétés dans `required` : le modèle doit
    // rendre une valeur, il ne peut pas laisser le champ de côté.
    expect(properties.required).toContain("diffusion");
    const champ = properties.properties.diffusion as { enum: string[]; default?: string };
    expect(champ.enum).toEqual(["creator", "brand_only", "unspecified"]);
    // Le schéma de zod porte une valeur par défaut, qui sert à RELIRE les
    // analyses d'avant la #215, et `z.toJSONSchema` la recopie (huit champs du
    // schéma sont dans ce cas, dont `variable_pay.present` depuis la #116). Ce
    // qu'on exige ici : si elle est recopiée, elle ne tranche RIEN. Un défaut à
    // « creator » ou « brand_only » déciderait à la place du modèle.
    expect(champ.default ?? "unspecified").toBe("unspecified");
  });

  it("le prompt nomme les trois cas, et dit que « l'offre ne le dit pas » n'est pas un échec", () => {
    expect(SYSTEM_PROMPT).toContain("- diffusion :");
    expect(SYSTEM_PROMPT).toContain('"unspecified" si l\'offre ne dit pas qui diffuse');
    expect(SYSTEM_PROMPT).toContain('"unspecified" n\'est pas un échec');
    // Et il interdit la déduction qui a produit le défaut de la #214.
    expect(SYSTEM_PROMPT).toContain("Ne le déduis jamais du contenu demandé");
    expect(SYSTEM_PROMPT).toContain('Si publication_required est true, diffusion est "creator"');
  });

  it("une analyse enregistrée avant la #215 se relit en « l'offre ne le dit pas »", () => {
    const sans = { ...(sampleExtraction as { deal: Record<string, unknown> }).deal };
    delete sans.diffusion;
    const parsed = analysisSchema.shape.deal.safeParse(sans);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.diffusion).toBe("unspecified");
    // Et la valeur par défaut ne tranche donc rien : elle tombe dans le doute.
    expect(diffusionDe(parsed.data)).toBe("inconnu");
  });
});

describe("le champ de la loi se lit sur `deal.diffusion`, et sur lui seul", () => {
  it("« creator » : le champ de la loi est réuni", () => {
    expect(diffusionDe(deal({ diffusion: "creator" }))).toBe("createur");
    // Même quand la marque diffuse aussi de son côté : la notoriété EST
    // mobilisée auprès de l'audience du créateur.
    expect(diffusionDe(deal({ diffusion: "creator", usage: usage({ organic: true, paid_ads: true }) }))).toBe("createur");
  });

  it("« brand_only » : hors du champ", () => {
    expect(diffusionDe(deal({ diffusion: "brand_only" }))).toBe("marque");
  });

  it("« unspecified » : le doute, et AUCUN drapeau d'usage ne le lève", () => {
    // C'est le défaut que la #215 corrige : la #214 fabriquait « marque » dès
    // qu'un drapeau d'usage était levé, donc une sortie du champ que l'offre
    // n'écrivait pas. Une affirmation ferme sur une base incertaine, en sens
    // inverse de celle de la #214.
    expect(diffusionDe(deal({ diffusion: "unspecified" }))).toBe("inconnu");
    for (const flags of [{ organic: true }, { paid_ads: true }, { organic: true, paid_ads: true }]) {
      expect(diffusionDe(deal({ diffusion: "unspecified", usage: usage(flags) })), JSON.stringify(flags)).toBe("inconnu");
    }
  });

  it("`publication_required` ne porte plus la condition juridique", () => {
    // Le booléen reste (chiffrage, récapitulatif, termes d'un tour), mais son
    // `false` confond « l'offre dit non » et « l'offre n'en parle pas » : il ne
    // décide plus rien ici.
    expect(diffusionDe(deal({ publication_required: true, diffusion: "unspecified" }))).toBe("inconnu");
    expect(diffusionDe(deal({ publication_required: false, diffusion: "creator" }))).toBe("createur");
  });

  it("marquage blanc et Spark Ads : toujours « inconnu »", () => {
    // Inchangé depuis la #214. La publicité part du compte du créateur, ou
    // pousse une publication du créateur : ce ne sont ni « exclusivement les
    // canaux de la marque », ni une publication établie.
    expect(diffusionDe(deal({ diffusion: "brand_only", usage: usage({ whitelisting: true }) }))).toBe("inconnu");
    expect(diffusionDe(deal({ diffusion: "brand_only", usage: usage({ spark_ads: true }) }))).toBe("inconnu");
    // Une publication explicitement demandée l'emporte quand même.
    expect(diffusionDe(deal({ diffusion: "creator", usage: usage({ whitelisting: true }) }))).toBe("createur");
  });

  it("le chemin complet : une publication demandée arrive bien dans le champ", () => {
    // `normalizeDeal` rend `diffusion` cohérent avec `publication_required`
    // dans UN sens (voir tests/normalize.test.ts), et composeAnalysis
    // normalise : les deux ne peuvent donc pas se contredire à l'écran.
    const extraction = extractionSchema.parse({
      ...sampleExtraction,
      deal: { ...BASE, publication_required: true, diffusion: "unspecified", payment: AU_DESSUS },
      negotiate: [],
      counter_offer: { changes: [] },
    });
    expect(composeAnalysis(extraction).fr_legal.diffusion).toBe("createur");
    expect(normalizeDeal(deal({ publication_required: true, diffusion: "brand_only" })).diffusion).toBe("creator");
  });
});

describe("l'obligation de contrat écrit ne s'affirme que dans le champ de la loi", () => {
  const dedans = computeFrLegal(deal({ diffusion: "creator", payment: AU_DESSUS }));
  const marqueSeule = computeFrLegal(deal({ diffusion: "brand_only", payment: AU_DESSUS }));
  const doute = computeFrLegal(deal({ diffusion: "unspecified", payment: AU_DESSUS }));

  it("champ réuni : l'obligation est affirmée, avec le seuil et le décret qui le fixe", () => {
    expect(dedans.diffusion).toBe("createur");
    expect(dedans.written_contract_required).toBe(true);
    expect(dedans.note).toContain("un contrat écrit est obligatoire à partir de");
    expect(dedans.note).toContain("2025-1137");
    expect(dedans.note).toContain("28\u00a0novembre 2025");
    expect(dedans.note).toContain("demande un contrat écrit avant de commencer");
  });

  it("hors champ : l'obligation N'est PAS affirmée, et la sortie du champ est dite", () => {
    expect(marqueSeule.diffusion).toBe("marque");
    expect(marqueSeule.written_contract_required).toBe(false);
    expect(marqueSeule.note).toContain("sort donc du champ de cette loi");
    expect(marqueSeule.note).not.toContain("est obligatoire à partir de");
    expect(marqueSeule.note).not.toContain("demande un contrat écrit avant de commencer");
  });

  it("doute : « peut être obligatoire », et jamais une affirmation ferme", () => {
    expect(doute.diffusion).toBe("inconnu");
    expect(doute.written_contract_required).toBe(false);
    expect(doute.note).toContain("L'offre ne dit pas qui diffuse");
    expect(doute.note).toContain("un contrat écrit peut être obligatoire");
    expect(doute.note).not.toContain("est obligatoire à partir de");
    expect(doute.note).not.toContain("sort donc du champ");
  });

  it("le seuil reste un fait sur le MONTANT : il est atteint dans les trois branches", () => {
    // C'est bien la condition d'entrée qui change le verdict, pas le calcul du
    // montant : si le seuil tombait avec le champ, le défaut serait seulement
    // déplacé.
    for (const legal of [dedans, marqueSeule, doute]) {
      expect(legal.threshold_1000_reached).toBe("yes");
    }
  });

  it("aucun montant, aussi grand qu'il soit, n'ouvre l'obligation hors du champ", () => {
    for (const montant of [1000, 5000, 100000]) {
      const hors = computeFrLegal(
        deal({ diffusion: "brand_only", payment: { amount_eur: montant, currency: "EUR", terms_days: 30, schedule: null } }),
      );
      expect(hors.written_contract_required, String(montant)).toBe(false);
    }
  });

  it("1 000 € pile ATTEINT le seuil : l'article 8, II exonère ce qui est INFÉRIEUR", () => {
    const pile = computeFrLegal(
      deal({ diffusion: "creator", payment: { amount_eur: 1000, currency: "EUR", terms_days: 30, schedule: null } }),
    );
    expect(pile.threshold_1000_reached).toBe("yes");
    expect(pile.written_contract_required).toBe(true);
    // D'où « à partir de » et non « au-delà de » : la formulation de la #214
    // disait le contraire du calcul, qui lui n'a pas changé.
    expect(pile.note).toContain("à partir de");
    expect(pile.note).not.toContain("au-delà de");
  });
});

describe("mission #215, point 1 — l'assiette du seuil, sur les termes du décret", () => {
  const note = computeFrLegal(deal({ diffusion: "creator", payment: AU_DESSUS })).note;

  it("les quatre éléments de l'article 1er y sont, et il faut les quatre", () => {
    for (const element of [
      // la SOMME des rémunérations ET de la valeur des avantages en nature
      "la somme des rémunérations versées et de la valeur des avantages en nature",
      // entre UN influenceur et UN annonceur
      "accordés à un influenceur par un annonceur",
      // au cours de la MÊME ANNÉE
      "au cours de la même année",
      // pour des prestations poursuivant UN MÊME OBJECTIF PROMOTIONNEL
      "poursuivant un même objectif promotionnel",
    ]) {
      expect(note, element).toContain(element);
    }
  });

  it("« année civile » est interdite dans tout le produit : le décret ne la dit pas", () => {
    // Le décret dit « au cours de la même année », sans dire laquelle. La
    // formulation retirée en #214 l'inventait, et omettait l'objectif
    // promotionnel — deux raisons, pas une.
    //
    // Ni à l'écran, ni dans la source — précédent de la #122 : une formulation
    // abandonnée qui reste lisible dans un fichier se fait relire comme la
    // bonne. La garde balaie donc tout le produit, pas les deux fichiers qu'on
    // a touchés.
    const sources = [...filesIn("app"), ...filesIn("components"), ...filesIn("lib")];
    const fautifs = sources.filter((fichier) => /année civile/i.test(readFileSync(fichier, "utf8")));
    expect(fautifs).toEqual([]);
    expect(note).not.toMatch(/année civile/i);
  });

  it("le produit dit ce qu'il compare, et qu'il ne connaît pas le reste de la campagne", () => {
    // L'assiette est le total PAR OBJECTIF PROMOTIONNEL, et le produit ne voit
    // qu'une offre : il n'affirme donc aucun total annuel.
    expect(note).toContain(SEUIL_CE_QUE_LE_PRODUIT_COMPTE);
    expect(SEUIL_CE_QUE_LE_PRODUIT_COMPTE).toContain("Le produit n'additionne que cette offre");
    expect(SEUIL_CE_QUE_LE_PRODUIT_COMPTE).toContain("le produit ne les connaît pas");
  });

  it("l'assiette est dite dans les deux branches qui opposent le seuil, pas dans l'autre", () => {
    expect(computeFrLegal(deal({ diffusion: "creator", payment: AU_DESSUS })).note).toContain(SEUIL_ASSIETTE);
    expect(computeFrLegal(deal({ diffusion: "unspecified", payment: AU_DESSUS })).note).toContain(SEUIL_ASSIETTE);
    // Hors du champ, aucun seuil n'est opposé : en parler n'aurait pas de sens.
    expect(computeFrLegal(deal({ diffusion: "brand_only", payment: AU_DESSUS })).note).not.toContain(SEUIL_ASSIETTE);
  });
});

describe("mission #215, point 3 — les sept mentions se conditionnent AU SEUIL", () => {
  const creux = {
    brand: null,
    deliverables: [],
    payment: { amount_eur: null, currency: "EUR", terms_days: null, schedule: null },
  };

  it("champ réuni ET seuil atteint : elles s'annoncent", () => {
    const legal = computeFrLegal(deal({ ...creux, diffusion: "creator", in_kind_value_eur: 2400 }));
    expect(legal.threshold_1000_reached).toBe("yes");
    expect(legal.missing_mandatory_clauses).toContain("Identification des parties");
    expect(legal.missing_mandatory_clauses.length).toBeGreaterThan(2);
  });

  it("champ réuni mais SOUS le seuil : elles ne s'annoncent pas", () => {
    // Elles sont le contenu imposé au contrat écrit, et le contrat écrit n'est
    // obligatoire qu'à partir de 1 000 € HT. Les annoncer sous le seuil, c'est
    // le défaut de la #214 déplacé d'un cran.
    const legal = computeFrLegal(deal({ ...creux, diffusion: "creator", payment: SOUS_LE_SEUIL }));
    expect(legal.threshold_1000_reached).toBe("no");
    expect(legal.written_contract_required).toBe(false);
    expect(legal.missing_mandatory_clauses).toEqual([]);
  });

  it("seuil INCONNU : un seuil inconnu n'est pas un seuil atteint", () => {
    const legal = computeFrLegal(deal({ ...creux, diffusion: "creator" }));
    expect(legal.threshold_1000_reached).toBe("unknown");
    expect(legal.missing_mandatory_clauses).toEqual([]);
  });

  it("hors champ et dans le doute, seuil atteint ou non : jamais", () => {
    for (const diffusion of ["brand_only", "unspecified"] as const) {
      for (const payment of [AU_DESSUS, SOUS_LE_SEUIL]) {
        const legal = computeFrLegal(deal({ ...creux, diffusion, payment }));
        expect(legal.missing_mandatory_clauses, `${diffusion} / ${payment.amount_eur}`).toEqual([]);
      }
    }
  });

  it("le drapeau enregistré et la liste affichée ne peuvent plus diverger", () => {
    // Ils sortent du même booléen : une liste annoncée sans obligation, ou une
    // obligation sans sa liste, ne sont plus représentables.
    for (const diffusion of ["creator", "brand_only", "unspecified"] as const) {
      for (const payment of [AU_DESSUS, SOUS_LE_SEUIL, { amount_eur: null, currency: "EUR", terms_days: null, schedule: null }]) {
        const legal = computeFrLegal(deal({ ...creux, diffusion, payment }));
        expect(legal.missing_mandatory_clauses.length > 0, `${diffusion} / ${payment.amount_eur}`).toBe(
          legal.written_contract_required,
        );
      }
    }
  });
});

describe("point 3 de la #214 — le volet L131-3, dans TOUS les cas de cession", () => {
  const sansRien = {
    usage: usage({
      organic: false,
      paid_ads: false,
      whitelisting: false,
      spark_ads: false,
      duration_months: null,
      territory: null,
      territory_zones: [],
    }),
  };

  it("il est là quelle que soit la branche, et quel que soit le montant", () => {
    for (const diffusion of ["creator", "brand_only", "unspecified"] as const) {
      const legal = computeFrLegal(
        deal({ diffusion, payment: { amount_eur: 50, currency: "EUR", terms_days: 30, schedule: null } }),
      );
      expect(legal.rights_transfer, diffusion).toBe(true);
      expect(legal.note).toContain("l'article L131-3 du Code de la propriété intellectuelle");
      expect(legal.note).toContain("une mention distincte dans l'acte");
      expect(legal.note).toContain("quant à son étendue et à sa destination, quant au lieu et quant à la durée");
    }
  });

  it("sous le seuil, il porte SEUL le message", () => {
    const legal = computeFrLegal(deal({ diffusion: "creator", payment: SOUS_LE_SEUIL }));
    expect(legal.missing_mandatory_clauses).toEqual([]);
    expect(legal.rights_transfer).toBe(true);
    expect(legal.note).toContain("L131-3");
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
      computeFrLegal(deal({ ip_transfer: "unclear", usage: { ...sansRien.usage, territory_zones: ["france"] } }))
        .missing_rights_clauses,
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
      { diffusion: "creator" as const, ip_transfer: "unclear" as const, payment: AU_DESSUS },
      { diffusion: "creator" as const, ip_transfer: "none" as const, payment: AU_DESSUS },
      { diffusion: "creator" as const, ip_transfer: "unclear" as const, payment: SOUS_LE_SEUIL },
      { diffusion: "brand_only" as const, ip_transfer: "unclear" as const, payment: AU_DESSUS },
      { diffusion: "unspecified" as const, ip_transfer: "license" as const, payment: AU_DESSUS },
      { diffusion: "brand_only" as const, ip_transfer: "none" as const, payment: AU_DESSUS },
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
        diffusion: "creator",
        payment: AU_DESSUS,
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
        diffusion: "brand_only",
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
    const legal = computeFrLegal(deal({ diffusion: "creator", payment: AU_DESSUS, ip_transfer: "unclear" }));
    const vue = legalNoticeView({ ...legal, missing_rights_clauses: ["Durée de l'exploitation", "   ", "\u2063", "\ufeff"] });
    expect(vue.rights).toEqual(["Durée de l'exploitation"]);
    expect(vue.hint).toContain("1 point à obtenir sur la cession de droits");
  });
});

describe("aucune référence que celles fournies", () => {
  const source = readFileSync("lib/legal/fr.ts", "utf8");

  it("les seules références du fichier sont la loi de 2023, son décret et L131-3", () => {
    const articles = [...new Set(source.match(/\bL\d{3}-\d+/g) ?? [])];
    expect(articles).toEqual(["L131-3"]);
    const numeros = [...new Set(source.match(/\d{4}-\d{3,4}/g) ?? [])];
    expect(numeros.sort()).toEqual(["2023-451", "2025-1137"]);
    const dates = [...new Set(source.match(/\d{1,2}(?:er)? [a-zà-ÿ]+ (?:19|20)\d\d/gi) ?? [])];
    expect(dates.sort()).toEqual(["1er janvier 2026", "28 novembre 2025", "9 juin 2023"]);
  });

  it("ni code ni juridiction inventés", () => {
    for (const interdit of [/code de commerce/i, /code civil/i, /code de la consommation/i, /RGPD/, /article\s+\d+\s+du\s+code/i]) {
      expect(source, String(interdit)).not.toMatch(interdit);
    }
  });

  it("les montants et les numéros ne se coupent pas en fin de ligne", () => {
    const note = computeFrLegal(deal({ diffusion: "creator", payment: AU_DESSUS })).note;
    expect(note).toContain("1\u202f000\u00a0€\u00a0HT");
    expect(note).toContain("décret n°\u00a02025-1137");
    expect(note).toContain("28\u00a0novembre 2025");
    expect(note).toContain("1er\u00a0janvier 2026");
  });
});

describe("une analyse enregistrée avant la #214", () => {
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
      deal({ diffusion: "creator", ip_transfer: "unclear", governing_law: "Droit de l'État de New York", payment: AU_DESSUS }),
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
