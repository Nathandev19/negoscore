import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Attribution, readPoints } from "@/lib/negotiation/points";
import { quoteIsIn } from "@/lib/negotiation/quotes";
import { baseAnalysis } from "@/lib/negotiation/scenarios";
import { processTurn, type TurnContext } from "@/lib/negotiation/turn";
import { turnReadingSchema, type Deal, type PointKey, type PointState, type TurnPayload, type TurnReading } from "@/lib/negotiation/types";

// Mission #101 — un point n'est réglé que par une phrase qui le règle.
//
// Deux règles y sont mises à l'épreuve, sans réseau ni modèle :
//   1. sur un point à valeur normalisée, redire la même valeur autrement n'est
//      pas changer de position ;
//   2. une phrase ne referme un point que si elle en dit quelque chose, et
//      quand plusieurs points pourraient la réclamer, c'est l'attribution
//      structurée du modèle qui tranche — sinon les deux restent ouverts.

function deal(exclusivity = false): Deal {
  return baseAnalysis("sample-extraction", "confirmed", {
    deliverables: [{ type: "video", platform: "tiktok", quantity: 2, format: null }],
    exclusivity: exclusivity ? { present: true, duration_months: null, category: "cosmétique" } : { present: false, duration_months: null, category: null },
    revisions: { count: null, unlimited: true },
    usage: { organic: true, paid_ads: true, whitelisting: false, spark_ads: false, duration_months: 6, territory: null, perpetual: false },
    payment: { amount_eur: 300, currency: "EUR", terms_days: null, schedule: null },
  }).deal;
}

// Un tour de mémoire, sans rien d'autre : le texte de la marque, ce que le
// modèle lui a attribué, et l'état précédent.
function read(
  brandReply: string,
  { previous = [] as PointState[], turn = 2, attributed = [] as Attribution[], on = deal() }: { previous?: PointState[]; turn?: number; attributed?: Attribution[]; on?: Deal } = {},
): PointState[] {
  return readPoints({ previous, brandReply, changes: [], turn, deal: on, attributed });
}

const of = (points: readonly PointState[], key: PointKey): PointState => {
  const found = points.find((entry) => entry.key === key);
  if (!found) throw new Error(`point absent : ${key}`);
  return found;
};

const logs: Array<Record<string, unknown>> = [];

beforeEach(() => {
  logs.length = 0;
  vi.spyOn(console, "warn").mockImplementation((line: unknown) => {
    logs.push(JSON.parse(String(line)) as Record<string, unknown>);
  });
});

const logged = (event: string) => logs.filter((entry) => entry.event === event);

// ─── 1. Valeur identique, formulation différente ────────────────────────────

describe("défaut 1 — la valeur décide, sur les points qui en ont une", () => {
  const TOUR_2 = "Paiement à 30 jours après réception des contenus.";

  it("1. « à 30 jours » puis « en une fois, à 30 jours » : aucun changement de position, une seule citation", () => {
    const second = read(TOUR_2);
    const third = read("Paiement en une fois, à 30 jours après réception des contenus.", { previous: second, turn: 3 });

    const payment = of(third, "payment");
    expect(payment.status).toBe("answered");
    expect(payment.turn).toBe(3);
    expect(payment.quote).toBe("Paiement en une fois, à 30 jours après réception des contenus.");
    // La marque n'a pas bougé : 30 jours des deux côtés.
    expect(payment.previous).toBeNull();
  });

  it("2. « à 30 jours » puis « à 60 jours » : le changement est signalé, avec les deux citations", () => {
    const second = read(TOUR_2);
    const third = read("Paiement à 60 jours après réception des contenus.", { previous: second, turn: 3 });

    const payment = of(third, "payment");
    expect(payment.previous).not.toBeNull();
    expect(payment.previous?.turn).toBe(2);
    expect(payment.previous?.quote).toBe(TOUR_2);
  });

  it("3. « 6 mois de droits pub » redit autrement : aucun changement", () => {
    const second = read("Les droits pub courent sur 6 mois.");
    const third = read("Pour la publicité, on reste sur une durée de 6 mois.", { previous: second, turn: 3 });

    expect(of(second, "usage_duration").status).toBe("answered");
    expect(of(third, "usage_duration").quote).toBe("Pour la publicité, on reste sur une durée de 6 mois.");
    expect(of(third, "usage_duration").previous).toBeNull();
  });

  it("4. un point qualitatif reformulé : le changement reste signalé", () => {
    // Les deux phrases portent « 48h » : sur un point à valeur, ce serait la
    // même position. La validation n'en a pas — qui valide a changé, et ça se dit.
    const second = read("Validation : c'est moi qui valide, en 48h max.");
    const third = read("La validation passe par notre équipe marketing, sous 48h.", { previous: second, turn: 3 });

    const validation = of(third, "validation");
    expect(validation.previous?.quote).toBe("Validation : c'est moi qui valide, en 48h max.");
    expect(validation.previous?.turn).toBe(2);
  });
});

// ─── 2. Attribution d'une phrase à un point ─────────────────────────────────

describe("défaut 2 — une phrase ne referme que le point qu'elle traite", () => {
  const PAIEMENT = "Paiement à 30 jours après réception et validation des contenus.";

  it("5. « après réception et validation » referme le paiement, et laisse la validation ouverte", () => {
    const points = read(PAIEMENT, { attributed: [{ quote: PAIEMENT, ask: "Paiement à 30 jours" }] });

    expect(of(points, "payment").status).toBe("answered");
    expect(of(points, "payment").quote).toBe(PAIEMENT);
    // Le mot « validation » y figure, la procédure n'y est pas.
    expect(of(points, "validation").status).toBe("unknown");
    expect(of(points, "validation").quote).toBeNull();
  });

  it("5 bis. le sujet nommé sans rien en dire ne referme rien", () => {
    const points = read("On reparlera du territoire de diffusion plus tard.");

    expect(of(points, "territory").status).toBe("unknown");
    expect(logged("point_referme_par_repli")).toHaveLength(0);
  });

  it("6. « c'est moi qui valide, en 48h max » referme la validation", () => {
    const points = read("Validation : c'est moi qui valide, en 48h max.");
    expect(of(points, "validation").status).toBe("answered");
    expect(of(points, "validation").quote).toBe("Validation : c'est moi qui valide, en 48h max.");
  });

  it("7. une phrase ambiguë entre deux points : les deux restent ouverts", () => {
    // « 6 mois » vaut durée des droits autant que durée d'exclusivité, et rien
    // ne dit lequel des deux la marque vient de trancher.
    const points = read("Pour les droits pub et l'exclusivité, on reste sur 6 mois.", { on: deal(true) });

    expect(of(points, "usage_duration").status).toBe("unknown");
    expect(of(points, "exclusivity").status).toBe("unknown");
    expect(logged("point_referme_par_repli")).toHaveLength(0);

    // Et si le modèle la rattache à une demande qui nomme les deux points,
    // elle ne tranche pas davantage : on ne choisit pas à sa place.
    const attribue = read("Pour les droits pub et l'exclusivité, on reste sur 6 mois.", {
      on: deal(true),
      attributed: [{ quote: "Pour les droits pub et l'exclusivité, on reste sur 6 mois.", ask: "Ramener les droits pub et l'exclusivité à 1 mois" }],
    });
    expect(of(attribue, "usage_duration").status).toBe("unknown");
    expect(of(attribue, "exclusivity").status).toBe("unknown");
  });

  it("8. le repli par mots-clés tranche seul : c'est journalisé", () => {
    const points = read("Les allers-retours seront limités à 2.", { turn: 4 });

    expect(of(points, "revisions").status).toBe("answered");
    expect(logged("point_referme_par_repli")).toEqual([{ event: "point_referme_par_repli", point: "revisions", tour: 4 }]);
  });

  it("8 bis. le modèle a attribué la phrase : le repli ne tranche pas, rien n'est journalisé", () => {
    const phrase = "Les allers-retours seront limités à 2.";
    const points = read(phrase, { attributed: [{ quote: phrase, ask: "Limiter les révisions à 2 allers-retours" }] });

    expect(of(points, "revisions").status).toBe("answered");
    expect(logged("point_referme_par_repli")).toHaveLength(0);
  });
});

// ─── 3. Le fil entier ───────────────────────────────────────────────────────

const OFFRE =
  "Bonjour ! On aimerait 2 vidéos TikTok pour notre collection. On propose 300 € pour ces contenus. Les retouches sont illimitées. On souhaite les droits pour les diffuser en publicité pendant 6 mois.";

const REPLY_2 = "Territoire : France uniquement. Paiement en une fois, à 30 jours après réception et validation des contenus.";

const REPLY_3 = "Pour la validation, c'est moi qui valide les contenus, en 48h max.";

function reading(base: Deal, rest: Omit<TurnReading, "deal" | "relevance" | "relevance_note">, patch: Partial<Deal> = {}): TurnReading {
  return turnReadingSchema.parse({ relevance: "reply", relevance_note: "", ...rest, deal: { ...base, ...patch } });
}

function turnOf(context: TurnContext, input: TurnReading): TurnPayload {
  const result = processTurn(context, input);
  if (result.kind !== "turn") throw new Error("pas un tour");
  return result.payload;
}

function replay(): { turns: TurnPayload[]; replies: Record<number, string> } {
  const original = baseAnalysis("sample-extraction", "confirmed", {
    deliverables: [{ type: "video", platform: "tiktok", quantity: 2, format: null }],
    exclusivity: { present: false, duration_months: null, category: null },
    revisions: { count: null, unlimited: true },
    usage: { organic: true, paid_ads: true, whitelisting: false, spark_ads: false, duration_months: 6, territory: null, perpetual: false },
    payment: { amount_eur: 300, currency: "EUR", terms_days: 30, schedule: null },
  });
  original.counter_offer = { ...original.counter_offer, changes: ["Préciser le territoire de diffusion", "Paiement à 30 jours"] };

  const second = turnOf(
    { original, previous: [], turnNumber: 2, tier: "confirmed", brandReply: REPLY_2, offerText: OFFRE },
    reading(
      original.deal,
      {
        outcome: "partial",
        global_agreement: null,
        asks: [
          { id: "c1", status: "granted", quote: "Territoire : France uniquement", remaining: null },
          { id: "c2", status: "granted", quote: "Paiement en une fois, à 30 jours après réception et validation des contenus", remaining: null },
        ],
        // Aucun changement de terme sur le paiement : l'offre disait déjà 30
        // jours. C'est la demande à laquelle la marque répond — et elle seule —
        // qui referme le point.
        changes: [{ group: "territory", quote: "Territoire : France uniquement" }],
        brand_questions: [],
        uncertainties: [],
        next_message: { text: "Bonjour,\n\nMerci pour ces précisions.\n\nEt côté validation des contenus ?\n\nBelle journée,", tone: "Poli et ferme" },
      },
      { usage: { ...original.deal.usage, territory: "France" } },
    ),
  );

  const third = turnOf(
    { original, previous: [second], turnNumber: 3, tier: "confirmed", brandReply: REPLY_3, offerText: OFFRE },
    reading(second.deal_after, {
      outcome: "partial",
      global_agreement: null,
      asks: [],
      changes: [],
      brand_questions: [],
      uncertainties: [],
      next_message: { text: "Bonjour,\n\nMerci pour cette précision.\n\nBelle journée,", tone: "Poli et ferme" },
    }),
  );

  return { turns: [second, third], replies: { 1: OFFRE, 2: REPLY_2, 3: REPLY_3 } };
}

describe("le fil entier — la validation attend la phrase qui la traite", () => {
  it("9. la validation n'est refermée qu'au tour où la marque en parle vraiment", () => {
    const { turns } = replay();
    const [second, third] = turns;

    // Tour 2 : le mot « validation » est là, la procédure non.
    expect(of(second.points, "payment").status).toBe("answered");
    expect(of(second.points, "payment").turn).toBe(2);
    expect(of(second.points, "validation").status).toBe("unknown");
    // Et l'agent le sait : il n'a pas retiré la question du message.
    expect(second.dropped_questions.some((dropped) => dropped.point === "validation")).toBe(false);

    // Tour 3 : elle répond, le point se referme à ce tour-là.
    expect(of(third.points, "validation").status).toBe("answered");
    expect(of(third.points, "validation").turn).toBe(3);
    expect(of(third.points, "validation").quote).toBe(REPLY_3);
  });

  it("10. la citation de chaque point refermé existe mot pour mot dans le texte de son tour", () => {
    const { turns, replies } = replay();
    for (const payload of turns) {
      const closed = payload.points.filter((point) => point.status !== "unknown");
      expect(closed.length).toBeGreaterThan(0);
      for (const point of closed) {
        const source = replies[point.turn ?? 0];
        expect(source, `pas de source pour le tour ${point.turn}`).toBeDefined();
        expect(point.quote).not.toBeNull();
        expect(quoteIsIn(point.quote ?? "", source), `${point.key} : ${point.quote}`).toBe(true);
      }
    }
  });
});

describe("un accord global ne referme aucun point", () => {
  it("11. « c'est bon pour nous » cité sur deux demandes : les points restent ouverts", () => {
    const original = baseAnalysis("sample-extraction", "confirmed", {
      deliverables: [{ type: "video", platform: "tiktok", quantity: 2, format: null }],
      // Ni durée de droits ni durée d'exclusivité dans l'offre : les deux
      // points sont ouverts en entrant dans ce tour.
      exclusivity: { present: true, duration_months: null, category: "cosmétique" },
      revisions: { count: 2, unlimited: false },
      usage: { organic: true, paid_ads: true, whitelisting: false, spark_ads: false, duration_months: null, territory: null, perpetual: false },
      payment: { amount_eur: 300, currency: "EUR", terms_days: 30, schedule: null },
    });
    original.counter_offer = {
      ...original.counter_offer,
      changes: ["Ramener les droits pub à 1 mois", "Ramener l'exclusivité à 1 mois"],
    };

    const accord = "Pour les droits pub et l'exclusivité, on reste sur 6 mois.";
    const payload = turnOf(
      { original, previous: [], turnNumber: 2, tier: "confirmed", brandReply: `Merci pour votre message. ${accord}`, offerText: null },
      reading(original.deal, {
        outcome: "partial",
        global_agreement: accord,
        asks: [
          { id: "c1", status: "granted", quote: accord, remaining: null },
          { id: "c2", status: "granted", quote: accord, remaining: null },
        ],
        changes: [],
        brand_questions: [],
        uncertainties: [],
        next_message: { text: "Bonjour,\n\nMerci pour votre retour.\n\nBelle journée,", tone: "Poli" },
      }),
    );

    // L'accord est bien lu comme global : c'est ce que l'écran affiche.
    expect(payload.asks.filter((ask) => ask.global)).toHaveLength(2);
    // Mais une phrase qui vaut pour tout ne tranche aucun point en particulier.
    expect(of(payload.points, "usage_duration").status).toBe("unknown");
    expect(of(payload.points, "exclusivity").status).toBe("unknown");
  });
});
