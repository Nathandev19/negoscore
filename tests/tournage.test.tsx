import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LegalNotice } from "@/components/result/analysis-blocks";
import { OFFER_QUOTE_MISSING, TurnCard } from "@/components/result/negotiation/turn-card";
import { lockAnalysis } from "@/lib/analysis/lock";
import { formatEur } from "@/lib/money";
import { emptyPoints, offerCitation, POINTS, sentencesOf, splitReserves } from "@/lib/negotiation/points";
import { quoteIsIn } from "@/lib/negotiation/quotes";
import { baseAnalysis } from "@/lib/negotiation/scenarios";
import { processTurn, type TurnContext } from "@/lib/negotiation/turn";
import { turnReadingSchema, type Deal, type TurnPayload, type TurnReading } from "@/lib/negotiation/types";
import { verdictCardTexts } from "@/lib/share-card/verdict-card";
import { carteDepuisChiffrage, ligneOffreDuDeal } from "@/lib/share-card/verdict-data";
import { projectionAnalyse, projectionFil } from "./helpers/carte-projection";
import type { Analysis } from "@/lib/schema";

// Mission #100 — les quatre défauts relevés pendant le tournage du 23/09/2026.
//
// Rejeu de la négociation filmée : 2 TikTok + 3 stories, produits offerts
// (120 €), 150 € de rémunération, droits pub 6 mois. Le modèle est SIMULÉ,
// comme dans tests/negotiation-memoire.test.ts : les lectures sont écrites à la
// main et c'est le CODE qui est mis à l'épreuve. Aucun réseau, aucun appel.

// Le texte collé par la créatrice, mot pour mot. C'est dans CE texte que les
// citations du tour 1 doivent se retrouver.
const OFFRE = [
  "Bonjour ! On prépare le lancement de notre nouvelle collection et on aimerait travailler avec toi.",
  "On imagine 2 vidéos TikTok et 3 stories Instagram sur le mois d'octobre.",
  "On t'envoie la sélection de produits, d'une valeur de 120 €, et on ajoute 150 € de rémunération.",
  "On voudrait aussi les droits pour les réutiliser sur nos réseaux et en pub pendant 6 mois.",
  "Dis-nous si ça te parle !",
].join(" ");

const PHRASE_DROITS = "On voudrait aussi les droits pour les réutiliser sur nos réseaux et en pub pendant 6 mois.";

const DEMANDES = [
  "Préciser le territoire de diffusion",
  "Préciser les formats et la durée des contenus",
  "Limiter les révisions à 2 allers-retours",
  "Paiement à 30 jours",
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
  "Territoire : France uniquement. Formats : 2 TikTok de 20 à 30 secondes en 9:16, et 3 stories verticales. On prévoit 2 allers-retours de révisions. Paiement à 30 jours après réception des contenus. Par contre les 6 mois de droits pub, on ne peut pas bouger dessus. Sur le budget, je peux monter à 600 € en plus des produits. Validation : c'est moi qui valide, en 48h max.";

const REPLY_3 =
  "Les stories font 15 secondes chacune. Oui, les 2 allers-retours sont bien un maximum. Paiement en une fois, à 30 jours après réception des contenus. J'ai refait un tour côté budget : je peux aller jusqu'à 900 € en plus des produits offerts. C'est le maximum de mon enveloppe.";

// Le doute écrit par le modèle au tour 3, relevé pendant le tournage : il porte
// sur la validation, point que la marque a pourtant renseigné au tour 2.
const DOUTE_VALIDATION = "La procédure de validation des contenus n'est pas détaillée.";

function turn2(original: ReturnType<typeof baseAnalysis>, offerText: string | null = OFFRE): TurnPayload {
  const context: TurnContext = { original, previous: [], turnNumber: 2, tier: "confirmed", brandReply: REPLY_2, offerText };
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
          text: "Bonjour,\n\nMerci pour votre retour et pour ces précisions.\n\nPour ce projet, mon tarif se situe {{CONTRE_OFFRE}}.\n\n{{SITUATION}}\n\nPourriez-vous me préciser la durée des stories et l'échéancier ?\n\nBelle journée,",
          tone: "Poli et ferme",
        },
      },
    ),
  );
}

// Tour 3 : la marque complète, annonce 900 € et dit que c'est son maximum. Le
// montant n'est pas un terme convenu (règle #081) : les termes gardent 600 €,
// le plafond annoncé vaut 900 €. Le modèle, lui, redoute la validation.
function turn3(
  original: ReturnType<typeof baseAnalysis>,
  previous: TurnPayload[],
  { offerText = OFFRE as string | null, doubts = [DOUTE_VALIDATION] }: { offerText?: string | null; doubts?: string[] } = {},
): TurnPayload {
  const context: TurnContext = { original, previous, turnNumber: 3, tier: "confirmed", brandReply: REPLY_3, offerText };
  const before = previous[previous.length - 1].deal_after;
  return turn(
    context,
    reading(
      before,
      { payment: { terms_days: 30, schedule: "en une fois" } },
      {
        outcome: "counter",
        global_agreement: null,
        asks: [
          { id: "prix", status: "countered", quote: "je peux aller jusqu'à 900 €", remaining: null },
          { id: "c2", status: "granted", quote: "Les stories font 15 secondes chacune", remaining: null },
          { id: "c3", status: "granted", quote: "les 2 allers-retours sont bien un maximum", remaining: null },
          { id: "c4", status: "granted", quote: "Paiement en une fois, à 30 jours après réception des contenus", remaining: null },
        ],
        changes: [{ group: "payment_terms", quote: "Paiement en une fois, à 30 jours après réception des contenus" }],
        brand_questions: [],
        uncertainties: doubts,
        next_message: {
          text: "Bonjour,\n\nMerci pour ces précisions.\n\nPour ce projet, mon tarif se situe {{CONTRE_OFFRE}}.\n\nBelle journée,",
          tone: "Poli et ferme",
        },
      },
    ),
  );
}

const point = (payload: TurnPayload, key: string) => {
  const found = payload.points.find((entry) => entry.key === key);
  if (!found) throw new Error(`point absent : ${key}`);
  return found;
};

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&#xE9;/g, "é")
    .replace(/[\s  ]+/g, " ");

// ─── Point 1 — un doute et une réponse sur le même point ────────────────────

describe("point 1 — une réserve s'affiche avec le point qu'elle commente", () => {
  it("1. le doute sur un point déjà renseigné quitte le bloc des doutes et devient une réserve de ce point", () => {
    const original = offer();
    const payload = turn3(original, [turn2(original)]);

    // La marque a répondu sur la validation au tour 2, citation à l'appui.
    const validation = point(payload, "validation");
    expect(validation.status).toBe("answered");
    expect(validation.turn).toBe(2);
    expect(validation.quote).toContain("c'est moi qui valide");

    // Le doute ne se lit plus comme une contradiction : il est porté par le point.
    expect(payload.uncertainties).not.toContain(DOUTE_VALIDATION);
    expect(validation.reserves).toEqual([DOUTE_VALIDATION]);
  });

  it("2. le doute sur un point que l'outil n'a pas su lire reste un doute, et n'est la réserve de personne", () => {
    const deal = offer().deal;
    // Rien n'a encore été renseigné sur la validation : l'offre n'en parle pas.
    const points = emptyPoints(deal, DEMANDES, OFFRE);
    expect(point({ points } as TurnPayload, "validation").status).toBe("unknown");

    const split = splitReserves([DOUTE_VALIDATION], points, deal);
    expect(split.doubts).toEqual([DOUTE_VALIDATION]);
    expect(split.points.every((entry) => entry.reserves.length === 0)).toBe(true);
  });

  it("3. à l'écran, la réserve est sous la citation du point, et plus dans « l'outil n'est pas sûr »", () => {
    const original = offer();
    const payload = turn3(original, [turn2(original)]);
    const page = text(renderToStaticMarkup(<TurnCard turnNumber={3} createdAt="2026-09-23T10:00:00.000Z" brandReply={REPLY_3} payload={payload} />));

    // Une seule occurrence de la phrase : celle qui suit la citation de la validation.
    expect(page.split(DOUTE_VALIDATION).length - 1).toBe(1);
    const memoire = page.slice(page.indexOf("Ce que la marque a déjà renseigné"));
    expect(memoire).toContain(`Validation — répondu au tour 2`);
    expect(memoire).toContain(`Reste à préciser : ${DOUTE_VALIDATION}`);
    // Le bloc des doutes n'existe plus : il ne restait que celle-là.
    expect(page).not.toContain("L'outil n'est pas sûr de tout ce qu'il a lu");
  });
});

// ─── Point 2 — « répondu au tour 1 » sans citation ──────────────────────────

describe("point 2 — un point réglé par l'offre porte la phrase de l'offre", () => {
  it("4. la durée des droits cite l'offre mot pour mot, et la phrase existe dans le texte collé", () => {
    const original = offer();
    const payload = turn3(original, [turn2(original)]);
    const droits = point(payload, "usage_duration");

    expect(droits.turn).toBe(2);
    // Au tour 1, avant toute réponse : c'est l'offre qui le dit.
    const depart = emptyPoints(original.deal, DEMANDES, OFFRE).find((entry) => entry.key === "usage_duration");
    expect(depart?.turn).toBe(1);
    expect(depart?.quote).toBe(PHRASE_DROITS);
    expect(quoteIsIn(PHRASE_DROITS, OFFRE)).toBe(true);
    expect(OFFRE).toContain(PHRASE_DROITS);

    // La marque redit les mêmes 6 mois au tour 2, dans ses mots : ce n'est pas
    // un changement de position, et l'écran ne le prétend pas.
    expect(droits.quote).toContain("les 6 mois de droits pub");
    expect(droits.previous).toBeNull();
    const page = text(renderToStaticMarkup(<TurnCard turnNumber={3} createdAt="2026-09-23T10:00:00.000Z" brandReply={REPLY_3} payload={payload} />));
    const ligne = page.slice(page.indexOf("Durée des droits —"));
    expect(ligne.slice(0, ligne.indexOf("Territoire —"))).not.toContain("La marque a changé de position");
  });

  it("5. la citation commence et finit sur une frontière de phrase, et ne coupe jamais un mot", () => {
    // Une phrase d'offre entière : les deux bornes sont celles de la phrase.
    expect(sentencesOf(OFFRE)).toContain(PHRASE_DROITS);

    // Une phrase trop longue est coupée à un mot entier, suivie d'une ellipse.
    const longue = `On voudrait les droits pour réutiliser ces contenus sur nos réseaux sociaux, sur notre site, dans nos newsletters et en publicité payante sur Meta comme sur TikTok, pendant 6 mois à compter de la publication.`;
    const usage = POINTS.find((entry) => entry.key === "usage_duration");
    if (!usage) throw new Error("point absent");
    const coupee = offerCitation(usage, `Bonjour ! ${longue}`);
    if (!coupee) throw new Error("aucune citation");
    expect(coupee.endsWith("…")).toBe(true);
    const garde = coupee.slice(0, -1);
    expect(longue.startsWith(garde)).toBe(true);
    // Ce qui est montré finit sur un mot entier du texte d'origine.
    expect(longue[garde.length]).toMatch(/[\s,;:.]/);
  });

  it("6. sans texte d'origine, l'écran dit que la phrase n'a pas été retrouvée au lieu de laisser un blanc", () => {
    const original = offer();
    // Même point, deux états de départ : avec le texte collé, et sans lui
    // (fichier déposé, ou texte effacé au bout de 30 jours).
    const avec = emptyPoints(original.deal, DEMANDES, OFFRE).find((entry) => entry.key === "usage_duration");
    const sans = emptyPoints(original.deal, DEMANDES, null).find((entry) => entry.key === "usage_duration");
    expect(avec?.quote).toBe(PHRASE_DROITS);
    expect(sans?.turn).toBe(1);
    expect(sans?.quote).toBeNull();

    const payload = { ...turn2(original, null), points: emptyPoints(original.deal, DEMANDES, null) };
    const page = text(renderToStaticMarkup(<TurnCard turnNumber={2} createdAt="2026-09-23T10:00:00.000Z" brandReply={REPLY_2} payload={payload} />));
    const memoire = page.slice(page.indexOf("Ce que la marque a déjà renseigné"));
    expect(memoire).toContain("Durée des droits — répondu dans l'offre de départ");
    expect(memoire).toContain(text(OFFER_QUOTE_MISSING).trim());
  });
});

// ─── Point 3 — une liste annoncée n'est jamais vide ─────────────────────────

function legalWith(clauses: string[]): Analysis["fr_legal"] {
  return {
    applicable: true,
    threshold_1000_reached: "no",
    written_contract_required: false,
    missing_mandatory_clauses: clauses,
    note: "En France, un contrat écrit est obligatoire au-delà d'un seuil.",
  };
}

describe("point 3 — le nombre annoncé et les puces viennent de la même source", () => {
  it("7. une entrée sans libellé n'est ni comptée ni affichée", () => {
    const page = text(renderToStaticMarkup(<LegalNotice legal={legalWith(["Modalités de paiement", "", "   "])} />));
    expect(page).toContain("1 mention obligatoire absente de l'offre.");
    expect(page).not.toContain("3 mentions obligatoires");
    expect(page).toContain("Modalités de paiement");
    // Une seule puce rendue, et pas de puce vide.
    const html = renderToStaticMarkup(<LegalNotice legal={legalWith(["Modalités de paiement", "", "   "])} />);
    expect(html.split("<li>").length - 1).toBe(1);
    expect(html).not.toContain("<li></li>");
  });

  it("8. toutes les entrées vides : la liste et l'annonce disparaissent ensemble", () => {
    const html = renderToStaticMarkup(<LegalNotice legal={legalWith(["", "  "])} />);
    const page = text(html);
    expect(page).toContain("Aucune mention obligatoire ne manque à l'offre.");
    expect(page).not.toContain("Mentions absentes de l'offre");
    expect(html).not.toContain("<li>");
    // Le reste du bloc, lui, ne disparaît pas.
    expect(page).toContain("Bon à savoir côté loi française");
  });
});

// ─── Point 4 — la carte partageable porte le montant de la conclusion ───────

describe("point 4 — le même montant sur la carte et à l'écran", () => {
  it("9. la carte annonce les 900 € proposés, pour ce qu'ils sont, et non les 600 € des termes", () => {
    const original = offer();
    const payload = turn3(original, [turn2(original)]);

    // Les termes ne retiennent pas le plafond (règle #081) : 600 € y restent.
    expect(payload.deal_after.payment.amount_eur).toBe(600);
    expect(payload.stated_ceiling).toBe(900);
    // L'écran de conclusion porte les 900 €.
    expect(payload.closing?.accept.offered).toBe(900);

    // Mission #169 — LE PLAFOND EST DANS LE CHIFFRAGE ENREGISTRÉ. Il n'est
    // plus passé à la carte au moment du rendu : il est décidé ici, à
    // l'écriture du tour, et la carte le LIT. C'est ce qui permet à la route
    // de ne rien recalculer.
    const chiffrage = payload.pricing_after ?? payload.pricing_before;
    expect(chiffrage.compared).toBe(900);
    expect(chiffrage.ceiling).toBe(true);

    const carte = verdictCardTexts(carteDepuisChiffrage(chiffrage, ligneOffreDuDeal(payload.deal_after)));
    expect(carte.proposeLabel).toBe("On m'a proposé jusqu'à");
    expect(carte.aConfirmer).toBe("à confirmer");
    expect(carte.propose).toBe(formatEur(900).replace(/\u202f/g, "\u00a0"));
    expect(carte.propose).not.toContain(formatEur(600));

    // Sans plafond annoncé, la carte dit ce que les termes retiennent.
    const simple = verdictCardTexts(
      carteDepuisChiffrage({ ...chiffrage, compared: 600, ceiling: false }, ligneOffreDuDeal(payload.deal_after)),
    );
    expect(simple.proposeLabel).toBe("On m'a proposé");
    expect(simple.aConfirmer).toBe(null);
    expect(simple.propose).toBe(formatEur(600).replace(/\u202f/g, "\u00a0"));
  });
});

// La route de la carte, avec ses dépendances simulées : c'est le montant
// transmis au rendu qui est vérifié, pas le PNG.
const db = vi.hoisted(() => ({
  analyse: null as Record<string, unknown> | null,
  fil: [] as Array<Record<string, unknown>>,
  rendered: null as unknown,
}));

vi.mock("@/lib/auth/request-user", async () => (await import("./helpers/request-session")).requestSessionMock(() => ({ id: "u1", email: "creatrice@example.fr" })));
vi.mock("@/lib/supabase/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/server")>()),
  selectRows: async (table: string) => (table === "analyses" ? (db.analyse ? [db.analyse] : []) : db.fil),
}));
// Le PNG est vérifié ailleurs : ici c'est le CONTENU de la carte qui compte.
vi.mock("next/og", () => ({
  ImageResponse: class {
    status = 200;
    headers = new Headers({ "Content-Type": "image/png" });
    constructor(element: unknown) {
      db.rendered = element;
    }
  },
}));

describe("point 4 (suite) — la carte n'est pas figée à l'analyse d'origine", () => {
  it("10. la route rend les termes du dernier tour, et le montant annoncé à ce tour", async () => {
    const original = offer();
    const payload2 = turn2(original);
    const payload3 = turn3(original, [payload2]);

    db.analyse = projectionAnalyse(lockAnalysis(original), { rate_table_version: original.estimate.rate_table_version });
    db.fil = [
      projectionFil({ kind: "reply", turn_number: 2, created_at: "2026-09-23T09:00:00.000Z", payload: payload2 }),
      projectionFil({ kind: "reply", turn_number: 3, created_at: "2026-09-23T10:00:00.000Z", payload: payload3 }),
    ];
    db.rendered = null;

    const { GET } = await import("@/app/api/carte/[id]/route");
    const id = "33333333-3333-4333-8333-333333333333";
    const response = await GET(new Request(`https://negoscore.fr/api/carte/${id}`, { headers: { cookie: "deal_anon_token=x" } }), {
      params: Promise.resolve({ id }),
    });
    expect(response.status).toBe(200);

    // Les chiffres du TOUR 3, pas ceux de l'offre d'origine — et la route ne
    // les a pas recalculés : elle les a lus dans le chiffrage enregistré.
    const chiffrage3 = payload3.pricing_after ?? payload3.pricing_before;
    const attendu = verdictCardTexts(carteDepuisChiffrage(chiffrage3, ligneOffreDuDeal(payload3.deal_after)));
    const texte = JSON.stringify(db.rendered);
    expect(attendu.vaut).not.toBe(null);
    expect(texte).toContain(attendu.vaut);
    // Le montant annoncé à ce tour, et dit pour ce qu'il est.
    expect(texte).toContain("On m'a proposé jusqu'à");
    expect(texte).toContain("à confirmer");
    // Et jamais le nom de la marque, alors que le fil en est plein.
    expect(original.deal.brand).not.toBe(null);
    expect(texte).not.toContain(original.deal.brand);
  });
});
