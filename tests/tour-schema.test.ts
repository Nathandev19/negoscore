import { describe, expect, it } from "vitest";
import { TURN_REASONING_EFFORT } from "@/lib/llm/model";
import { buildTurnUserMessage, turnReadingJsonSchema, TURN_SYSTEM_PROMPT } from "@/lib/llm/turn-prompt";
import { applyGroup } from "@/lib/negotiation/terms";
import { TERM_GROUPS, turnDealSchema, type Deal } from "@/lib/negotiation/types";
import { loadScenarios, scenarioContext } from "@/lib/negotiation/scenarios/index";
import { stateBefore } from "@/lib/negotiation/turn";

// Mission #202 — CE QU'ON DEMANDE AU MODÈLE À CHAQUE TOUR, ÉPINGLÉ.
//
// Un tour de suivi mettait 22,2 s de latence médiane contre 15,4 s pour la
// première analyse, qui traite pourtant plus d'information. Deux causes
// mesurées : le raisonnement par défaut du fournisseur, et un schéma de sortie
// dont un tiers n'était lu par aucun code.
//
// Les gardes d'ici servent à ce que ça ne regrimpe pas sans qu'on le voie.

const SCHEMA = turnReadingJsonSchema();
const SCHEMA_CHARS = JSON.stringify(SCHEMA).length;

describe("le schéma de sortie d'un tour ne contient que ce que le code lit", () => {
  it("LES CHAMPS RETIRÉS SONT INATTEIGNABLES — c'est ça, la preuve", () => {
    // La preuve n'est pas « on a vérifié à l'œil » : applyGroup est le SEUL
    // chemin par lequel un champ de la lecture du modèle entre dans le deal
    // enregistré (lib/negotiation/turn.ts, applyGroups). On lui donne un deal
    // d'avant entièrement reconnaissable et un deal de tour entièrement
    // différent, on applique LES NEUF groupes, et on regarde quels champs du
    // résultat viennent du tour. Tout champ qui reste celui d'avant est un
    // champ que le modèle n'a aucun moyen de changer.
    const scenario = loadScenarios()[0];
    const avant: Deal = scenarioContext(scenario).original.deal;
    const tour = turnDealSchema.parse({
      ...avant,
      deliverables: [{ type: "photo", platform: "youtube", quantity: 9, format: "carré" }],
      publication_required: !avant.publication_required,
      usage: { ...avant.usage, organic: !avant.usage.organic, duration_months: 99, territory: "Mars", perpetual: !avant.usage.perpetual },
      exclusivity: { present: !avant.exclusivity.present, duration_months: 98, category: "fromage" },
      payment: { amount_eur: 9999, currency: "CHF", terms_days: 97, schedule: "à la Saint-Glinglin" },
      in_kind_value_eur: 9998,
    });
    const apres = TERM_GROUPS.reduce<Deal>((deal, group) => applyGroup(deal, tour, group), avant);

    // Les dix champs retirés du schéma : identiques à ceux d'avant, donc
    // jamais pris au modèle, donc inutiles à lui demander.
    for (const champ of ["brand", "raw_footage", "ip_transfer", "ai_training_rights", "revisions", "variable_pay", "deadlines", "kill_fee", "termination", "governing_law"] as const) {
      expect(JSON.stringify(apres[champ]), champ).toBe(JSON.stringify(avant[champ]));
      expect(Object.keys(turnDealSchema.shape), champ).not.toContain(champ);
    }
    // Et les champs gardés, eux, changent bien : la garde ne passe pas parce
    // que applyGroup ne ferait rien.
    expect(apres.payment.amount_eur).toBe(9999);
    expect(apres.exclusivity.category).toBe("fromage");
    expect(apres.deliverables[0]?.quantity).toBe(9);
    expect(apres.in_kind_value_eur).toBe(9998);
  });

  it("LE MONTANT ÉCRIT PAR LA MARQUE RESTE — le retirer casserait le chiffrage", () => {
    // Contrainte de la mission : aucun champ qui porte un montant CALCULÉ. Le
    // montant de la marque, lui, est une donnée qu'elle écrit et que le modèle
    // relève, comme il relève une durée. Sans lui, un tour où la marque monte
    // son budget ne pourrait plus être chiffré.
    expect(Object.keys(turnDealSchema.shape.payment.shape)).toContain("amount_eur");
    // Et le modèle n'a toujours aucun moyen d'écrire un montant AILLEURS :
    // aucun champ d'estimation, de fourchette ou de contre-offre dans sa sortie.
    const noms = Object.keys((SCHEMA as { properties: Record<string, unknown> }).properties);
    for (const interdit of ["estimate", "counter_offer", "pricing", "score", "total_low", "total_high"]) {
      expect(noms, interdit).not.toContain(interdit);
    }
  });

  it("LA TAILLE EST ÉPINGLÉE : elle ne regrimpe pas en silence", () => {
    // 4 512 caractères avant la #202, 3 191 après. Le plafond laisse de quoi
    // ajouter un champ utile, pas de quoi remettre un deal entier.
    expect(SCHEMA_CHARS).toBeLessThanOrEqual(3_400);
    // Et un plancher : si quelqu'un le vide, la garde le dit au lieu de passer.
    expect(SCHEMA_CHARS).toBeGreaterThan(2_500);
  });

  it("L'ÉTAT ENVOYÉ EST PROJETÉ PAR LE MÊME SCHÉMA que la sortie", () => {
    // Les deux ne peuvent pas diverger : si l'un gagne un champ, l'autre aussi.
    const scenario = loadScenarios()[0];
    const context = scenarioContext(scenario);
    const state = stateBefore(context.original, [], scenario.reponse_marque);
    const message = buildTurnUserMessage({ deal: state.deal, asks: state.asks, points: state.points, lastMessage: "x", brandReply: scenario.reponse_marque });
    const etat = message.slice(message.indexOf("<etat_du_deal>"), message.indexOf("</etat_du_deal>"));
    for (const retire of ["brand", "raw_footage", "ip_transfer", "ai_training_rights", "revisions", "variable_pay", "deadlines", "kill_fee", "termination", "governing_law"]) {
      expect(etat, retire).not.toContain(`"${retire}"`);
    }
    expect(etat).toContain('"amount_eur"');
    expect(etat).toContain('"exclusivity"');
  });
});

describe("l'effort de raisonnement d'un tour", () => {
  it("il est propre au tour, et n'a pas touché l'extraction d'une offre", async () => {
    const { MODEL } = await import("@/lib/llm/model");
    // L'extraction garde son réglage : l'éval du 17/09/2026 a montré qu'y
    // baisser l'effort perd de l'exactitude. La mesure de la #202 porte sur
    // une AUTRE tâche, et ne l'autorise pas pour celle-là.
    expect(MODEL.reasoningEffort).toBeNull();
    expect(TURN_REASONING_EFFORT).toBe("none");
  });

  it("la route du tour passe par readBrandReply, qui l'applique", async () => {
    const { readFileSync } = await import("node:fs");
    const turn = readFileSync("lib/llm/turn.ts", "utf8");
    expect(turn).toContain("reasoningEffort: TURN_REASONING_EFFORT");
    // L'appelant peut le remplacer — c'est ainsi que l'éval mesure le chemin
    // de la production. L'ordre compte : le défaut d'abord, l'option ensuite.
    expect(turn).toContain("options: { reasoningEffort: TURN_REASONING_EFFORT, ...options }");
  });

  it("le prompt système n'a pas bougé : la #202 n'y a rien coupé", () => {
    // Dit explicitement parce que la mission le demandait et que la mesure a
    // désigné ailleurs : 3 649 jetons d'entrée coûtent une fraction des
    // 1 478 jetons de raisonnement supprimés. Chaque règle de ce prompt vient
    // d'un défaut constaté ; les couper pour 3 % d'entrée est un mauvais
    // échange. Si ce nombre bouge, que ce soit un choix, pas une dérive.
    expect(TURN_SYSTEM_PROMPT.length).toBe(9024);
  });
});
