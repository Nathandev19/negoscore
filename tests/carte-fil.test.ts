import { describe, expect, it } from "vitest";
import { BANDS } from "@/lib/negotiation/libelles";
import { priceFor, withCeiling } from "@/lib/negotiation/pricing";
import { concludeNow } from "@/lib/negotiation/turn";
import type { ConclusionPayload, Pricing, TurnPayload } from "@/lib/negotiation/types";
import { conclusionPayloadSchema, turnPayloadSchema } from "@/lib/negotiation/types";
import type { Thread } from "@/lib/negotiation/store";
import { loadScenarios, runScenario } from "@/lib/negotiation/scenarios";
import { CURRENT_RATE_TABLE } from "@/lib/rates/tables";
import { bandWithinRange } from "@/lib/rates/score";
import { VERDICT_UN_MOT, verdictCardAvailable, verdictCardTexts } from "@/lib/share-card/verdict-card";
import { carteDepuisChiffrage, carteDuFil, carteDuFilCharge, ligneOffreDuDeal } from "@/lib/share-card/verdict-data";
import { projectionFil } from "./helpers/carte-projection";

// Mission #169 — LA CARTE D'UNE NÉGOCIATION.
//
// Le chiffrage est calculé à l'écriture du tour et ENREGISTRÉ ; la route de la
// carte le lit, sans jamais recalculer et sans jamais charger le nom de la
// marque ni le texte des messages. Ce fichier vérifie les trois choses qui
// font tenir ce montage :
//   1. ce que le chiffrage porte, et qu'il le porte aussi sur la conclusion ;
//   2. qu'un tour d'avant la #169 ne produit ni carte ni bouton ;
//   3. que la page (fil en mémoire) et la route (colonnes projetées) jugent
//      EXACTEMENT pareil — sans quoi un bouton mènerait à un 404.

const { original, payload } = (() => {
  const scenario = loadScenarios().find((s) => s.id.endsWith("termes-a-la-hausse"))!;
  const { context, result } = runScenario(scenario);
  if (result.kind !== "turn") throw new Error("pas un tour");
  return { original: context.original, payload: result.payload as TurnPayload };
})();

const chiffrage = payload.pricing_after ?? payload.pricing_before;

function filDe(tours: TurnPayload[], conclusion: ConclusionPayload | null): Thread {
  return {
    turns: tours.map((p, i) => ({ id: `t${i}`, turnNumber: i + 2, brandReply: null, createdAt: `2026-10-0${i + 1}`, payload: p })),
    conclusion: conclusion ? { createdAt: "2026-10-09", payload: conclusion } : null,
  };
}

// Le même fil, vu par la route : des colonnes projetées, et rien d'autre.
function projete(thread: Thread) {
  return [
    ...thread.turns.map((t) => projectionFil({ kind: "reply", turn_number: t.turnNumber, payload: t.payload })),
    ...(thread.conclusion ? [projectionFil({ kind: "conclusion", payload: thread.conclusion.payload })] : []),
  ];
}

const conclusionDe = (pricing: Pricing | null): ConclusionPayload => ({
  schema_version: "1",
  tier: "confirmed",
  deal: payload.deal_after,
  conclusion: { source: "creator_accepted", recap: [], unclear: [], message: "Merci", legal_note: "", offered: null },
  pricing,
});

// ───────────────────────────────────────────────────────────────────────────
describe("le chiffrage enregistré porte de quoi faire une carte", () => {
  it("une seule liste de bandes dans le dépôt", () => {
    expect([...BANDS].sort()).toEqual(Object.keys(VERDICT_UN_MOT).sort());
  });

  it("un tour chiffré porte sa bande, son montant comparé et sa fourchette", () => {
    expect(chiffrage.band).not.toBe(null);
    expect(chiffrage.compared).toBe(payload.deal_after.payment.amount_eur);
    expect(chiffrage.score).not.toBe(null);
    expect(chiffrage.ceiling).toBe(false);
    expect(verdictCardAvailable(carteDuFilCharge(filDe([payload], null)) as never)).toBe(true);
  });

  it("sans argent, c'est la valeur des produits offerts qui est comparée", () => {
    // Même règle que la #167, et elle vaut aussi pour un tour : un seul
    // nombre affronte la fourchette, et c'est celui qui s'affiche. Sans ça
    // une offre payée en produits porterait « aucun montant » sur sa carte.
    const enProduits = {
      ...payload.deal_after,
      payment: { ...payload.deal_after.payment, amount_eur: null },
      in_kind_value_eur: 267,
    };
    const pricing = priceFor(enProduits, "confirmed", CURRENT_RATE_TABLE);
    expect(pricing.compared).toBe(267);
    expect(verdictCardTexts(carteDepuisChiffrage(pricing, ligneOffreDuDeal(enProduits))).propose).toContain("267");
  });

  it("concludeNow produit le chiffrage de la conclusion, bande comprise", () => {
    // La ligne de conclusion est écrite par cette fonction : si elle rendait
    // un chiffrage vide, une négociation conclue n'aurait pas de carte — le
    // cas qu'on a justement le plus envie de montrer.
    const { pricing } = concludeNow(original, [payload], "confirmed");
    expect(pricing).not.toBe(null);
    expect(pricing.band).not.toBe(null);
    expect(pricing.total_low).toBe(chiffrage.total_low);
    expect(verdictCardAvailable(carteDepuisChiffrage(pricing, ligneOffreDuDeal(payload.deal_after)))).toBe(true);
  });

  it("le plafond annoncé devient le montant comparé, et la bande suit", () => {
    const base = priceFor(payload.deal_after, "confirmed", CURRENT_RATE_TABLE);
    const avec = withCeiling(base, 900);
    expect(avec.compared).toBe(900);
    expect(avec.ceiling).toBe(true);
    // La note ne bouge pas — elle dit ce que valent les TERMES. Seule la
    // position du montant est réévaluée, par la garde de la #167.
    expect(avec.score).toBe(base.score);
    expect(avec.band).toBe(bandWithinRange(base.score!, 900, base.total_low));
    // Et sans plafond, rien ne change.
    expect(withCeiling(base, null)).toEqual(base);
  });

  it("LA CONCLUSION A SON CHIFFRAGE : c'est le cas qu'on a le plus envie de montrer", () => {
    const fil = filDe([payload], conclusionDe(chiffrage));
    const carte = carteDuFilCharge(fil);
    expect(carte).not.toBe("indisponible");
    expect(verdictCardAvailable(carte as never)).toBe(true);
    expect(verdictCardTexts(carte as never).vaut).not.toBe(null);
    // Le schéma l'accepte, et une conclusion d'avant la #169 se relit quand
    // même : le défaut est null, pas une erreur de parsing.
    expect(conclusionPayloadSchema.safeParse(conclusionDe(chiffrage)).success).toBe(true);
    const ancienne = { ...conclusionDe(null) } as Record<string, unknown>;
    delete ancienne.pricing;
    const relue = conclusionPayloadSchema.safeParse(ancienne);
    expect(relue.success).toBe(true);
    expect(relue.success && relue.data.pricing).toBe(null);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("un tour sans bande : aucune carte, et aucun bouton", () => {
  // Le chiffrage d'avant la #169 n'a ni bande ni montant comparé. On ne
  // retombe PAS sur les chiffres de l'offre d'origine : ils ne décrivent plus
  // ce qui est sur la table.
  const sansBande: TurnPayload = {
    ...payload,
    pricing_after: { ...chiffrage, score: null, band: null, compared: null, ceiling: false },
  };

  it("un payload d'avant la #169 se relit sans erreur, et vaut « pas de bande »", () => {
    // Capital : si safeParse échouait, store.ts écarterait le tour en silence
    // et le fil entier perdrait une ligne.
    const ancien = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
    const pricing = ancien.pricing_after as Record<string, unknown>;
    for (const champ of ["score", "band", "compared", "ceiling"]) delete pricing[champ];
    const relu = turnPayloadSchema.safeParse(ancien);
    expect(relu.success).toBe(true);
    expect(relu.success && relu.data.pricing_after?.band).toBe(null);
    expect(relu.success && relu.data.pricing_after?.ceiling).toBe(false);
  });

  it("pas de carte", () => {
    expect(carteDuFilCharge(filDe([sansBande], null))).toBe("indisponible");
    expect(carteDuFil(projete(filDe([sansBande], null)))).toBe("indisponible");
  });

  it("une conclusion sans chiffrage non plus, et elle ne se rabat pas sur le dernier tour", () => {
    // Le dernier tour, lui, EST chiffré : si la conclusion se rabattait
    // dessus, on afficherait les chiffres d'un état que la conclusion a
    // peut-être changé. Les deux chemins doivent refuser.
    const fil = filDe([payload], conclusionDe(null));
    expect(fil.turns.at(-1)!.payload.pricing_after?.band).not.toBe(null);
    expect(carteDuFilCharge(fil)).toBe("indisponible");
    expect(carteDuFil(projete(fil))).toBe("indisponible");
  });

  it("la table de l'analyse disparue du code : pas de carte non plus", () => {
    const sansTable: TurnPayload = { ...payload, pricing_unavailable: true, pricing_after: null };
    expect(carteDuFilCharge(filDe([sansTable], null))).toBe("indisponible");
    expect(carteDuFil(projete(filDe([sansTable], null)))).toBe("indisponible");
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("la page et la route jugent la même chose", () => {
  // LA GARDE CONTRE LE BOUTON QUI MÈNE À UN 404. La page tient le fil en
  // mémoire, la route lit des colonnes projetées. Si les deux chemins
  // divergeaient d'un champ, le bouton s'afficherait sans carte derrière.
  const CAS: Array<{ nom: string; fil: Thread }> = [
    { nom: "un tour chiffré", fil: filDe([payload], null) },
    { nom: "deux tours : c'est le dernier qui compte", fil: filDe([payload, payload], null) },
    { nom: "une conclusion chiffrée", fil: filDe([payload], conclusionDe(chiffrage)) },
    { nom: "une conclusion chiffrée après deux tours", fil: filDe([payload, payload], conclusionDe(chiffrage)) },
    {
      nom: "un plafond annoncé",
      fil: filDe([{ ...payload, pricing_after: withCeiling(chiffrage, 9000) }], null),
    },
    { nom: "aucun tour", fil: filDe([], null) },
  ];

  it.each(CAS)("$nom", ({ fil }) => {
    const enMemoire = carteDuFilCharge(fil);
    const projetee = carteDuFil(projete(fil));
    expect(projetee).toEqual(enMemoire);
    // Et les deux prédicats disent la même chose.
    const dispo = (c: typeof enMemoire) => c !== "indisponible" && c !== null && verdictCardAvailable(c);
    expect(dispo(projetee)).toBe(dispo(enMemoire));
  });

  it("le dernier tour l'emporte sur le premier, et la conclusion sur les deux", () => {
    const tour1: TurnPayload = { ...payload, pricing_after: { ...chiffrage, total_low: 111, total_high: 222 } };
    const tour2: TurnPayload = { ...payload, pricing_after: { ...chiffrage, total_low: 333, total_high: 444 } };
    const deuxTours = carteDuFil(projete(filDe([tour1, tour2], null)));
    expect(deuxTours).not.toBe("indisponible");
    expect((deuxTours as { bas: number | null }).bas).toBe(333);

    const avecFin = carteDuFil(projete(filDe([tour1, tour2], conclusionDe({ ...chiffrage, total_low: 555, total_high: 666 }))));
    expect((avecFin as { bas: number | null }).bas).toBe(555);
  });

  it("aucun tour : ni carte du fil, ni « indisponible » — c'est l'offre d'origine qui parle", () => {
    expect(carteDuFil([])).toBe(null);
    expect(carteDuFilCharge(null)).toBe(null);
    expect(original.estimate.total_low).not.toBe(null);
  });
});
