import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatEur } from "@/lib/money";
import { baseAnalysis } from "@/lib/negotiation/scenarios";
import { processTurn, type TurnContext } from "@/lib/negotiation/turn";
import { turnReadingSchema, type Deal, type TurnPayload, type TurnReading } from "@/lib/negotiation/types";
import { positionOfAmount, situationSentence } from "@/lib/negotiation/gap";
import { quoteIsIn } from "@/lib/negotiation/quotes";

// Mission #095 — l'agent tient les chiffres et la mémoire de la négociation.
//
// Rejeu de la négociation réelle du 22/09/2026 : 2 TikTok + 3 stories, produits
// offerts (120 €) et 150 €, droits pub 6 mois. Le modèle est SIMULÉ : les
// lectures ci-dessous sont écrites à la main, comme les scénarios de garde, et
// c'est le CODE qui est mis à l'épreuve. Aucun réseau.

const DEMANDES = [
  "Préciser le territoire de diffusion",
  "Préciser les formats et la durée des contenus",
  "Limiter les révisions à 2 allers-retours",
  "Paiement à 30 jours",
];

// L'offre de départ, telle que le moteur l'a chiffrée.
function offer(): ReturnType<typeof baseAnalysis> {
  const analysis = baseAnalysis("sample-extraction", "confirmed", {
    deliverables: [
      { type: "video", platform: "tiktok", quantity: 2, format: null },
      { type: "story", platform: "instagram", quantity: 3, format: null },
    ],
    in_kind_value_eur: 120,
    // Aucune exclusivité dans cette offre : le point n'est pas suivi.
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

// ─── Le cas réel, tour par tour ──────────────────────────────────────────────

const REPLY_2 =
  "Territoire : France uniquement. Formats : 2 TikTok de 20 à 30 secondes en 9:16, et 3 stories verticales. On prévoit 2 allers-retours de révisions. Paiement à 30 jours après réception des contenus. Par contre les 6 mois de droits pub, on ne peut pas bouger dessus. Sur le budget, je peux monter à 600 € en plus des produits. Validation : c'est moi qui valide, en 48h max.";

const REPLY_3 =
  "Les stories font 15 secondes chacune. Oui, les 2 allers-retours sont bien un maximum. Paiement en une fois, à 30 jours après réception et validation. J'ai refait un tour côté budget : je peux aller jusqu'à 900 € en plus des produits offerts. C'est le maximum de mon enveloppe.";

// Tour 2 : la marque répond sur tout, monte à 600 €, ne bouge pas sur les droits.
function turn2(original: ReturnType<typeof baseAnalysis>): TurnPayload {
  const context: TurnContext = { original, previous: [], turnNumber: 2, tier: "confirmed", brandReply: REPLY_2 };
  return turn(
    context,
    reading(
      original.deal,
      { usage: { territory: "France" }, payment: { amount_eur: 600, terms_days: 30 } },
      {
        outcome: "partial",
        global_agreement: null,
        asks: [
          { id: "prix", status: "countered", quote: "je peux monter à 600 €", remaining: null },
          { id: "c1", status: "granted", quote: "Territoire : France uniquement", remaining: null },
          { id: "c2", status: "granted", quote: "Formats : 2 TikTok de 20 à 30 secondes en 9:16, et 3 stories verticales", remaining: null },
          { id: "c3", status: "granted", quote: "On prévoit 2 allers-retours de révisions", remaining: null },
          { id: "c4", status: "granted", quote: "Paiement à 30 jours après réception des contenus", remaining: null },
        ],
        changes: [
          { group: "territory", quote: "Territoire : France uniquement" },
          { group: "amount", quote: "je peux monter à 600 €" },
          { group: "payment_terms", quote: "Paiement à 30 jours après réception des contenus" },
        ],
        brand_questions: [],
        uncertainties: [],
        next_message: {
          text: "Bonjour,\n\nMerci pour votre retour et pour ces précisions. Je note les 6 mois de droits pub.\n\nPour ce projet, mon tarif se situe {{CONTRE_OFFRE}}.\n\n{{SITUATION}}\n\nPourriez-vous me préciser la durée des stories, le maximum d'allers-retours et l'échéancier ?\n\nBelle journée,",
          tone: "Poli et ferme",
        },
      },
    ),
  );
}

// Tour 3 : la marque complète, monte à 900 €, et dit que c'est son maximum.
// Le modèle, lui, redemande trois points déjà répondus au tour 2.
function turn3(original: ReturnType<typeof baseAnalysis>, previous: TurnPayload[]): TurnPayload {
  const context: TurnContext = { original, previous, turnNumber: 3, tier: "confirmed", brandReply: REPLY_3 };
  const before = previous[previous.length - 1].deal_after;
  return turn(
    context,
    reading(
      before,
      { payment: { amount_eur: 900, terms_days: 30, schedule: "en une fois" } },
      {
        outcome: "counter",
        global_agreement: null,
        asks: [
          { id: "prix", status: "countered", quote: "je peux aller jusqu'à 900 €", remaining: null },
          { id: "c1", status: "unanswered", quote: null, remaining: null },
          { id: "c2", status: "granted", quote: "Les stories font 15 secondes chacune", remaining: null },
          { id: "c3", status: "granted", quote: "les 2 allers-retours sont bien un maximum", remaining: null },
          { id: "c4", status: "granted", quote: "Paiement en une fois, à 30 jours après réception et validation", remaining: null },
        ],
        changes: [
          { group: "amount", quote: "je peux aller jusqu'à 900 €" },
          { group: "payment_terms", quote: "Paiement en une fois, à 30 jours après réception et validation" },
        ],
        brand_questions: [],
        uncertainties: [],
        next_message: {
          text: "Bonjour,\n\nMerci pour ces précisions.\n\nPour ce projet, mon tarif se situe {{CONTRE_OFFRE}}.\n\nPourriez-vous me confirmer le territoire, la durée des droits publicitaires et les modalités de validation ?\n\nBelle journée,",
          tone: "Poli et ferme",
        },
      },
    ),
  );
}

const logs: Array<Record<string, unknown>> = [];

beforeEach(() => {
  logs.length = 0;
  vi.spyOn(console, "warn").mockImplementation((line: unknown) => {
    logs.push(JSON.parse(String(line)) as Record<string, unknown>);
  });
});

const logged = (event: string) => logs.filter((entry) => entry.event === event);
const point = (payload: TurnPayload, key: string) => payload.points.find((entry) => entry.key === key);

// Un tour où la marque ne dit qu'un montant : tous les autres points restent
// ouverts, la négociation continue, et c'est le message du modèle qui sort.
function amountOnlyTurn(original: ReturnType<typeof baseAnalysis>, draft: string): TurnPayload {
  const brandReply = "On peut monter à 1 500 € pour ce projet.";
  return turn(
    { original, previous: [], turnNumber: 2, tier: "confirmed", brandReply },
    reading(
      original.deal,
      { payment: { amount_eur: 1500 } },
      {
        outcome: "counter",
        global_agreement: null,
        asks: [{ id: "prix", status: "countered", quote: "On peut monter à 1 500 €", remaining: null }],
        changes: [{ group: "amount", quote: "On peut monter à 1 500 €" }],
        brand_questions: [],
        uncertainties: [],
        next_message: { text: draft, tone: "Clair" },
      },
    ),
  );
}

describe("défaut 1 — le montant proposé est situé dans la fourchette", () => {
  it("1. la marque propose 600 € : le message dit l'écart, et le nombre vient du moteur", () => {
    const original = offer();
    const payload = turn2(original);
    const pricing = payload.pricing_after ?? payload.pricing_before;
    const low = pricing.total_low as number;
    const high = pricing.total_high as number;

    // Le cas réel : 600 € est sous le bas de la fourchette.
    expect(low).toBeGreaterThan(600);
    const manque = low - 600;
    expect(payload.message.text).toContain(`Votre proposition de ${formatEur(600)}`);
    expect(payload.message.text).toContain("reste en dessous de la fourchette");
    expect(payload.message.text).toContain(`il manque ${formatEur(manque)}`);
    // Les bornes citées sont celles du moteur, pas des nombres du modèle.
    expect(payload.message.text).toContain(`de ${formatEur(low)} à ${formatEur(high)}`);
  });

  it("5. le montant tombe dans la fourchette : le message propose de conclure dès ce tour", () => {
    const original = offer();
    const context: TurnContext = { original, previous: [], turnNumber: 2, tier: "confirmed", brandReply: "On peut monter à 1 500 € pour ce projet." };
    const payload = turn(
      context,
      reading(
        original.deal,
        { payment: { amount_eur: 1500 } },
        {
          outcome: "counter",
          global_agreement: null,
          asks: [{ id: "prix", status: "countered", quote: "On peut monter à 1 500 €", remaining: null }],
          changes: [{ group: "amount", quote: "On peut monter à 1 500 €" }],
          brand_questions: [],
          uncertainties: [],
          next_message: { text: "Bonjour,\n\nMerci pour votre retour.\n\n{{SITUATION}}\n\nBelle journée,", tone: "Clair" },
        },
      ),
    );
    const pricing = payload.pricing_after ?? payload.pricing_before;
    expect((pricing.total_low as number) <= 1500 && 1500 <= (pricing.total_high as number)).toBe(true);
    expect(payload.message.text).toContain("se situe dans la fourchette");
    expect(payload.message.text).toContain("je vous propose de conclure sur cette base");
  });
});

describe("défaut 1 — les chiffres ne viennent que du moteur", () => {
  it("1 bis. un chiffre qui ne fait pas partie des valeurs autorisées n'est pas écrit", () => {
    const position = positionOfAmount(600, 970, 2210);
    if (!position) throw new Error("aucune position");
    expect(situationSentence(position, "fr", new Set([600, 970, 2210, 370]))).toContain("il manque");
    // L'écart (370) retiré des valeurs autorisées : aucune phrase plutôt qu'un
    // nombre dont on ne sait pas d'où il sort.
    expect(situationSentence(position, "fr", new Set([600, 970, 2210]))).toBeNull();
  });

  it("1 ter. le modèle n'a pas posé d'emplacement : la phrase est ajoutée avant la formule de politesse", () => {
    const original = offer();
    const payload = amountOnlyTurn(original, "Bonjour,\n\nMerci pour votre retour.\n\nJe reste disponible pour en discuter.\n\nBelle journée,");
    const lines = payload.message.text.split(/\n{2,}/);
    const at = lines.findIndex((line) => line.startsWith("Votre proposition de"));
    expect(at).toBeGreaterThan(0);
    // Jamais sous la signature, jamais collée à la salutation.
    expect(lines.slice(at + 1).every((line) => /^(Je reste disponible|Belle journée)/.test(line))).toBe(true);
  });
});

describe("défaut 2 — ce qui est répondu n'est plus redemandé", () => {
  it("2 bis. une question sur un point que la marque vient de renseigner dans CE message est gardée", () => {
    const original = offer();
    const payload = amountOnlyTurn(
      original,
      "Bonjour,\n\nMerci pour votre retour.\n\n{{SITUATION}}\n\nPourriez-vous me confirmer le budget définitif ?\n\nBelle journée,",
    );
    // Le point « rémunération » vient d'être renseigné : la question peut
    // porter sur ce que la marque n'a pas couvert. Elle n'est pas redondante.
    expect(payload.message.text).toContain("le budget définitif");
    expect(payload.dropped_questions).toEqual([]);
  });

  it("2. « France uniquement » au tour 2 : le territoire est mémorisé, avec la phrase exacte", () => {
    const payload = turn2(offer());
    const territory = point(payload, "territory");
    expect(territory?.status).toBe("answered");
    expect(territory?.turn).toBe(2);
    // La citation est un extrait du texte réellement collé.
    expect(quoteIsIn(String(territory?.quote), REPLY_2)).toBe(true);
    // Les six autres points renseignés dans cette réponse le sont aussi.
    expect(point(payload, "formats")?.status).toBe("answered");
    expect(point(payload, "content_duration")?.status).toBe("answered");
    expect(point(payload, "revisions")?.status).toBe("answered");
    expect(point(payload, "payment")?.status).toBe("answered");
    expect(point(payload, "validation")?.status).toBe("answered");
    // La marque a dit qu'elle ne bougerait pas : refusé, pas « répondu ».
    expect(point(payload, "usage_duration")?.status).toBe("refused");
    // Aucune exclusivité dans cette offre : le point n'est pas suivi.
    expect(point(payload, "exclusivity")).toBeUndefined();
  });

  it("3. une question redondante produite par le modèle est supprimée et journalisée", () => {
    const original = offer();
    const first = turn2(original);
    const context: TurnContext = { original, previous: [first], turnNumber: 3, tier: "confirmed", brandReply: "On est toujours partants." };
    const payload = turn(
      context,
      reading(
        first.deal_after,
        {},
        {
          outcome: "vague",
          global_agreement: null,
          asks: [],
          changes: [],
          brand_questions: [],
          uncertainties: [],
          next_message: {
            text: "Bonjour,\n\nMerci pour votre retour.\n\nPourriez-vous me confirmer le territoire de diffusion ?\n\nJe reste disponible pour en discuter.\n\nBelle journée,",
            tone: "Clair",
          },
        },
      ),
    );
    expect(payload.message.text).not.toContain("territoire");
    expect(payload.dropped_questions.map((dropped) => dropped.point)).toContain("territory");
    expect(logged("negociation_question_redondante")[0]).toMatchObject({ point: "territory", tour: 3 });
  });

  it("6. rejeu des trois tours : au tour 3, ni territoire, ni durée des droits, ni validation", () => {
    const original = offer();
    const second = turn2(original);
    const third = turn3(original, [second]);

    // Le modèle a bien reposé les trois questions : elles ont été retirées.
    expect(third.dropped_questions.map((dropped) => dropped.point).sort()).toEqual(["territory", "usage_duration", "validation"]);
    for (const key of ["territory", "usage_duration", "validation"]) {
      expect(logged("negociation_question_redondante").some((entry) => entry.point === key), key).toBe(true);
    }
    const message = third.message.text.toLowerCase();
    expect(message).not.toContain("territoire");
    expect(message).not.toContain("droits publicitaires");
    expect(message).not.toContain("validation");
    // La mémoire a bien traversé les tours : le point du tour 2 est toujours là.
    expect(point(third, "territory")).toMatchObject({ status: "answered", turn: 2 });
    expect(point(third, "usage_duration")).toMatchObject({ status: "refused", turn: 2 });
  });
});

describe("défaut 3 — la négociation conclut", () => {
  it("4. tous les points répondus et un montant sur la table : les deux messages sont fournis", () => {
    const original = offer();
    const third = turn3(original, [turn2(original)]);

    expect(third.points.every((entry) => entry.status !== "unknown")).toBe(true);
    expect(third.closing).not.toBeNull();
    const closing = third.closing;
    if (!closing) throw new Error("aucune clôture");
    // L'état final du deal, ligne par ligne. Le montant retenu est celui qui est
    // ÉCRIT : « jusqu'à 900 € » est un plafond, pas un engagement (mission
    // #081), il ne remplace donc pas les 600 € du tour précédent — et le doute
    // le dit. Le plafond, lui, est situé dans la fourchette (défaut 1).
    expect(closing.recap.some((row) => row.label === "Rémunération" && row.value.includes("600"))).toBe(true);
    expect(third.uncertainties.join(" ")).toContain("jusqu'à 900 €");
    expect(third.situation).toMatchObject({ kind: "below", source: "ceiling", amount: 900 });
    expect(third.message.text).toContain(`Le plafond que vous indiquez, ${formatEur(900)}`);
    // Deux messages, et ce que chacun implique.
    expect(closing.accept.text).toContain("Bonjour,");
    expect(closing.accept.implies).toContain("tu acceptes les termes");
    expect(closing.hold.text).toContain("mon tarif se situe");
    expect(closing.hold.implies).toContain("tu maintiens ton tarif");
    // La marque a dit que c'était son maximum : c'est dit, sans trancher.
    expect(closing.hold.implies).toContain("son maximum");
    // L'écart annoncé porte sur le montant RETENU (600 €), pas sur le plafond.
    expect(closing.accept.implies).toContain(formatEur(600));
    expect(closing.accept.implies).toContain(`${formatEur((third.pricing_before.total_low as number) - 600)} sous le bas`);
    // Aucune nouvelle question dans l'un ou l'autre : le message qui accepte ne
    // demande qu'une confirmation écrite de l'ensemble, jamais un point resté
    // en suspens (il n'y en a plus).
    expect(closing.accept.text).not.toContain("Pourriez-vous aussi me préciser");
    expect(closing.accept.text).toContain("me confirmer ces points par écrit");
    expect(closing.hold.text).not.toContain("?");
    // Le tour ne conclut pas à sa place : rien n'est enregistré comme conclu.
    expect(third.conclusion).toBeNull();
  });
});
