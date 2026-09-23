import { describe, expect, it } from "vitest";
import { citation, emptyPoints, openPoints, readPoints, sentencesOf } from "@/lib/negotiation/points";
import { baseAnalysis } from "@/lib/negotiation/scenarios";
import { processTurn, type TurnContext } from "@/lib/negotiation/turn";
import { turnReadingSchema, type Deal, type PointState, type TurnPayload, type TurnReading } from "@/lib/negotiation/types";

// Mission #098, partie A — l'écran ne peut plus se contredire lui-même.
//
// Rejeu de la négociation réelle du 23/09/2026 : 2 TikTok + 3 stories,
// produits 120 €, 150 €, droits pub 6 mois. Le tour 3 affichait cinq points
// « aucun passage trouvé » ET les mêmes cinq « répondu au tour 2 », citation à
// l'appui, deux blocs plus bas. Le modèle est simulé, aucun réseau.

const DEMANDES = [
  "Préciser la plateforme de publication des stories.",
  "Définir le territoire couvert par les droits.",
  "Limiter les droits publicitaires aux contenus validés et à la durée prévue.",
  "Préciser le nombre de révisions incluses.",
  "Ajouter le délai et les modalités de paiement.",
];

function offer(): ReturnType<typeof baseAnalysis> {
  const analysis = baseAnalysis("sample-extraction", "confirmed", {
    deliverables: [
      { type: "video", platform: "tiktok", quantity: 2, format: null },
      { type: "story", platform: "instagram", quantity: 3, format: null },
    ],
    in_kind_value_eur: 120,
    exclusivity: { present: false, duration_months: null, category: null },
    revisions: { count: null, unlimited: true },
    usage: { organic: true, paid_ads: true, whitelisting: false, spark_ads: false, duration_months: 6, territory: null, perpetual: false },
    payment: { amount_eur: 150, currency: "EUR", terms_days: null, schedule: null },
  });
  analysis.counter_offer = { ...analysis.counter_offer, changes: DEMANDES };
  return analysis;
}

type Patch = Partial<Omit<Deal, "usage" | "exclusivity" | "payment">> & {
  usage?: Partial<Deal["usage"]>;
  payment?: Partial<Deal["payment"]>;
};

function reading(base: Deal, patch: Patch, rest: Omit<TurnReading, "deal" | "relevance" | "relevance_note">): TurnReading {
  return turnReadingSchema.parse({
    relevance: "reply",
    relevance_note: "",
    ...rest,
    deal: { ...base, ...patch, usage: { ...base.usage, ...patch.usage }, payment: { ...base.payment, ...patch.payment } },
  });
}

function turn(context: TurnContext, read: TurnReading): TurnPayload {
  const result = processTurn(context, read);
  if (result.kind !== "turn") throw new Error("pas un tour");
  return result.payload;
}

// La réponse réelle du tour 2, mot pour mot.
const REPLY_2 =
  "Les stories, ce serait sur Instagram. Territoire : France uniquement. On prévoit 2 retours de révisions maximum, sur les contenus validés, pendant les 6 mois prévus. Paiement à 30 jours après réception et validation des contenus, en une fois, par virement. Côté budget, on peut monter à 600 € en plus des produits offerts.";

// Et celle du tour 3.
const REPLY_3 =
  "Je reviens vers vous après arbitrage : je peux aller jusqu'à 900 € en plus des produits offerts. C'est le maximum de mon enveloppe pour ce lancement, je ne pourrai pas revenir dessus.";

function turn2(original: ReturnType<typeof baseAnalysis>): TurnPayload {
  return turn(
    { original, previous: [], turnNumber: 2, tier: "confirmed", brandReply: REPLY_2 },
    reading(
      original.deal,
      { usage: { territory: "France" }, payment: { amount_eur: 600, terms_days: 30 } },
      {
        outcome: "partial",
        global_agreement: null,
        asks: [
          { id: "prix", status: "countered", quote: "on peut monter à 600 €", remaining: null },
          { id: "c1", status: "granted", quote: "Les stories, ce serait sur Instagram", remaining: null },
          { id: "c2", status: "granted", quote: "Territoire : France uniquement", remaining: null },
          { id: "c3", status: "granted", quote: "sur les contenus validés, pendant les 6 mois prévus", remaining: null },
          { id: "c4", status: "granted", quote: "2 retours de révisions maximum", remaining: null },
          { id: "c5", status: "granted", quote: "Paiement à 30 jours après réception et validation des contenus", remaining: null },
        ],
        changes: [
          { group: "territory", quote: "Territoire : France uniquement" },
          { group: "amount", quote: "on peut monter à 600 €" },
          { group: "payment_terms", quote: "Paiement à 30 jours après réception et validation des contenus" },
        ],
        brand_questions: [],
        uncertainties: [],
        next_message: { text: "Bonjour,\n\nMerci pour ces précisions.\n\n{{SITUATION}}\n\nBelle journée,", tone: "Clair" },
      },
    ),
  );
}

// Tour 3 : la marque annonce son plafond. Le modèle, lui, se remet à douter de
// tout ce qu'elle a déjà répondu au tour 2 — c'est le défaut constaté.
function turn3(original: ReturnType<typeof baseAnalysis>, previous: TurnPayload[]): TurnPayload {
  return turn(
    { original, previous, turnNumber: 3, tier: "confirmed", brandReply: REPLY_3 },
    reading(
      previous[previous.length - 1].deal_after,
      {},
      {
        outcome: "counter",
        global_agreement: null,
        asks: DEMANDES.map((_, index) => ({
          id: `c${index + 1}`,
          // Le modèle prétend une réponse, avec une citation introuvable dans
          // CE message : sans le filtre, chacune produit un doute.
          status: "granted" as const,
          quote: "comme convenu",
          remaining: null,
        })),
        changes: [],
        brand_questions: [],
        uncertainties: [],
        next_message: { text: "Bonjour,\n\nMerci.\n\nBelle journée,", tone: "Clair" },
      },
    ),
  );
}

const point = (payload: TurnPayload, key: PointState["key"]) => payload.points.find((entry) => entry.key === key);

describe("défaut 1 — le bloc de doute ne contredit plus la mémoire", () => {
  const original = offer();
  const second = turn2(original);
  const third = turn3(original, [second]);

  it("1. un point mémorisé « répondu » n'apparaît pas dans le bloc de doute", () => {
    expect(point(third, "territory")).toMatchObject({ status: "answered", turn: 2 });
    for (const doubt of third.uncertainties) expect(doubt).not.toContain("territoire");
  });

  it("2. un point mémorisé « refusé » n'apparaît pas non plus", () => {
    // Une marque qui refuse sans rien donner : le point est « refusé »…
    const refusal = turn(
      { original, previous: [second], turnNumber: 3, tier: "confirmed", brandReply: "Sur le territoire, on ne peut pas s'engager." },
      reading(
        second.deal_after,
        {},
        {
          outcome: "refused",
          global_agreement: null,
          asks: [{ id: "c2", status: "granted" as const, quote: "introuvable", remaining: null }],
          changes: [],
          brand_questions: [],
          uncertainties: [],
          next_message: { text: "Bonjour,\n\nMerci.\n\nBelle journée,", tone: "Clair" },
        },
      ),
    );
    expect(point(refusal, "territory")?.status).toBe("refused");
    // … et aucun doute ne vient dire qu'on n'a rien trouvé dessus.
    for (const doubt of refusal.uncertainties) expect(doubt).not.toContain("territoire");
  });

  it("3. aucun doute restant : le bloc n'est pas rendu", () => {
    expect(third.uncertainties).toEqual([]);
  });

  it("4. un point encore ouvert et non trouvé dans la réponse apparaît bien", () => {
    // L'exclusivité n'est ni dans l'offre ni dans la réponse : le doute reste.
    const withExclusivity = baseAnalysis("sample-extraction", "confirmed", {
      exclusivity: { present: true, duration_months: null, category: "cosmétique" },
    });
    withExclusivity.counter_offer = { ...withExclusivity.counter_offer, changes: ["Ramener l'exclusivité à 1 mois."] };
    const payload = turn(
      { original: withExclusivity, previous: [], turnNumber: 2, tier: "confirmed", brandReply: "Bonjour, on regarde et on revient vers vous." },
      reading(
        withExclusivity.deal,
        {},
        {
          outcome: "vague",
          global_agreement: null,
          asks: [{ id: "c1", status: "granted" as const, quote: "c'est d'accord pour l'exclusivité", remaining: null }],
          changes: [],
          brand_questions: [],
          uncertainties: [],
          next_message: { text: "Bonjour,\n\nMerci.\n\nBelle journée,", tone: "Clair" },
        },
      ),
    );
    expect(payload.uncertainties.join(" ")).toContain("exclusivité");
  });
});

describe("défaut 2 — les citations ne sont plus coupées au milieu des mots", () => {
  it("5. une citation commence et finit sur une frontière de phrase", () => {
    const extrait = citation("prévoit 2 retours de révisions,", REPLY_2);
    expect(sentencesOf(REPLY_2)).toContain(extrait);
    expect(extrait.startsWith("On prévoit")).toBe(true);
    expect(extrait.endsWith(".")).toBe(true);
  });

  it("6. une citation trop longue est coupée sur une frontière de mot, avec ellipse", () => {
    const court = citation("2 retours", REPLY_2, 40);
    expect(court.endsWith("…")).toBe(true);
    expect(court.length).toBeLessThanOrEqual(41);
    // La coupe tombe ENTRE deux mots : dans le texte d'origine, ce qui suit
    // l'extrait est une frontière, pas la suite d'un mot coupé.
    const extrait = court.slice(0, -1);
    const suite = REPLY_2.slice(REPLY_2.indexOf(extrait) + extrait.length);
    expect(REPLY_2).toContain(extrait);
    expect(/^[\s,;:.!?…]/u.test(suite), `« …${extrait.slice(-12)} » puis « ${suite.slice(0, 8)} »`).toBe(true);
  });

  it("7. la citation affichée reste un extrait exact du texte collé", () => {
    const payload = turn2(offer());
    for (const entry of payload.points) {
      if (entry.quote === null || entry.turn === 1) continue;
      const exact = entry.quote.endsWith("…") ? entry.quote.slice(0, -1) : entry.quote;
      expect(REPLY_2, entry.key).toContain(exact);
    }
  });
});

describe("défaut 3 — ce qui est réglé n'est plus compté comme ouvert", () => {
  it("8. un point renseigné par l'offre initiale est mémorisé « répondu » dès le tour 1", () => {
    const deal = offer().deal;
    const start = emptyPoints(deal, DEMANDES);
    // « en pub pendant 6 mois » est écrit dans l'offre.
    expect(start.find((entry) => entry.key === "usage_duration")).toMatchObject({ status: "answered", turn: 1 });
    // Le territoire, lui, n'y est pas.
    expect(start.find((entry) => entry.key === "territory")?.status).toBe("unknown");
  });

  it("9. un montant proposé sous la fourchette donne « répondu », pas « refusé »", () => {
    const original = offer();
    const third = turn3(original, [turn2(original)]);
    expect(point(third, "amount")).toMatchObject({ status: "answered", firm: true, turn: 3 });
    expect(third.stated_ceiling).toBe(900);
  });

  it("10. un refus explicite donne bien « refusé »", () => {
    const deal = offer().deal;
    const points = readPoints({
      previous: emptyPoints(deal, DEMANDES),
      brandReply: "Sur le territoire, on ne peut pas s'engager.",
      changes: [],
      turn: 2,
      deal,
      askLabels: DEMANDES,
    });
    expect(points.find((entry) => entry.key === "territory")?.status).toBe("refused");
  });

  it("11. un point jamais demandé n'apparaît pas dans « reste à obtenir »", () => {
    const deal = offer().deal;
    // Personne n'a demandé la durée des contenus : elle n'est pas un manque.
    const start = emptyPoints(deal, DEMANDES);
    expect(start.find((entry) => entry.key === "content_duration")?.status).toBe("unknown");
    expect(openPoints(start).map((entry) => entry.key)).not.toContain("content_duration");
    // Ce qui a été demandé et n'a pas de réponse, lui, y figure.
    expect(openPoints(start).map((entry) => entry.key)).toContain("territory");
  });

  it("12. rejeu des trois tours : aucune contradiction, conclusion atteinte", () => {
    const original = offer();
    const second = turn2(original);
    const third = turn3(original, [second]);

    // Aucun doute ne nie ce que la mémoire montre.
    const settled = third.points.filter((entry) => entry.status !== "unknown" && entry.quote !== null);
    for (const entry of settled) {
      for (const doubt of third.uncertainties) {
        expect(doubt.toLowerCase(), entry.key).not.toContain(entry.key === "amount" ? "rémunération" : "");
      }
    }
    // Plus rien à obtenir, un montant sur la table : l'échange se conclut.
    // Ici la marque a répondu sur toutes les demandes : c'est l'écran de
    // conclusion, et non les deux messages de clôture.
    expect(openPoints(third.points)).toEqual([]);
    const ending = third.conclusion ?? third.closing?.accept ?? null;
    expect(ending).not.toBeNull();
    // Et le message qui accepte porte le plafond annoncé, 900 €, jamais les
    // 600 € du tour précédent.
    const accept = third.conclusion?.message ?? third.closing?.accept.text ?? "";
    expect(accept).toContain("900");
    expect(accept).not.toContain("600 ");
    const recap = third.conclusion?.recap ?? third.closing?.recap ?? [];
    expect(recap.find((row) => row.label === "Rémunération")?.value).toContain("900");
  });
});
