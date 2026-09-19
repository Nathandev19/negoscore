import { describe, expect, it } from "vitest";
import { mergeAsks } from "@/lib/negotiation/asks";
import { insertPrice, messageProblems, withGreeting } from "@/lib/negotiation/message";
import { loadScenarios, runScenario, scenarioContext } from "@/lib/negotiation/scenarios";
import { cleanDoubts } from "@/lib/negotiation/turn";
import type { Ask, Deal } from "@/lib/negotiation/types";
import { keepWritten, numberWritten, textWritten } from "@/lib/negotiation/written";

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
  const asks: Ask[] = ["prix", "c1", "c2"].map((id) => ({ id, label: id, status: "unanswered", quote: null, turn: null, global: false }));
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
    const brand = keepWritten(base, candidate, ["publication"], ["seulement publiées sur notre compte"], { publication: "les vidéos seront seulement publiées sur notre compte" });
    expect(brand.deal.publication_required).toBe(false);
    expect(brand.unwritten[0]).toMatchObject({ reason: "brand_account" });
    const creator = keepWritten(base, candidate, ["publication"], ["publiées sur votre compte TikTok"], { publication: "publiées sur votre compte TikTok" });
    expect(creator.deal.publication_required).toBe(true);
  });

  it("un échéancier non écrit tel quel revient à ce qu'il était ; le délai, écrit, reste", () => {
    const candidate = { ...base, payment: { ...base.payment, terms_days: 30, schedule: "50 % à la signature, solde à 30 jours" } };
    const kept = keepWritten(base, candidate, ["payment_terms"], ["le paiement à 30 jours avec 50 % à la signature"], {});
    expect(kept.deal.payment.terms_days).toBe(30);
    expect(kept.deal.payment.schedule).toBe(base.payment.schedule);
    expect(kept.unwritten).toEqual([{ group: "payment_terms", value: "50 % à la signature, solde à 30 jours", reason: "not_written" }]);
  });

  it("B1 — un montant écrit ne s'efface pas parce que le modèle ne sait pas écrire une fourchette", () => {
    const candidate = { ...base, payment: { ...base.payment, amount_eur: null } };
    expect(keepWritten(base, candidate, ["amount"], ["C'est d'accord pour tout"], {}).deal.payment.amount_eur).toBe(base.payment.amount_eur);
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
