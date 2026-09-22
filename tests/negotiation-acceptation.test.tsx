import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConclusionView } from "@/components/result/negotiation/conclusion-view";
import { ThreadError, ThreadPending } from "@/components/result/negotiation/thread-status";
import { TurnCard } from "@/components/result/negotiation/turn-card";
import { formatEur } from "@/lib/money";
import { agreedItem, conclusionMessage, remainingAgreed } from "@/lib/negotiation/conclusion";
import { offeredAmount } from "@/lib/negotiation/closing";
import { statedCeiling } from "@/lib/negotiation/gap";
import { baseAnalysis } from "@/lib/negotiation/scenarios";
import { processTurn, type TurnContext } from "@/lib/negotiation/turn";
import { turnReadingSchema, type Deal, type PointState, type Pricing, type TurnPayload, type TurnReading } from "@/lib/negotiation/types";
import {
  CONCLUSION_ANCHOR,
  nextReveal,
  reveal,
  THREAD_ERROR_ID,
  THREAD_PENDING_ID,
  turnAnchorId,
  type Revealable,
  type Revealed,
} from "@/lib/ui/reveal";
import { allowedAmounts, displayedAmounts } from "@/tests/helpers/amounts";

// Mission #096 — le message qui accepte ne doit jamais valoir moins que ce que
// la marque a proposé, et on doit voir la réponse arriver.
//
// Rejeu du cas réel du 23/09/2026 : 2 TikTok + 3 stories, produits 120 €,
// 150 €, droits pub 6 mois. Tour 2 : « je peux monter à 600 € » (retenu).
// Tour 3 : « jusqu'à 900 €, c'est le maximum de mon enveloppe » (plafond, non
// retenu dans les termes). Le modèle est simulé, aucun réseau.

const DEMANDES = [
  "Limiter les droits publicitaires à 6 mois et préciser le territoire concerné.",
  "Confirmer par écrit si une publication sur ton compte est requise.",
  "Préciser la plateforme des stories et les formats attendus.",
  "Fixer les modalités et le délai de paiement.",
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

const REPLY_2 =
  "Territoire : France uniquement. Formats : 2 TikTok de 20 à 30 secondes en 9:16, et 3 stories verticales. On prévoit 2 allers-retours de révisions. Paiement à 30 jours après réception des contenus. Par contre les 6 mois de droits pub, on ne peut pas bouger dessus. Côté budget, je peux monter à 600 € en plus des produits offerts. Validation : c'est moi qui valide, en 48h max.";

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
          { id: "prix", status: "countered", quote: "je peux monter à 600 €", remaining: null },
          { id: "c1", status: "granted", quote: "Territoire : France uniquement", remaining: null },
          { id: "c2", status: "granted", quote: "Formats : 2 TikTok de 20 à 30 secondes en 9:16, et 3 stories verticales", remaining: null },
          { id: "c3", status: "granted", quote: "Paiement à 30 jours après réception des contenus", remaining: null },
        ],
        changes: [
          { group: "territory", quote: "Territoire : France uniquement" },
          { group: "amount", quote: "je peux monter à 600 €" },
          { group: "payment_terms", quote: "Paiement à 30 jours après réception des contenus" },
        ],
        brand_questions: [],
        uncertainties: [],
        next_message: { text: "Bonjour,\n\nMerci pour votre retour.\n\n{{SITUATION}}\n\nBelle journée,", tone: "Clair" },
      },
    ),
  );
}

// Le tour 3 : la marque annonce un plafond. Le texte est paramétrable pour
// rejouer les variantes (plafond plus bas, deuxième plafond, aucun plafond).
function turn3(original: ReturnType<typeof baseAnalysis>, previous: TurnPayload[], brandReply: string): TurnPayload {
  const before = previous[previous.length - 1].deal_after;
  return turn(
    { original, previous, turnNumber: 3, tier: "confirmed", brandReply },
    reading(
      before,
      { payment: { schedule: "en une fois" } },
      {
        outcome: "counter",
        global_agreement: null,
        asks: [{ id: "prix", status: "countered", quote: "budget", remaining: null }],
        changes: [],
        brand_questions: [],
        uncertainties: [],
        next_message: { text: "Bonjour,\n\nMerci pour ces précisions.\n\nBelle journée,", tone: "Clair" },
      },
    ),
  );
}

const CEILING_900 = "Les stories font 15 secondes chacune. Oui, les 2 allers-retours sont bien un maximum. Paiement en une fois, à 30 jours après réception et validation. J'ai refait un tour côté budget : je peux aller jusqu'à 900 € en plus des produits offerts. C'est le maximum de mon enveloppe.";
const CEILING_500 = CEILING_900.replace("jusqu'à 900 €", "jusqu'à 500 €");
const CEILING_800 = CEILING_900.replace("jusqu'à 900 €", "jusqu'à 800 €");
const NO_CEILING = CEILING_900.replace("J'ai refait un tour côté budget : je peux aller jusqu'à 900 € en plus des produits offerts. C'est le maximum de mon enveloppe.", "On reste sur ce qui est prévu.");

const closingOf = (payload: TurnPayload) => {
  const closing = payload.closing;
  if (!closing) throw new Error("aucune clôture");
  return closing;
};

describe("défaut 1 — l'acceptation porte le montant le plus élevé", () => {
  it("1. plafond 900 € et montant retenu 600 € : le message porte 900 € et en demande confirmation", () => {
    const original = offer();
    const third = turn3(original, [turn2(original)], CEILING_900);
    const accept = closingOf(third).accept;

    expect(accept.offered).toBe(900);
    expect(accept.text).toContain(`C'est d'accord pour avancer sur la base de ${formatEur(900)}, le montant que vous proposez.`);
    expect(accept.text).toContain(`Rémunération : ${formatEur(900)}`);
    expect(accept.text).toContain("me confirmer ces points par écrit");
    // Jamais présenté comme acquis, et jamais les 600 € du tour précédent.
    expect(accept.text).not.toContain("vous avez accepté");
    expect(accept.text).not.toContain(formatEur(600));
    // Les TERMES ne bougent pas : un plafond n'est pas un accord (règle #081).
    expect(third.deal_after.payment.amount_eur).toBe(600);
    expect(third.stated_ceiling).toBe(900);
  });

  it("2. la carte dit que 900 € est le montant proposé, à confirmer, et calcule l'écart dessus", () => {
    const original = offer();
    const third = turn3(original, [turn2(original)], CEILING_900);
    const closing = closingOf(third);
    const low = (third.pricing_after ?? third.pricing_before).total_low as number;

    const row = closing.recap.find((entry) => entry.label === "Rémunération");
    expect(row?.value).toContain(formatEur(900));
    expect(row?.value).toContain("le montant que la marque propose, encore à confirmer par écrit");
    expect(closing.accept.implies).toContain("c'est le montant que la marque propose");
    expect(closing.accept.implies).toContain(`${formatEur(low - 900)} sous le bas`);
    expect(closing.accept.implies).not.toContain(formatEur(low - 600));
  });

  it("3. le message qui tient le prix est inchangé et cite toujours le plafond", () => {
    const original = offer();
    const third = turn3(original, [turn2(original)], CEILING_900);
    const closing = closingOf(third);
    const pricing = third.pricing_after ?? third.pricing_before;

    expect(closing.hold.text).toContain(`Le plafond que vous indiquez, ${formatEur(900)}`);
    expect(closing.hold.text).toContain(`mon tarif se situe entre ${formatEur(pricing.counter_low as number)}`);
    expect(closing.hold.implies).toContain("tu maintiens ton tarif");
  });

  it("4. plafond 500 € alors que 600 € est retenu : le message porte 600 €", () => {
    const original = offer();
    const third = turn3(original, [turn2(original)], CEILING_500);
    const accept = closingOf(third).accept;

    expect(third.stated_ceiling).toBe(500);
    expect(accept.offered).toBeNull();
    expect(accept.text).toContain(`Rémunération : ${formatEur(600)}`);
    expect(accept.text).not.toContain("le montant que vous proposez");
  });

  it("5. deux plafonds successifs, 900 € puis 800 € : c'est 800 € qui est repris", () => {
    const original = offer();
    const second = turn2(original);
    const third = turn3(original, [second], CEILING_900);
    const fourth = turn(
      { original, previous: [second, third], turnNumber: 4, tier: "confirmed", brandReply: CEILING_800 },
      reading(
        third.deal_after,
        {},
        {
          outcome: "counter",
          global_agreement: null,
          asks: [{ id: "prix", status: "countered", quote: "800", remaining: null }],
          changes: [],
          brand_questions: [],
          uncertainties: [],
          next_message: { text: "Bonjour,\n\nMerci.\n\nBelle journée,", tone: "Clair" },
        },
      ),
    );

    // Le plus RÉCENT fait foi, pas le plus élevé.
    expect(fourth.stated_ceiling).toBe(800);
    expect(closingOf(fourth).accept.offered).toBe(800);
    expect(closingOf(fourth).accept.text).toContain(formatEur(800));
    expect(closingOf(fourth).accept.text).not.toContain(formatEur(900));
  });

  it("6. aucun plafond annoncé : rien ne change", () => {
    const original = offer();
    const third = turn3(original, [turn2(original)], NO_CEILING);
    const accept = closingOf(third).accept;

    expect(third.stated_ceiling).toBeNull();
    expect(accept.offered).toBeNull();
    expect(accept.text).toContain(`Rémunération : ${formatEur(600)}`);
  });

  it("7. tout chiffre du message qui accepte fait partie des valeurs autorisées", () => {
    const original = offer();
    const third = turn3(original, [turn2(original)], CEILING_900);
    const closing = closingOf(third);
    const allowed = allowedAmounts(third);
    for (const amount of displayedAmounts(closing.accept.text)) {
      expect(allowed.has(amount), `${amount} € dans le message qui accepte`).toBe(true);
    }
    for (const amount of displayedAmounts(`${closing.accept.implies} ${closing.recap.map((row) => row.value).join(" ")}`)) {
      expect(allowed.has(amount), `${amount} € dans la carte`).toBe(true);
    }
    // Un plafond qui n'est pas un montant n'est jamais repris.
    const pricing: Pricing = third.pricing_after ?? third.pricing_before;
    expect(offeredAmount(third.deal_after, Number.NaN, pricing)).toBeNull();
    expect(offeredAmount(third.deal_after, -100, pricing)).toBeNull();
  });
});

describe("défaut 2 — « Convenu en plus » n'est plus du copier-coller", () => {
  const points: PointState[] = [
    { key: "usage_duration", status: "refused", quote: "les 6 mois de droits pub, on ne peut pas bouger dessus", turn: 2 },
    { key: "territory", status: "answered", quote: "Territoire : France uniquement", turn: 2 },
    { key: "payment", status: "answered", quote: "Paiement à 30 jours", turn: 2 },
    { key: "formats", status: "answered", quote: "2 TikTok et 3 stories", turn: 2 },
  ];

  it("8. un point déjà répondu par la marque n'apparaît plus dans la liste", () => {
    const deal = offer().deal;
    const rest = remainingAgreed(DEMANDES, points, deal);
    expect(rest).not.toContain(DEMANDES[0]);
    expect(rest).not.toContain(DEMANDES[2]);
    expect(rest).not.toContain(DEMANDES[3]);
    // Ce qui n'a été réglé nulle part reste.
    expect(rest).toContain(DEMANDES[1]);
  });

  it("9. plus rien à dire : la ligne n'est pas rendue du tout", () => {
    const deal = offer().deal;
    // Les trois demandes dont la marque a réglé le sujet, et elles seules.
    const covered = [DEMANDES[0], DEMANDES[2], DEMANDES[3]];
    expect(remainingAgreed(covered, points, deal)).toEqual([]);
    const message = conclusionMessage(deal, "fr", covered, null, { points, dealRead: deal });
    expect(message).not.toContain("Convenu en plus");
    expect(message).not.toContain("Il est également convenu de");
    // La preuve que la liste aurait eu de quoi se remplir sans le filtre.
    expect(conclusionMessage(deal, "fr", covered, null, {})).toContain("Il est également convenu de :");
  });

  it("10. la ligne rendue ne tutoie pas et ne commande pas", () => {
    const deal = offer().deal;
    const items = remainingAgreed(DEMANDES, points, deal).map((label) => agreedItem(label, "fr"));
    expect(items).toEqual(["confirmer par écrit si une publication sur mon compte est requise"]);
    for (const item of items) {
      // Ni tutoiement, ni majuscule d'ouverture qui ferait une injonction.
      expect(/(?<![\p{L}])(?:ton|ta|tes|toi|tu)(?![\p{L}])/iu.test(item), item).toBe(false);
      expect(/^[A-ZÀ-Ý]/u.test(item), item).toBe(false);
    }
    // Une demande qui n'est pas une action est rattachée sans devenir un ordre.
    expect(agreedItem("2 révisions incluses", "fr")).toBe("retenir 2 révisions incluses");
  });
});

describe("défaut 3 — on voit la réponse arriver", () => {
  const stub = () => {
    const calls: { scroll: Revealed[]; focus: Array<{ preventScroll: boolean }> } = { scroll: [], focus: [] };
    const element: Revealable = {
      scrollIntoView: (options) => calls.scroll.push(options),
      focus: (options) => calls.focus.push(options),
    };
    return { element, calls };
  };

  it("11. un nouveau tour arrive : la mise en vue vise sa carte, et le focus son titre", () => {
    const target = nextReveal({ turnNumbers: [2], concluded: false, error: false }, { turnNumbers: [2, 3], concluded: false, error: false });
    expect(target).toBe(turnAnchorId(3));

    const { element, calls } = stub();
    expect(reveal(element, false)).toEqual({ behavior: "smooth", block: "start" });
    // Le HAUT de la carte, pas le bas de la page.
    expect(calls.scroll).toEqual([{ behavior: "smooth", block: "start" }]);
    expect(calls.focus).toEqual([{ preventScroll: true }]);

    // Le titre porte bien cet identifiant, et peut recevoir le focus.
    const html = renderToStaticMarkup(
      <TurnCard turnNumber={3} createdAt="2026-09-23T10:00:00.000Z" brandReply={null} payload={turn3(offer(), [turn2(offer())], CEILING_900)} />,
    );
    expect(html).toContain(`id="${turnAnchorId(3)}"`);
    expect(html.slice(html.indexOf(`id="${turnAnchorId(3)}"`), html.indexOf(`id="${turnAnchorId(3)}"`) + 200)).toContain('tabindex="-1"');

    // Rien de neuf : rien ne bouge (aucun défilement au premier affichage).
    expect(nextReveal({ turnNumbers: [2, 3], concluded: false, error: false }, { turnNumbers: [2, 3], concluded: false, error: false })).toBeNull();
  });

  it("11 bis. l'écran de conclusion est amené en vue de la même façon", () => {
    const target = nextReveal({ turnNumbers: [2], concluded: false, error: false }, { turnNumbers: [2], concluded: true, error: false });
    expect(target).toBe(CONCLUSION_ANCHOR);
    const html = renderToStaticMarkup(
      <ConclusionView conclusion={{ source: "creator_accepted", recap: [], unclear: [], message: "Bonjour,", legal_note: "" }} />,
    );
    expect(html).toContain(`id="${CONCLUSION_ANCHOR}"`);
    expect(html).toContain('tabindex="-1"');
  });

  it("12. avec prefers-reduced-motion, la mise en vue est instantanée", () => {
    const { element, calls } = stub();
    expect(reveal(element, true)).toEqual({ behavior: "auto", block: "start" });
    expect(calls.scroll).toEqual([{ behavior: "auto", block: "start" }]);
    // Élément absent (rendu pas encore fait) : rien, et aucune erreur.
    expect(reveal(null, true)).toBeNull();
  });

  it("13. en cas d'échec, c'est le message d'erreur qui est amené en vue", () => {
    const target = nextReveal({ turnNumbers: [2], concluded: false, error: false }, { turnNumbers: [2], concluded: false, error: true });
    expect(target).toBe(THREAD_ERROR_ID);

    const html = renderToStaticMarkup(<ThreadError message="La réponse n'a pas pu être analysée." />);
    expect(html).toContain(`id="${THREAD_ERROR_ID}"`);
    expect(html).toContain('role="alert"');
    expect(html).toContain('tabindex="-1"');

    // L'attente, elle, s'affiche à la place qu'occupera le tour.
    const pending = renderToStaticMarkup(<ThreadPending turnNumber={3} />);
    expect(pending).toContain(`id="${THREAD_PENDING_ID}"`);
    expect(pending).toContain('role="status"');
    expect(pending).toContain("Lecture de la réponse de la marque");
  });
});

// Le plafond est lu dans le texte de la marque, par le code.
describe("le plafond annoncé", () => {
  it("est lu tel qu'il est écrit, et seulement quand il est borné", () => {
    expect(statedCeiling("je peux aller jusqu'à 900 € en plus des produits")).toBe(900);
    expect(statedCeiling("au maximum 1 200 € pour ce projet")).toBe(1200);
    expect(statedCeiling("on part sur 600 € comme prévu")).toBeNull();
  });
});
