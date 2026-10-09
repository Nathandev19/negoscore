import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { composeAnalysis } from "@/lib/analysis/compose";
import { baseExtraction, PREVIEW_STATES, previewAnalysis } from "@/lib/fixtures/preview-states";
import { BAND_LABEL } from "@/lib/display";
import { bandFor, comparedAmountOf, priceCapFor } from "@/lib/rates/score";

// ═══════════════════════════════════════════════════════════════════════════
//  CE FICHIER GARDE UNE DETTE CONNUE, PAS UN DÉFAUT D'AFFICHAGE.
//  Ouvert le 09/10/2026 (#172), réécrit le 10/10/2026 (#174).
// ═══════════════════════════════════════════════════════════════════════════
//
// CE QUI EST VRAI AUJOURD'HUI : la note ENREGISTRÉE peut contredire la bande
// ENREGISTRÉE. Une offre à 400 € sous un plancher de 610 € porte la bande
// « faible » et la note 58, et 58 est dans la tranche que l'échelle de la
// #042 appelle « correct ».
//
// POURQUOI CE N'EST PLUS VISIBLE : depuis la #174, la note sur 100 n'est
// affichée nulle part — ni sur la page de résultat, ni dans l'historique.
// La contradiction ne peut donc plus être LUE par personne. Elle n'est pas
// réparée pour autant : elle est dans la base, dans chaque analyse
// enregistrée, et elle ressortirait le jour où la note reviendrait à l'écran.
//
// POURQUOI ELLE N'A PAS ÉTÉ RÉPARÉE : aligner le plafond de la #050 sur la
// règle de bande de la #167 fait bouger huit tests, dont l'invariant
// d'arrondi — un décalage de 9 € sur le plancher déplacerait la note de
// 8 points contre 3 au plus aujourd'hui, parce que le nouveau plafond crée
// une falaise de 20 points au plancher. Mesuré en #172.
//
// CE QUE CE FICHIER EXIGE :
//   1. que la contradiction reste exactement celle qu'on a décrite — si elle
//      change de forme, on veut le savoir ;
//   2. que la note reste INVISIBLE tant qu'elle n'est pas réparée ;
//   3. que sa réparation soit signalée : la garde en `it.fails` deviendra
//      rouge le jour où la note et la bande s'accorderont, et c'est le
//      signal qu'on peut retirer le marqueur — et rouvrir la question de
//      l'affichage.

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

describe("la dette : la note enregistrée peut contredire la bande enregistrée", () => {
  it("le cas est toujours exactement celui qu'on a décrit : 610 – 1 310 €, « faible », 58", () => {
    const { estimate, score } = composeAnalysis(casRapporte() as never, { tier: "starter" });
    expect(estimate.total_low).toBe(610);
    expect(estimate.total_high).toBe(1310);
    expect(score?.band).toBe("weak");
    expect(score?.value).toBe(58);
  });

  it("la contradiction tient au plafond de la #050, pas à la bande", () => {
    const { deal, estimate, score } = composeAnalysis(casRapporte() as never, { tier: "starter" });
    const plafond = priceCapFor(deal.payment.amount_eur, estimate.total_low, estimate.total_high);
    expect(plafond?.reason).toBe("ratio");
    expect(plafond?.cap).toBe(59);
    // 59 est dans « correct », alors que le montant est sous le plancher.
    expect(bandFor(plafond!.cap)).toBe("fair");
    expect(score!.band).toBe("weak");
    expect(comparedAmountOf(deal)).toBe(400);
    expect(estimate.total_low).toBeGreaterThan(400);
  });

  // LA GARDE. `it.fails` : elle échoue aujourd'hui, et c'est le constat. Le
  // jour où elle passera, c'est CE fichier qui échouera, en demandant qu'on
  // retire le marqueur — et qu'on rouvre la question de l'affichage.
  it.fails("aucune analyse ne porte une note dont la tranche nommée contredit sa bande", () => {
    const { score } = composeAnalysis(casRapporte() as never, { tier: "starter" });
    expect(BAND_LABEL[bandFor(score!.value)]).toBe(BAND_LABEL[score!.band]);
  });

  it("la dette ne touche pas les six états d'aperçu : elle vit entre 0,60 et 1 fois le plancher", () => {
    for (const etat of PREVIEW_STATES) {
      const { analysis } = previewAnalysis(etat);
      if (analysis.score === null) continue;
      expect(BAND_LABEL[bandFor(analysis.score.value)], etat).toBe(BAND_LABEL[analysis.score.band]);
    }
  });
});

describe("tant qu'elle n'est pas réparée, la note reste invisible", () => {
  // Mission #174 — c'est la seule raison pour laquelle on peut vivre avec la
  // dette. Si la note revenait à l'écran sans que le plafond soit aligné, la
  // contradiction redeviendrait lisible le jour même.
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
describe("ce que la #174 laisse à réécrire", () => {
  // L'accueil PROMET encore une note sur 100, en toutes lettres. Ce n'est pas
  // un reste d'affichage oublié : c'est une phrase de vente, et sa réécriture
  // n'est pas une décision technique. Consignée ici en `it.fails` plutôt que
  // réécrite à la place de son auteur.
  it.fails("aucun texte public ne promet une note sur 100", async () => {
    const { FAQ, STEPS } = await import("@/lib/content/home");
    const textes = [...STEPS, ...FAQ].map((entree) => Object.values(entree).join(" ")).join(" ");
    expect(textes).not.toMatch(/sur 100|\/100/);
  });
});
