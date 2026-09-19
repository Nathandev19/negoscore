import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadScenarios, runScenario, scenarioContext, readingOf } from "@/lib/negotiation/scenarios";
import { processTurn } from "@/lib/negotiation/turn";
import type { TurnPayload } from "@/lib/negotiation/types";

// Mission #080 — ce que la zone affiche, l'enchaînement de plusieurs tours
// (B2, B4) et la conclusion (C). Mission #080 ter : un tour ne coûte rien, le
// quota Pro ne compte que les analyses.

const db = vi.hoisted(() => ({
  tables: [] as string[],
  credits: null as null | { plan: string; balance: number; period_end: string | null },
  analysesInPeriod: 0,
  turnsInPeriod: 0,
  freeUsed: 1,
}));

vi.mock("@/lib/supabase/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/server")>()),
  selectRows: async (table: string) => {
    db.tables.push(table);
    if (table === "credits") return db.credits ? [db.credits] : [];
    if (table === "analyses") return Array.from({ length: db.analysesInPeriod }, (_, i) => ({ id: `a${i}` }));
    if (table === "negotiation_turns") return Array.from({ length: db.turnsInPeriod }, (_, i) => ({ id: `t${i}` }));
    if (table === "deals") return Array.from({ length: db.freeUsed }, (_, i) => ({ id: `d${i}` }));
    return [];
  },
  countRows: async () => 0,
}));
vi.mock("@/lib/billing/free-usage", () => ({ freeUsed: async () => db.freeUsed, consumeFree: async () => true }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
}));

const { reserveAnalysis } = await import("@/lib/billing/entitlement");
const { NegotiationThread } = await import("@/components/result/negotiation/negotiation-thread");

const USER = { id: "u1", email: "nina@exemple.test" };
const inAMonth = () => new Date(Date.now() + 20 * 24 * 3600 * 1000).toISOString();

beforeEach(() => {
  db.credits = null;
  db.analysesInPeriod = 0;
  db.turnsInPeriod = 0;
  db.freeUsed = 1;
  db.tables = [];
});

describe("#080 ter, C2 — le quota Pro compte les analyses, pas les tours", () => {
  it("29 analyses et 10 tours sur la période : l'analyse suivante reste possible", async () => {
    db.credits = { plan: "pro", balance: 0, period_end: inAMonth() };
    db.analysesInPeriod = 29;
    db.turnsInPeriod = 10;
    expect(await reserveAnalysis({ user: USER, anonToken: null, ip: "203.0.113.7" })).toMatchObject({ allowed: true, plan: "pro" });
    // La table des tours n'est même pas lue pour décider d'un droit.
    expect(db.tables).not.toContain("negotiation_turns");
  });

  it("30 analyses : le quota est atteint, par les analyses seules", async () => {
    db.credits = { plan: "pro", balance: 0, period_end: inAMonth() };
    db.analysesInPeriod = 30;
    db.turnsInPeriod = 0;
    expect(await reserveAnalysis({ user: USER, anonToken: null, ip: "203.0.113.7" })).toMatchObject({ allowed: false, reason: "no_credit" });
  });
});

const scenarios = loadScenarios();
const vague = scenarios.find((s) => s.id.endsWith("reponse-vague"))!;

function turnFrom(suffix: string): TurnPayload {
  const result = runScenario(scenarios.find((s) => s.id.endsWith(suffix))!).result;
  if (result.kind !== "turn") throw new Error("pas un tour");
  return result.payload;
}
const view = (payload: TurnPayload, turnNumber = 2) => ({ turnNumber, createdAt: "2026-09-19T10:00:00.000Z", brandReply: "…", payload });

function render(props: Partial<Parameters<typeof NegotiationThread>[0]>) {
  return renderToStaticMarkup(
    <NegotiationThread analysisId="11111111-1111-4111-8111-111111111111" turns={[]} conclusion={null} access="open" {...props} />,
  );
}

describe("la zone « La marque t'a répondu ? »", () => {
  it("B1, C3, C4 — connecté, quelle que soit la formule : zone de texte, bouton, « compris dans l'analyse », aucun coût annoncé", () => {
    const html = render({});
    expect(html).toContain("La marque t&#x27;a répondu ?");
    expect(html).toContain("<textarea");
    expect(html).toContain("ce n&#x27;est pas une nouvelle analyse");
    expect(html).toContain("C&#x27;est compris dans l&#x27;analyse de cette offre, jusqu&#x27;à la conclusion.");
    expect(html).not.toMatch(/crédit|décompt|Pack Deal|abonnement|il t&#x27;en reste|formule/i);
  });

  it("non connecté : la zone est visible et propose de se connecter, sans formulaire ni formule à acheter", () => {
    const html = render({ access: "signed_out" });
    expect(html).toContain("La marque t&#x27;a répondu ?");
    expect(html).toContain("/connexion?next=");
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain('href="/tarifs"');
    expect(html).not.toContain("J&#x27;accepte ces termes");
  });

  it("B4 — avant le dernier tour, c'est dit ; après, plus de zone de texte", () => {
    const three = [2, 3, 4].map((n) => view(turnFrom("reponse-vague"), n));
    expect(render({ turns: three })).toContain("C&#x27;est le dernier tour de suivi possible pour cette analyse.");
    const four = [2, 3, 4, 5].map((n) => view(turnFrom("reponse-vague"), n));
    const html = render({ turns: four });
    expect(html).toContain("Les 4 tours de suivi de cette analyse sont utilisés");
    expect(html).not.toContain('placeholder="Colle ici la réponse de la marque…"');
    // Les tours s'affichent dans l'ordre.
    expect(html.indexOf("Tour 2")).toBeLessThan(html.indexOf("Tour 3"));
    expect(html.indexOf("Tour 4")).toBeLessThan(html.indexOf("Tour 5"));
  });

  it("C — échange conclu : la conclusion s'affiche, plus de formulaire ni de bouton d'acceptation", () => {
    const html = render({ turns: [view(turnFrom("acceptation-franche"))] });
    expect(html).toContain("Conclusion de l&#x27;échange");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("J&#x27;accepte ces termes");
  });

  it("C5 — le bouton d'acceptation est la décision de la personne ; rien ne pousse à accepter ou refuser", () => {
    const html = render({ turns: [view(turnFrom("refus-net"))] });
    expect(html).toContain("J&#x27;accepte ces termes");
    expect(html).toContain("c&#x27;est ton choix");
    expect(html).not.toMatch(/nous te conseillons|tu devrais|il vaut mieux|accepte vite|refuse cette offre/i);
  });
});

describe("B2, B4 — plusieurs tours à la suite", () => {
  it("un tour sans changement après un tour qui a changé les termes : la fourchette ne bouge plus, c'est celle du tour précédent", () => {
    const tour2 = turnFrom("termes-a-la-hausse");
    const context = { ...scenarioContext(vague), previous: [tour2], turnNumber: 3 };
    const tour3 = processTurn(context, readingOf(vague, context.original as never));
    if (tour3.kind !== "turn") throw new Error("pas un tour");
    expect(tour3.payload.pricing_after).toBeNull();
    expect(tour3.payload.pricing_before).toEqual(tour2.pricing_after);
    expect(tour3.payload.deal_before).toEqual(tour2.deal_after);
    expect(tour3.payload.changed_since_origin).toBe(true);
    const html = render({ turns: [view(tour2, 2), view(tour3.payload, 3)] });
    expect(html).toContain("celle du tour précédent");
  });

  it("une demande accordée au tour 2 le reste au tour 3 si la marque n'en reparle pas", () => {
    const tour2 = turnFrom("acceptation-partielle");
    const context = { ...scenarioContext(vague), previous: [tour2], turnNumber: 3 };
    const tour3 = processTurn(context, readingOf(vague, context.original as never));
    if (tour3.kind !== "turn") throw new Error("pas un tour");
    expect(tour3.payload.asks.find((a) => a.id === "c2")).toMatchObject({ status: "granted", turn: 2 });
  });
});

describe("C — la conclusion", () => {
  it("C1 à C4 : sept rubriques, points flous, confirmation écrite demandée, rappel légal", () => {
    const conclusion = turnFrom("acceptation-franche").conclusion!;
    expect(conclusion.recap.slice(0, 7).map((r) => r.label)).toEqual([
      "Livrables",
      "Rémunération",
      "Droits d'utilisation",
      "Territoire",
      "Exclusivité",
      "Paiement",
      "Publication sur tes comptes",
    ]);
    expect(conclusion.unclear).toContain("Le territoire où les contenus seront diffusés.");
    expect(conclusion.message).toMatch(/confirmer ces points par écrit/);
    expect(conclusion.legal_note).toContain("contrat écrit est obligatoire");
    expect(conclusion.legal_note).toContain("pas un conseil juridique");
  });

  it("contre-offre acceptée sans montant écrit : jamais l'ancien montant de la marque dans le récapitulatif", () => {
    const conclusion = turnFrom("acceptation-franche").conclusion!;
    const amount = conclusion.recap.find((r) => r.label === "Rémunération")!.value;
    expect(amount).toContain("la marque l'a acceptée sans écrire le montant exact");
    expect(amount).not.toContain("300");
    expect(conclusion.message).not.toContain("300");
    expect(conclusion.message).toContain("le montant exact retenu dans cette fourchette");
  });
});

describe("C4 — le seuil du contrat écrit quand la marque accepte une fourchette", () => {
  it("toute la fourchette acceptée dépasse 1 000 € HT : la note dit que le seuil est atteint", () => {
    const conclusion = turnFrom("acceptation-franche").conclusion!;
    expect(conclusion.legal_note).toContain("atteint ce seuil : demande un contrat écrit");
    expect(conclusion.legal_note).not.toContain("Le montant n'est pas connu");
  });
});

const { SentMessageContext } = await import("@/components/result/negotiation/sent-message");

describe("B3 — au moment de coller, le message que l'outil croit envoyé, repliable et corrigeable", () => {
  const withFirst = (node: React.ReactNode) => (
    <SentMessageContext value={{ analysisId: "11111111-1111-4111-8111-111111111111", firstMessage: "Bonjour,\n\nMerci pour votre message, le projet m'intéresse beaucoup." }}>{node}</SentMessageContext>
  );
  const renderWith = (props: Partial<Parameters<typeof NegotiationThread>[0]>) =>
    renderToStaticMarkup(
      withFirst(<NegotiationThread analysisId="11111111-1111-4111-8111-111111111111" turns={[]} conclusion={null} access="open" {...props} />),
    );

  it("jamais copié : le message proposé, présenté comme une hypothèse, dans un bloc replié", () => {
    const html = renderWith({});
    expect(html).toMatch(/<details[^>]*>\s*<summary/);
    expect(html).not.toMatch(/<details[^>]*open/);
    expect(html).toContain("Merci pour votre message, le projet m&#x27;intéresse beaucoup.");
    expect(html).toContain("Tu ne l&#x27;as pas copié depuis l&#x27;outil : c&#x27;est le message proposé, supposé envoyé.");
    expect(html).not.toMatch(/décompt|crédit/);
  });

  it("copié : le texte retenu à la copie, avec sa date", () => {
    const html = renderWith({ sent: { text: "Mon message modifié avant envoi.", source: "copied", updatedAt: "2026-09-19T08:30:00.000Z" } });
    expect(html).toContain("Mon message modifié avant envoi.");
    expect(html).toContain("Retenu quand tu l&#x27;as copié, le 19 septembre à 10:30.");
  });

  it("au tour suivant, l'hypothèse est le message proposé par le dernier tour", () => {
    const html = renderWith({ turns: [view(turnFrom("reponse-vague"))] });
    expect(html).toContain("Je reste disponible si vous avez des questions sur ma proposition");
  });
});

const { excerpt } = await import("@/components/result/negotiation/negotiation-thread");

describe("B3 — l'extrait du message", () => {
  it("saute la ligne de salutation, coupe proprement un message long", () => {
    expect(excerpt("Bonjour,\n\nMerci pour votre retour, avec plaisir.")).toBe("Merci pour votre retour, avec plaisir.");
    expect(excerpt(`Merci ${"beaucoup ".repeat(20)}`, 30)).toMatch(/^Merci beaucoup beaucoup[^…]*…$/);
  });
});
