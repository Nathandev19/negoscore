import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/deal-input", () => ({
  DealInput: ({ note }: { note?: string }) => <form aria-label="saisie">{note}</form>,
}));
vi.mock("@/components/analytics/track-view", () => ({ TrackView: () => null }));
import { composeAnalysis } from "@/lib/analysis/compose";
import { baseExtraction, PREVIEW_STATES, previewAnalysis } from "@/lib/fixtures/preview-states";
import { BAND_LABEL, priceCapNote, QUANTITY_CAP_NOTE } from "@/lib/display";
import { bandWithinRange, comparedAmountOf, computeScore, priceCapFor, uncappedScore } from "@/lib/rates/score";

// Missions #190 et #193 : la bande garde sa priorité sur l'échelle de points.
// Sous le plancher, le plafond de la bande faible progresse avec le rapport.

// Le CODE d'un fichier, commentaires retirés : ceux-ci nomment justement ce
// qui a été enlevé, et c'est leur travail de le dire.
function codeSeul(fichier: string): string {
  return readFileSync(fichier, "utf8")
    .split("\n")
    .filter((ligne) => !/^\s*(\/\/|\*|\/\*)/.test(ligne))
    .join("\n");
}

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

describe("la note enregistrée ne dépasse pas le haut de sa bande", () => {
  const maximum = { bad: 29, weak: 49, fair: 69, good: 84, excellent: 100 } as const;

  it("le cas rapporté garde sa bande et descend de 58 à 38", () => {
    const { deal, estimate, score } = composeAnalysis(casRapporte() as never, { tier: "starter" });
    expect([estimate.total_low, estimate.total_high]).toEqual([610, 1310]);
    expect(comparedAmountOf(deal)).toBe(400);
    expect(priceCapFor(400, 610, 1310)?.cap).toBe(59);
    expect(bandWithinRange(58, 400, 610)).toBe("weak");
    expect(score).toEqual({ value: 38, band: "weak" });
  });

  it("balaye montants, niveaux et délais sans laisser de note au-dessus de sa bande", () => {
    for (const tier of ["starter", "confirmed", "experienced"] as const) {
      const { deal: base, estimate } = composeAnalysis(casRapporte() as never, { tier });
      const low = estimate.total_low as number;
      const adverse = {
        ...base,
        usage: { ...base.usage, perpetual: true },
        ip_transfer: "full_assignment" as const,
        ai_training_rights: "present" as const,
        revisions: { ...base.revisions, unlimited: true },
        raw_footage: true,
        exclusivity: { ...base.exclusivity, duration_months: 12 },
      };
      const amounts = new Set([
        ...Array.from({ length: 121 }, (_, step) => Math.round((step / 100) * low)),
        ...[0.4, 0.6, 0.85, 1].flatMap((ratio) => [Math.floor(ratio * low) - 1, Math.ceil(ratio * low), Math.ceil(ratio * low) + 1]),
      ]);
      for (const amount of amounts) {
        if (amount < 0) continue;
        for (const variant of [base, adverse]) {
          for (const terms_days of [null, 30, 60, 90]) {
            const deal = { ...variant, payment: { ...variant.payment, amount_eur: amount, terms_days } };
            const score = computeScore(deal, estimate);
            const before = Math.min(uncappedScore(deal, estimate).value, priceCapFor(amount, low, estimate.total_high)?.cap ?? Infinity);
            const context = `${tier}, ${amount}/${low}, délai ${terms_days}, ${before} → ${score.value} ${score.band}`;
            expect(score.band, context).toBe(bandWithinRange(before, comparedAmountOf(deal), low));
            expect(score.value, context).toBeLessThanOrEqual(maximum[score.band]);
            const previous = Math.min(before, maximum[score.band]);
            expect(score.value, context).toBeLessThanOrEqual(previous);
            if (score.band !== "weak" || amount >= low || amount < 0.4 * low) {
              expect(score.value, context).toBe(previous);
            }
          }
        }
      }
    }
  });

  it("la bande faible progresse sans recul et prend au moins dix valeurs", () => {
    const { deal: base, estimate } = composeAnalysis(casRapporte() as never, { tier: "starter" });
    const low = estimate.total_low as number;
    const values: number[] = [];
    for (let amount = Math.ceil(0.4 * low); amount <= Math.floor(0.99 * low); amount++) {
      const deal = { ...base, payment: { ...base.payment, amount_eur: amount } };
      const score = computeScore(deal, estimate);
      expect(score.band, `${amount}/${low}`).toBe("weak");
      if (values.length) expect(score.value, `${amount}/${low}`).toBeGreaterThanOrEqual(values.at(-1) as number);
      values.push(score.value);
    }
    expect(new Set(values).size).toBeGreaterThanOrEqual(10);
    expect(values[0]).toBe(30);
    expect(values.at(-1)).toBe(49);
  });

  it("les six états d'aperçu respectent aussi le plafond de leur bande", () => {
    for (const etat of PREVIEW_STATES) {
      const { analysis } = previewAnalysis(etat);
      if (analysis.score === null) continue;
      expect(analysis.score.value, etat).toBeLessThanOrEqual(maximum[analysis.score.band]);
    }
  });
});

describe("la note reste invisible dans les surfaces publiques", () => {
  const SURFACES: Array<[string, string]> = [
    ["la page de résultat", "components/result/score-band.tsx"],
    // Mission #174 — ajoutée après la batterie de mutation : la région live
    // annonçait « Score : 58 sur 100 » au changement de niveau, et on
    // pouvait l'y remettre sans qu'aucun test ne bronche. Ce qu'un lecteur
    // d'écran entend fait partie de ce qui est affiché.
    ["l'annonce au changement de niveau", "components/result/analysis-result.tsx"],
    ["le squelette de chargement", "components/result/result-skeleton.tsx"],
    ["l'historique", "components/account/history-view.tsx"],
  ];

  it.each(SURFACES)("%s n'écrit pas la note", (_nom, fichier) => {
    const code = codeSeul(fichier);
    expect(code).not.toContain("/100");
    expect(code).not.toContain("sur 100");
    expect(code).not.toContain("score.value");
  });

  it("l'historique lit la bande enregistrée, jamais un bandFor(note)", () => {
    // Le défaut relevé en #172 : la liste redevinait la couleur depuis la
    // note, et disait « correct » là où la page disait « faible ».
    expect(codeSeul("components/account/history-view.tsx")).not.toContain("bandFor");
    const page = readFileSync("app/historique/page.tsx", "utf8");
    expect(page).toContain("band:payload->score->>band");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("aucun texte public ne promet une note sur 100", () => {
  // Mission #175 — le constat était en `it.fails` depuis la #174 : l'accueil
  // promettait encore « un score sur 100 » et « 90/100 ». Les deux phrases
  // sont réécrites, et la garde devient une vraie garde.
  it("ni l'accueil, ni les formules, ni le champ d'analyse", async () => {
    const { FAQ, STEPS, TRUST } = await import("@/lib/content/home");
    const { PLANS } = await import("@/lib/billing/plans");
    const textes = [
      ...[...STEPS, ...TRUST, ...FAQ].map((entree) => Object.values(entree).join(" ")),
      ...PLANS.flatMap((plan) => [plan.name, plan.summary, ...plan.features]),
      readFileSync("app/page.tsx", "utf8"),
    ].join(" ");
    expect(textes).not.toMatch(/sur 100|\/100/);
  });

  it("ni les titres et descriptions des pages publiques", async () => {
    const { PUBLIC_PAGES } = await import("@/lib/seo");
    for (const page of PUBLIC_PAGES) {
      expect(`${page.title} ${page.description}`, page.path).not.toMatch(/sur 100|\/100/);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("le mot « score » a quitté la copie destinée aux créatrices", () => {
  // Mission #176 — la note n'est plus affichée : le mot ne nomme plus rien
  // qu'elle puisse voir. Deux mots le remplacent selon le rôle, et la règle
  // vit dans lib/content/vocabulaire.ts :
  //     ce qui LIT l'offre         → « l'analyse »
  //     ce qui S'AFFICHE en retour → « le verdict »
  //
  // « score » reste le mot du CODE et de la BASE, comme « crédit » : ce test
  // ne lit donc que des TEXTES, jamais des identifiants.
  const MOT = /\bscores?\b/i;

  it("ni dans les textes de l'accueil", async () => {
    const { FAQ, STEPS, TRUST } = await import("@/lib/content/home");
    for (const entree of [...STEPS, ...TRUST, ...FAQ]) {
      const texte = Object.values(entree).join(" ");
      expect(texte, texte.slice(0, 60)).not.toMatch(MOT);
    }
  });

  it("ni dans les trois formules, donc ni sur l'accueil ni sur /tarifs", async () => {
    const { PLANS } = await import("@/lib/billing/plans");
    for (const plan of PLANS) {
      for (const texte of [plan.name, plan.summary, ...plan.features]) {
        expect(texte, `${plan.name} : ${texte}`).not.toMatch(MOT);
      }
    }
  });

  it("ni dans le vocabulaire public, ni dans les titres et descriptions", async () => {
    const vocabulaire = await import("@/lib/content/vocabulaire");
    for (const [nom, valeur] of Object.entries(vocabulaire)) {
      if (typeof valeur === "string") expect(valeur, nom).not.toMatch(MOT);
    }
    const { PUBLIC_PAGES } = await import("@/lib/seo");
    for (const page of PUBLIC_PAGES) expect(`${page.title} ${page.description}`, page.path).not.toMatch(MOT);
  });

  it("ni dans ce que la page de résultat et l'accueil RENDENT", async () => {
    // La preuve par le rendu, pas par la source : c'est le texte lu à
    // l'écran qui compte, et lui seul.
    const { default: HomePage } = await import("@/app/page");
    const { ScoreBand } = await import("@/components/result/score-band");
    const lisible = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
    expect(lisible(renderToStaticMarkup(<HomePage />))).not.toMatch(MOT);
    for (const etat of PREVIEW_STATES) {
      const { analysis } = previewAnalysis(etat);
      expect(lisible(renderToStaticMarkup(<ScoreBand analysis={analysis} showTier />)), etat).not.toMatch(MOT);
    }
  });

  it("la décision vit dans le vocabulaire, pas seulement dans les pages", () => {
    // Mission #176, point 3 — « score » n'était pas défini comme terme
    // client : il n'y avait rien à renommer, seulement une décision à
    // consigner là où la prochaine personne ira la chercher. Un commentaire
    // est ici le livrable, donc il est gardé comme tel.
    const vocabulaire = readFileSync("lib/content/vocabulaire.ts", "utf8");
    expect(vocabulaire).toContain("« SCORE » N'EST PLUS UN MOT DE LA COPIE");
    expect(vocabulaire).toContain("ce qui LIT l'offre");
    expect(vocabulaire).toContain("« l'analyse »");
    expect(vocabulaire).toContain("ce qui S'AFFICHE en retour");
    expect(vocabulaire).toContain("« le verdict »");
    // Et l'exception y est nommée, pas sous-entendue.
    expect(vocabulaire).toContain("/admin");
  });

  it("L'EXCEPTION EST /admin, et elle est nommée", async () => {
    // Décidée en #174 : le rapport d'avis garde « Score : X/100 ». C'est
    // l'outil interne qui sert justement à recalibrer l'échelle — l'en
    // priver reviendrait à se priver du chiffre qu'on veut mesurer.
    const rapport = readFileSync("components/admin/feedback-report-view.tsx", "utf8");
    expect(rapport).toContain('["Score"');
    // Et l'exception s'arrête là : aucune page de créatrice ne l'imite.
    const CREATRICE = ["app/page.tsx", "app/historique/page.tsx", "components/result/score-band.tsx"];
    for (const fichier of CREATRICE) {
      // Des PHRASES, donc sur une seule ligne : une chaîne qui court sur
      // plusieurs lignes n'est pas du texte d'écran.
      const chaines = codeSeul(fichier).match(/"[^"\n]*\bscores?\b[^"\n]*"/gi) ?? [];
      // Les seules occurrences admises sont des chemins d'import, des
      // attributs de données et des colonnes de requête — jamais une phrase.
      for (const chaine of chaines) {
        // `"score"` seul est un index de TYPE (Analysis["score"]), pas une
        // phrase : le mot reste celui du code, comme « crédit ».
        expect(chaine, `${fichier} ${chaine}`).toMatch(/score-band|rates\/score|data-score|payload->score|select=|^"score"$/);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("le verdict n'est pas une position dans la fourchette", () => {
  // Mission #176 — la première réécriture de la #175 annonçait « le verdict :
  // au-dessus, dans la fourchette, ou en dessous ». C'est faux, et c'est
  // mesurable : le verdict est une VALEUR, conditions comprises.
  //
  // Ce test garde les deux bouts. D'abord le fait, pour qu'on sache pourquoi
  // la phrase dit ce qu'elle dit. Ensuite la phrase, pour qu'elle ne reparte
  // pas dans l'autre sens.
  function offre(montant: number, dures: boolean) {
    const base = baseExtraction();
    return {
      ...base,
      deal: {
        ...base.deal,
        brand: null,
        deliverables: [{ type: "video" as const, platform: "tiktok" as const, quantity: 2, format: null }],
        usage: { ...base.deal.usage, organic: true, paid_ads: false, perpetual: false, duration_months: 6, territory: "France", territory_zones: ["france"] },
        exclusivity: dures ? { present: true, duration_months: 6, category: "x" } : { present: false, duration_months: null, category: null },
        revisions: dures ? { count: null, unlimited: true } : { count: 2, unlimited: false },
        raw_footage: dures,
        payment: { ...base.deal.payment, amount_eur: montant, terms_days: dures ? 90 : 30 },
        in_kind_value_eur: null,
      },
    };
  }

  it("deux montants DANS leur fourchette donnent deux verdicts différents", () => {
    // Relevé le 10/10 : 200 € dans 200–360 € donne « correct », 360 € dans la
    // même fourchette donne « excellent », et 390 € dans 390–850 € avec des
    // conditions dures donne « faible ». La position ne suffit pas.
    const bas = composeAnalysis(offre(200, false) as never, { tier: "starter" });
    const haut = composeAnalysis(offre(360, false) as never, { tier: "starter" });
    for (const a of [bas, haut]) {
      expect(a.deal.payment.amount_eur).toBeGreaterThanOrEqual(a.estimate.total_low as number);
      expect(a.deal.payment.amount_eur).toBeLessThanOrEqual(a.estimate.total_high as number);
    }
    expect(bas.score!.band).not.toBe(haut.score!.band);
  });

  it("et deux montants AU-DESSUS du haut aussi", () => {
    const saine = composeAnalysis(offre(540, false) as never, { tier: "starter" });
    const dure = composeAnalysis(offre(1275, true) as never, { tier: "starter" });
    for (const a of [saine, dure]) {
      expect(a.deal.payment.amount_eur).toBeGreaterThan(a.estimate.total_high as number);
    }
    expect(saine.score!.band).not.toBe(dure.score!.band);
  });

  it("l'accueil ne décrit donc pas le verdict comme une position", async () => {
    const { STEPS } = await import("@/lib/content/home");
    const textes = STEPS.map((etape) => `${etape.title} ${etape.text}`).join(" ");
    expect(textes).toContain("ce que vaut l'offre, conditions comprises");
    expect(textes).not.toMatch(/au-dessus, dans la fourchette, ou en dessous/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("le mot « note » non plus", () => {
  // Mission #177 — même raison que pour « score » : la note n'est plus
  // affichée, donc le mot ne nomme plus rien que la créatrice puisse voir.
  // Les notes de plafond disaient encore « la note ne peut pas dépasser » ;
  // elles disent « le verdict ».
  //
  // MAIS « note » est un mot courant du français, et le remplacer partout
  // à l'aveugle serait pire que le laisser. Ce test porte donc sur ce qui
  // est RENDU, phrase par phrase, et nomme ses exceptions.
  const MOT = /\bnotes?\b/i;

  // Mission #178 — IL N'Y A PLUS AUCUNE EXCEPTION. La note de quantité
  // inconnue (#035) était la dernière à dire « la note ne peut donc pas
  // dépasser » ; elle dit « le verdict ». Le test est redevenu absolu, et
  // la liste d'attente qui le tempérait a disparu avec son seul membre.
  const lisible = (html: string) =>
    html
      .replace(/<[^>]+>/g, " ")
      .replace(/&#x27;|&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, " ");

  it("les trois notes de plafond disent « le verdict »", () => {
    for (const [raison, bande] of [
      ["bottom", BAND_LABEL.fair],
      ["middle", BAND_LABEL.good],
    ] as const) {
      const phrase = priceCapNote(56, raison);
      expect(phrase, raison).toContain(`le verdict ne peut pas dépasser « ${bande} »`);
      expect(phrase, raison).not.toMatch(MOT);
    }
    expect(priceCapNote(56, "ratio")).toContain("Le verdict ne peut pas monter plus haut.");
    expect(priceCapNote(56, "ratio")).not.toMatch(MOT);
  });

  it("ni dans ce que la page de résultat REND, dans ses six états", async () => {
    const { AnalysisResult } = await import("@/components/result/analysis-result");
    for (const etat of PREVIEW_STATES) {
      const { analysis } = previewAnalysis(etat);
      const texte = lisible(renderToStaticMarkup(<AnalysisResult analysis={analysis} unlockHref="/connexion" />));
      expect(texte, etat).not.toMatch(MOT);
    }
  });

  it("ni dans l'accueil, l'historique et le pied de page", async () => {
    const { default: HomePage } = await import("@/app/page");
    const { HistoryView } = await import("@/components/account/history-view");
    const { SiteFooter } = await import("@/components/site-footer");
    const rendus = [
      renderToStaticMarkup(<HomePage />),
      renderToStaticMarkup(
        <HistoryView
          rows={[
            { id: "a", created_at: "2026-09-19T10:00:00.000Z", score: 58, band: "weak", amount: 300, evaluability: "complete", tier: "confirmed" },
          ]}
        />,
      ),
      renderToStaticMarkup(<SiteFooter />),
    ];
    for (const html of rendus) expect(lisible(html)).not.toMatch(MOT);
  });

  it("ni dans les textes de contenu, les formules et les descriptions", async () => {
    const { FAQ, STEPS, TRUST } = await import("@/lib/content/home");
    const { PLANS } = await import("@/lib/billing/plans");
    const { PUBLIC_PAGES } = await import("@/lib/seo");
    const vocabulaire = await import("@/lib/content/vocabulaire");
    const textes = [
      ...[...STEPS, ...TRUST, ...FAQ].map((entree) => Object.values(entree).join(" ")),
      ...PLANS.flatMap((plan) => [plan.name, plan.summary, ...plan.features]),
      ...Object.values(vocabulaire).filter((v): v is string => typeof v === "string"),
      ...PUBLIC_PAGES.map((page) => `${page.title} ${page.description}`),
    ];
    for (const texte of textes) expect(texte, texte.slice(0, 70)).not.toMatch(MOT);
  });

  it("LE CODE, LA BASE ET /admin gardent leur vocabulaire", () => {
    // Même frontière que pour « score » : ce test interdit le mot À L'ÉCRAN,
    // jamais dans les identifiants. `data-tier-note`, `QUANTITY_CAP_NOTE`,
    // `priceCapNote`, la colonne `note` d'un avis : tous légitimes.
    expect(readFileSync("components/result/score-band.tsx", "utf8")).toContain("data-tier-note");
    expect(readFileSync("lib/display.ts", "utf8")).toContain("export function priceCapNote");
    // Et /admin, qui affiche toujours le chiffre, n'est pas concerné.
    expect(readFileSync("components/admin/feedback-report-view.tsx", "utf8")).toContain('["Score"');
  });

  it("la note de quantité inconnue aussi, la dernière des quatre", () => {
    // Elle était l'unique exception de la #177. Vérifiée nommément : c'est
    // la phrase qui a fait vivre la liste d'attente, et elle est alignée.
    expect(QUANTITY_CAP_NOTE).toContain("le verdict ne peut donc pas dépasser");
    expect(QUANTITY_CAP_NOTE).not.toMatch(MOT);
  });
});
