import { describe, expect, it } from "vitest";
import { composeAnalysis } from "@/lib/analysis/compose";
import { baseExtraction, PREVIEW_STATES, previewAnalysis } from "@/lib/fixtures/preview-states";
import { bandFor, comparedAmount, comparedAmountOf, pricePoints, RATIO_ZERO, uncappedScore } from "@/lib/rates/score";

// Mission #167 — LA BANDE NE PEUT PAS DIRE « CORRECT » SOUS LE PLANCHER.
//
// Le cas rapporté : 400 € pour 3 vidéos, 89 € de produits gardés, droits pub
// 6 mois, France + Belgique/Suisse + États-Unis, exclusivité 3 mois, paiement
// à 30 jours. Fourchette 610 – 1 310 €. La carte disait « Correct ».
//
// POURQUOI. La bande n'était PAS comparée à la fourchette : elle était
// `bandFor(score)`, et le score est un composite — 50 de base, jusqu'à 30
// points de prix, plus ou moins les conditions. 400 € sous un plancher de
// 610 € ne rapporte que 7,67 points de prix sur 30, mais 50 + 7,67 − 5
// (exclusivité) + 5 (paiement à 30 j) = 58, et 58 tombe dans la tranche
// 50–69 de l'échelle gelée en #042, qui s'appelle « correct ». Le plafond de
// prix de #050 calculait 59 : il manquait la bande d'un point.
//
// CE QUE CETTE GARDE FAIT, ET RIEN DE PLUS : elle interdit la bande d'être
// meilleure que la position du montant quand ce montant est SOUS le plancher.
// L'échelle, les seuils et la valeur du score ne bougent pas — le score reste
// 58 dans le cas ci-dessus, c'est la bande qui descend.
//
// CE QU'ELLE NE FAIT PAS, et pourquoi : voir le rapport de #167. La moitié
// haute de la règle (« au-dessus du haut, c'est sur-évalué ») fait changer
// deux comportements de référence, mesurés — le plafond de quantité inconnue
// de #035 cesse de plafonner, et la phrase de verdict perd sa réserve sur les
// conditions. La mission dit de s'arrêter dans ce cas, pas de mettre les
// tests à jour.

// L'offre du rapport, à l'euro près. `montant` et `produits` sont les deux
// seules variables : tout le reste est le cas rapporté tel quel.
function cas(produits: number | null, montant: number | null = 400) {
  const base = baseExtraction();
  return {
    ...base,
    deal: {
      ...base.deal,
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
      payment: { ...base.deal.payment, amount_eur: montant, terms_days: 30 },
      in_kind_value_eur: produits,
    },
  };
}

describe("aucun montant sous le plancher ne porte la bande « correct »", () => {
  it("le cas rapporté : 400 € sous un plancher de 610 €, la bande n'est plus « correct »", () => {
    const { estimate, score } = composeAnalysis(cas(89) as never, { tier: "starter" });
    // La fourchette mesurée, telle qu'elle s'affiche.
    expect(estimate.total_low).toBe(610);
    expect(estimate.total_high).toBe(1310);
    // Le score ne bouge pas : l'échelle de #042 est gelée.
    expect(score?.value).toBe(58);
    expect(bandFor(58)).toBe("fair");
    // C'est la bande qui descend. CE TEST ÉCHOUE sur le code d'avant #167,
    // où elle valait « fair ».
    expect(score?.band).toBe("weak");
  });

  it("l'invariant tient sur toute la plage, pas seulement sur le cas rapporté", () => {
    // De très loin sous le plancher à juste dedans. Chaque palier est une
    // offre complète passée par le vrai moteur.
    for (const montant of [1, 50, 100, 200, 300, 400, 500, 600, 609, 610, 700, 1200, 1310, 2000]) {
      const { estimate, score } = composeAnalysis(cas(null, montant) as never, { tier: "starter" });
      const bas = estimate.total_low as number;
      if (montant < RATIO_ZERO * bas) {
        // Très en dessous : c'est « mauvais », pas « faible ». Le seuil est
        // RATIO_ZERO, le même que celui de la phrase de verdict — un seul
        // seuil pour une seule idée.
        expect(score?.band, `${montant} € très sous ${bas} €`).toBe("bad");
      } else if (montant < bas) {
        expect(score?.band, `${montant} € sous ${bas} €`).toBe("weak");
      } else {
        // Dans la fourchette, la bande reste celle du score : la garde ne
        // remonte jamais une bande, elle ne fait que l'empêcher de mentir
        // vers le haut.
        expect(score?.band, `${montant} €`).toBe(bandFor(score?.value as number));
      }
    }
  });

  // `uncappedScore` rend un `Score` comme les autres, avec sa bande. Aucun
  // écran ne lit cette bande sous un plancher aujourd'hui — `verdictForm`
  // répond « complete_below » avant d'arriver à `cappedOnly`, qui est son seul
  // lecteur (lib/analysis/verdict.ts:101). La garde y est quand même, et ce
  // test la tient : un Score dont la bande contredit son montant, c'est le
  // défaut même de cette mission, et `uncappedScore` serait sinon le dernier
  // endroit du dépôt qui peut encore en produire un.
  it("le score sans plafond porte la même garde que le score affiché", () => {
    const { deal, estimate } = composeAnalysis(cas(89) as never, { tier: "starter" });
    const sans = uncappedScore(deal, estimate);
    expect(bandFor(sans.value)).toBe("fair");
    expect(sans.band).toBe("weak");
  });

  it("aucune fixture de prévisualisation ne porte « correct » sous son plancher", () => {
    for (const etat of PREVIEW_STATES) {
      const { analysis } = previewAnalysis(etat);
      const bas = analysis.estimate.total_low;
      const compare = comparedAmount(analysis.deal.payment.amount_eur, analysis.deal.in_kind_value_eur);
      if (analysis.score === null || bas === null || compare === null || compare >= bas) continue;
      expect(["bad", "weak"], `${etat} : ${compare} € sous ${bas} €`).toContain(analysis.score.band);
    }
  });
});

describe("le montant comparé est celui qui s'affiche", () => {
  // La mission : « Si la valeur des produits offerts compte dans la
  // comparaison, elle doit compter aussi dans le montant affiché “On m'a
  // proposé”, sinon la carte se contredit elle-même. » Une seule fonction
  // tranche, et tout le monde la lit.
  it("sans argent, ce sont les produits qui comptent — et des deux côtés", () => {
    const { deal, estimate, score } = composeAnalysis(cas(267, null) as never, { tier: "starter" });
    expect(comparedAmountOf(deal)).toBe(267);
    // 267 € sous le plancher : la bande ne peut pas dire « correct ».
    expect(["bad", "weak"]).toContain(score?.band);
    expect(estimate.total_low).toBeGreaterThan(267);
  });

  it("l'argent passe devant les produits, jamais la somme des deux", () => {
    // Additionner serait un choix de chiffrage que personne n'a validé : on
    // compare ce que le moteur a toujours comparé, l'argent, et on ne se
    // rabat sur les produits que s'il n'y a pas d'argent.
    expect(comparedAmount(400, 89)).toBe(400);
    expect(comparedAmount(null, 89)).toBe(89);
    expect(comparedAmount(null, null)).toBe(null);
    expect(comparedAmount(0, 89)).toBe(0);
  });

  it("sous le plancher, les points de prix restent ce qu'ils étaient", () => {
    // La garde ne touche pas au calcul : c'est la preuve que rien n'a été
    // rattrapé en douce dans le barème.
    // 18 × (400 − 0,4 × 610) / (610 − 0,4 × 610) = 7,67 sur 30. Inchangé.
    expect(pricePoints(400, 610, 1310)).toBeCloseTo(7.67, 2);
  });
});
