import { describe, expect, it } from "vitest";
import { mergeAsks } from "@/lib/negotiation/asks";
import { insertPrice, messageProblems, withGreeting } from "@/lib/negotiation/message";
import { loadScenarios, runScenario, scenarioContext } from "@/lib/negotiation/scenarios";
import { cleanDoubts } from "@/lib/negotiation/turn";
import type { Ask, Deal } from "@/lib/negotiation/types";
import { checkQuote } from "@/lib/negotiation/quotes";
import { keepWritten, numberCheck, numberWritten, textWritten, unwrittenDoubt } from "@/lib/negotiation/written";

// Mission #080 quater — les corrections tirées de l'essai contre le vrai
// modèle, chacune vérifiée par le code, pas seulement demandée au modèle.

const counter = { low: 1070, high: 2500 };
const base = scenarioContext(loadScenarios()[0]).original.deal as Deal;

describe("A1 — la contre-offre insérée s'accorde avec le mot qui la précède", () => {
  it.each([
    ["Je vous propose une rémunération de {{CONTRE_OFFRE}}.", "Je vous propose une rémunération de 1 070 € à 2 500 €."],
    ["Mon tarif se situe à {{CONTRE_OFFRE}}.", "Mon tarif se situe entre 1 070 € et 2 500 €."],
    ["Mon tarif se situe {{CONTRE_OFFRE}}.", "Mon tarif se situe entre 1 070 € et 2 500 €."],
    ["Je peux le faire pour {{CONTRE_OFFRE}}.", "Je peux le faire pour un montant compris entre 1 070 € et 2 500 €."],
    ["Ma contre-offre est {{CONTRE_OFFRE}}.", "Ma contre-offre est entre 1 070 € et 2 500 €."],
  ])("%s", (draft, expected) => {
    expect(insertPrice(draft, "fr", counter).text.replace(/[  ]/g, " ")).toBe(expected);
  });

  it("sans contre-offre chiffrée : la phrase neutre, correctement accordée", () => {
    expect(insertPrice("une rémunération de {{CONTRE_OFFRE}}", "fr", { low: null, high: null }).text).toBe(
      "une rémunération d'un tarif que je vous détaille dans mon devis",
    );
  });

  it("plus jamais « de entre » ni « à entre »", () => {
    for (const word of ["de", "à", "pour", "est", "situe"]) {
      expect(insertPrice(`${word} {{CONTRE_OFFRE}}`, "fr", counter).text).not.toMatch(/\b(de|à) entre\b/);
    }
  });
});

describe("A4 — aucune formule qui suppose le genre de la personne", () => {
  it.each(["Je suis ravie de travailler avec vous.", "Je reste ouverte à une future collaboration.", "Je suis très content de votre retour.", "Je reste ouvert à la discussion."])(
    "%s → écarté",
    (draft) => expect(messageProblems(draft, base, "")).toContain("gender"),
  );
  it.each(["Je reste disponible pour en discuter.", "Au plaisir d'échanger avec vous.", "Merci beaucoup pour votre retour."])("%s → permis", (draft) => {
    expect(messageProblems(draft, base, "")).not.toContain("gender");
  });
});

describe("A5 — salutation sur sa propre ligne", () => {
  it("ajoutée quand elle manque", () => {
    expect(withGreeting("Merci pour votre retour.", "fr")).toBe("Bonjour,\n\nMerci pour votre retour.");
  });
  it("détachée quand elle est collée à la phrase, avec la majuscule", () => {
    expect(withGreeting("Bonjour, merci pour votre retour.", "fr")).toBe("Bonjour,\n\nMerci pour votre retour.");
  });
  it("laissée telle quelle quand elle est déjà seule", () => {
    expect(withGreeting("Bonjour Julie,\n\nMerci.", "fr")).toBe("Bonjour Julie,\n\nMerci.");
  });
});

describe("A6 — aucun jargon interne à l'écran", () => {
  it("un doute qui parle de la mécanique du modèle est remplacé par une phrase utile", () => {
    const doubts = cleanDoubts([
      "Le champ deal ne permet pas de représenter une rémunération sous forme de fourchette ni une option payante.",
      "La marque ne précise pas si le budget inclut les droits publicitaires.",
    ]);
    expect(doubts.join(" ")).not.toMatch(/champ|deal ne permet/);
    expect(doubts).toContain("La marque ne précise pas si le budget inclut les droits publicitaires.");
    expect(doubts).toContain("Un point de la réponse n'a pas pu être lu avec certitude : relis-la avant d'envoyer ton message.");
  });
});

describe("A7 — une citation est la preuve d'UN point ; un accord global est dit comme tel", () => {
  const asks: Ask[] = ["prix", "c1", "c2"].map((id) => ({ id, label: id, status: "unanswered", quote: null, turn: null, global: false, aligned_group: null, aligned_turn: null, remaining: null }));
  const reply = "Bonjour ! C'est d'accord pour tout, on part sur votre proposition.";

  it("accord global déclaré : les demandes sans citation propre sont accordées au titre de l'accord global", () => {
    const merged = mergeAsks(asks, { global_agreement: "C'est d'accord pour tout", asks: asks.map((a) => ({ id: a.id, status: "granted", quote: null })) }, reply, 2);
    expect(merged.globalAgreement).toBe("C'est d'accord pour tout");
    expect(merged.asks.every((a) => a.status === "granted" && a.global)).toBe(true);
  });

  it("même phrase collée comme preuve de plusieurs demandes : traitée comme un accord global, pas comme des preuves point par point", () => {
    const quote = "C'est d'accord pour tout, on part sur votre proposition.";
    const merged = mergeAsks(asks, { global_agreement: null, asks: asks.map((a) => ({ id: a.id, status: "granted", quote })) }, reply, 2);
    expect(merged.globalAgreement).toBe(quote);
    expect(merged.asks.every((a) => a.global)).toBe(true);
  });

  it("un refus en bloc cité sur chaque demande reste un refus de chacune", () => {
    const quote = "ce n'est pas possible";
    const merged = mergeAsks(asks, { global_agreement: null, asks: asks.map((a) => ({ id: a.id, status: "refused", quote })) }, `Merci mais ${quote}.`, 2);
    expect(merged.globalAgreement).toBeNull();
    expect(merged.asks.every((a) => a.status === "refused" && !a.global)).toBe(true);
  });
});

describe("A2, A3 — on n'enregistre que ce qui est écrit", () => {
  it("« notre compte » (la marque) ne devient jamais une publication sur les comptes de la créatrice", () => {
    const candidate = { ...base, publication_required: true };
    const brand = keepWritten(base, candidate, ["publication"], { brandReply: "seulement publiées sur notre compte", accepted: [] }, { publication: "les vidéos seront seulement publiées sur notre compte" });
    expect(brand.deal.publication_required).toBe(false);
    expect(brand.unwritten[0]).toMatchObject({ reason: "brand_account" });
    const creator = keepWritten(base, candidate, ["publication"], { brandReply: "publiées sur votre compte TikTok", accepted: [] }, { publication: "publiées sur votre compte TikTok" });
    expect(creator.deal.publication_required).toBe(true);
  });

  it("un échéancier non écrit tel quel revient à ce qu'il était ; le délai, écrit, reste", () => {
    const candidate = { ...base, payment: { ...base.payment, terms_days: 30, schedule: "50 % à la signature, solde à 30 jours" } };
    const kept = keepWritten(base, candidate, ["payment_terms"], { brandReply: "le paiement à 30 jours avec 50 % à la signature", accepted: [] }, {});
    expect(kept.deal.payment.terms_days).toBe(30);
    expect(kept.deal.payment.schedule).toBe(base.payment.schedule);
    expect(kept.unwritten).toEqual([{ group: "payment_terms", value: "50 % à la signature, solde à 30 jours", reason: "not_written" }]);
  });

  it("B1 — un montant écrit ne s'efface pas parce que le modèle ne sait pas écrire une fourchette", () => {
    const candidate = { ...base, payment: { ...base.payment, amount_eur: null } };
    expect(keepWritten(base, candidate, ["amount"], { brandReply: "C'est d'accord pour tout", accepted: [] }, {}).deal.payment.amount_eur).toBe(base.payment.amount_eur);
  });

  it("nombres : chiffres, lettres, années, et pas de faux positif", () => {
    expect(numberWritten(1, ["l'exclusivité d'un mois"], "months")).toBe(true);
    expect(numberWritten(12, ["pendant un an"], "months")).toBe(true);
    expect(numberWritten(3, ["l'exclusivité d'un mois"], "months")).toBe(false);
    expect(numberWritten(1500, ["payer 1 500 €"])).toBe(true);
    expect(numberWritten(45, ["le budget à 450 €"])).toBe(false);
    expect(textWritten("Europe", ["diffusion en Europe uniquement"])).toBe(true);
  });
});

describe("B1 — contre-offre acceptée, montant effacé par le modèle : la conclusion rappelle la contre-offre", () => {
  it("scénario 01 : jamais « aucun montant », toujours la contre-offre acceptée", () => {
    const scenario = loadScenarios().find((s) => s.id.endsWith("acceptation-franche"))!;
    const erased = { ...scenario, sortie_modele: { ...scenario.sortie_modele, deal: { ...scenario.sortie_modele.deal, payment: { amount_eur: null } } } };
    const { result } = runScenario(erased);
    if (result.kind !== "turn") throw new Error("pas un tour");
    const amount = result.payload.conclusion?.recap.find((row) => row.label === "Rémunération")?.value ?? "";
    expect(amount).toContain("Ta contre-offre");
    expect(amount).toContain("sans écrire le montant exact");
  });
});

describe("#080 quinquies, B — les doutes s'adressent à elle, en « tu »", () => {
  it("le vouvoiement converti là où c'est sûr, avec le bon possessif", () => {
    expect(cleanDoubts(["La marque indique qu'elle examine votre proposition en interne."])).toEqual([
      "La marque indique qu'elle examine ta proposition en interne.",
    ]);
    expect(cleanDoubts(["La marque ne dit rien de votre exclusivité ni de votre tarif."])).toEqual([
      "La marque ne dit rien de ton exclusivité ni de ton tarif.",
    ]);
  });
  it("les mots de la marque, cités entre « », ne sont jamais touchés", () => {
    expect(cleanDoubts(["La marque écrit « on revient vers vous » sans date."])).toEqual(["La marque écrit « on revient vers vous » sans date."]);
  });
  it("un « vous » impossible à convertir sûrement : phrase générique, jamais un vouvoiement à l'écran", () => {
    const doubts = cleanDoubts(["La marque vous remercie pour votre patience."]);
    expect(doubts.join(" ").replace(/«[^»]*»/g, "")).not.toMatch(/\b(vous|votre|vos)\b/i);
  });
});

describe("#080 quinquies, A — une citation recollée n'est jamais une preuve", () => {
  it("deux morceaux recollés : la demande reste sans réponse explicite, et rien n'est prêté à la marque", () => {
    const asks: Ask[] = [{ id: "c5", label: "Paiement à 30 jours, 50 % à la signature", status: "unanswered", quote: null, turn: null, global: false, aligned_group: null, aligned_turn: null, remaining: null }];
    const reply = "Bonjour, ok pour l'exclusivité d'un mois et pour le paiement à 30 jours avec 50 % à la signature.";
    const merged = mergeAsks(asks, { global_agreement: null, asks: [{ id: "c5", status: "granted", quote: "ok pour le paiement à 30 jours avec 50 % à la signature" }] }, reply, 2);
    expect(merged.asks[0].status).toBe("unanswered");
    expect(merged.unverified).toEqual([{ label: "Paiement à 30 jours, 50 % à la signature", clause: null }]);
  });
});

describe("#081, A — une citation n'est jamais coupée de ce qui la nie ou la conditionne", () => {
  const source = "Par contre on ne peut pas s'engager sur un délai de paiement inférieur à 45 jours.";
  it("le cas réel de production : coupée juste après la négation, elle est refusée, et la phrase entière est rendue", () => {
    expect(checkQuote("délai de paiement inférieur à 45 jours", source)).toEqual({
      ok: false,
      reason: "cut",
      clause: "Par contre on ne peut pas s'engager sur un délai de paiement inférieur à 45 jours",
    });
  });
  it("la phrase entière, négation comprise, est recevable", () => {
    expect(checkQuote("on ne peut pas s'engager sur un délai de paiement inférieur à 45 jours", source)).toEqual({ ok: true });
  });
  it.each([
    ["accepter 30 jours", "Nous ne pouvons pas accepter 30 jours."],
    ["ok pour 30 jours", "Si le budget passe, ok pour 30 jours."],
    ["le paiement à 30 jours", "Sauf exception, le paiement à 30 jours."],
    ["à 3 mois", "L'exclusivité sera au maximum à 3 mois."],
  ])("« %s » dans « %s » : refusée", (quote, text) => {
    expect(checkQuote(quote, text)).toMatchObject({ ok: false, reason: "cut" });
  });
  it("les citations des scénarios sans négation restent recevables", () => {
    expect(checkQuote("ok pour l'exclusivité d'un mois", "Bonjour, ok pour l'exclusivité d'un mois et pour le paiement à 30 jours.")).toEqual({ ok: true });
    expect(checkQuote("sans pub", "les vidéos seront seulement publiées sur notre compte, sans pub.")).toEqual({ ok: true });
  });
});

describe("#081, B — une borne n'est pas une valeur", () => {
  const texts = (brandReply: string, accepted: string[] = []) => ({ brandReply, accepted });
  it("« inférieur à 45 jours » dans une phrase niée : pas une valeur, la phrase est rendue", () => {
    expect(numberCheck(45, texts("Par contre on ne peut pas s'engager sur un délai de paiement inférieur à 45 jours."))).toMatchObject({
      ok: false,
      clause: expect.stringContaining("inférieur à 45 jours"),
    });
  });
  it.each(["Pas moins de 45 jours.", "Au minimum 45 jours de délai.", "Jusqu'à 45 jours, pas plus."])("« %s » : borne", (text) => {
    expect(numberCheck(45, texts(text)).ok).toBe(false);
  });
  it("une valeur posée sans réserve est retenue", () => {
    expect(numberCheck(45, texts("Nous paierons à 45 jours.")).ok).toBe(true);
  });
  it("une valeur écrite dans une demande acceptée est retenue, même si la réponse la borne ailleurs", () => {
    expect(numberCheck(30, texts("Au moins 30 jours ailleurs.", ["Paiement à 30 jours, 50 % à la signature"])).ok).toBe(true);
  });
  it("le terme de paiement ne bouge pas, et le doute le dit", () => {
    const candidate = { ...base, payment: { ...base.payment, terms_days: 45 } };
    const kept = keepWritten(base, candidate, ["payment_terms"], texts("Par contre on ne peut pas s'engager sur un délai de paiement inférieur à 45 jours."), {});
    expect(kept.deal.payment.terms_days).toBe(base.payment.terms_days);
    expect(kept.unwritten[0]).toMatchObject({ reason: "bound" });
    expect(unwrittenDoubt(kept.unwritten[0])).toContain("C'est une limite ou une condition, pas une valeur convenue");
  });
});
