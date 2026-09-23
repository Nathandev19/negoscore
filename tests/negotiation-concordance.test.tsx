import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TurnCard } from "@/components/result/negotiation/turn-card";
import { newAsk, outcomeFromAsks } from "@/lib/negotiation/asks";
import { buildConclusion, foldGranted, unclearDoubt } from "@/lib/negotiation/conclusion";
import { claimsAgreementOn, FALLBACK_REASON } from "@/lib/negotiation/message";
import { loadScenarios, runScenario, type Scenario } from "@/lib/negotiation/scenarios";
import { cleanDoubts } from "@/lib/negotiation/turn";
import { UNVERIFIED_HINT, type Ask, type TurnPayload } from "@/lib/negotiation/types";

// Mission #083 — ce que l'écran dit et ce que le message dit concordent.

const scenario = (suffix: string): Scenario => {
  const found = loadScenarios().find((s) => s.id.endsWith(suffix));
  if (!found) throw new Error(suffix);
  return found;
};
const turnOf = (s: Scenario): TurnPayload => {
  const { result } = runScenario(s);
  if (result.kind !== "turn") throw new Error("pas un tour");
  return result.payload;
};
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/[\s  ]+/g, " ");

describe("A — une citation écartée : ni « sans réponse », ni accord affirmé, un seul doute", () => {
  const payload = turnOf(scenario("garde-accord-non-verifiable"));

  it("A1 — le paiement s'affiche « Non vérifiable », avec la phrase qui renvoie à la réponse de la marque", () => {
    const page = text(renderToStaticMarkup(<TurnCard turnNumber={2} createdAt="2026-09-19T10:00:00.000Z" brandReply={null} payload={payload} />));
    expect(page).toContain(`Non vérifiable Paiement à 30 jours, 50 % à la signature ${UNVERIFIED_HINT}`);
    const stillOpen = page.slice(page.indexOf("Toujours sans réponse"), page.indexOf("Ce que l'outil a compris des termes"));
    expect(stillOpen).toContain("2 révisions incluses");
    expect(stillOpen).not.toContain("Paiement");
  });

  it("A2 — le brouillon qui affirme l'accord sur le paiement est écarté, pour cette raison-là", () => {
    expect(payload.message.fallback).toBe(true);
    expect(payload.message.fallback_reasons).toEqual([FALLBACK_REASON.agreement]);
    // Le message de repli demande une confirmation, il n'affirme rien.
    expect(claimsAgreementOn(payload.message.text, ["Paiement à 30 jours, 50 % à la signature"])).toBe(false);
    expect(payload.message.text).toContain("- Paiement à 30 jours, 50 % à la signature");
  });

  it("A2 — le contrôle : affirmation sur ce sujet oui, question ou autre sujet non", () => {
    const labels = ["Paiement à 30 jours, 50 % à la signature"];
    expect(claimsAgreementOn("Je prends bonne note de l'accord concernant l'exclusivité et les conditions de paiement.", labels)).toBe(true);
    expect(claimsAgreementOn("Merci d'avoir accepté le paiement à 30 jours.", labels)).toBe(true);
    expect(claimsAgreementOn("Pouvez-vous me confirmer votre accord sur le paiement ?", labels)).toBe(false);
    expect(claimsAgreementOn("Je prends bonne note de l'accord concernant l'exclusivité.", labels)).toBe(false);
    expect(claimsAgreementOn("Je prends bonne note de l'accord concernant le paiement.", [])).toBe(false);
  });

  it("A3 — un seul doute pour le paiement, et aucun quand la marque a répondu dessus", () => {
    // Mission #098, défaut 1 — la marque écrit « ok pour le paiement à 30
    // jours avec 50 % à la signature » : la mémoire l'affiche « répondu »,
    // citation à l'appui. Un doute « aucun passage trouvé » sur le même point
    // serait une contradiction ; l'avertissement reste dans « Non vérifiable ».
    expect(payload.uncertainties.filter((doubt) => doubt.includes("Paiement"))).toHaveLength(0);
    expect(payload.points.find((point) => point.key === "payment")).toMatchObject({ status: "answered" });
  });

  it("A1 — la conclusion ne dit pas « pas de réponse » sur un point non vérifiable", () => {
    const conclusion = buildConclusion({ deal: payload.deal_after, asks: payload.asks, language: "fr", source: "creator_accepted" });
    expect(conclusion.unclear.join("\n")).not.toContain("Pas de réponse de la marque sur : Paiement");
    expect(conclusion.unclear.join("\n")).toContain("« Paiement à 30 jours, 50 % à la signature » : la réponse de la marque sur ce point n'a pas pu être vérifiée");
  });
});

describe("B — s'en tenir à son budget est un refus, pas une contre-proposition", () => {
  it("« il n'est pas négociable » : refusé", () => {
    const payload = turnOf(scenario("garde-refus-lu-contre-proposition"));
    expect(payload.asks.find((ask) => ask.id === "prix")?.status).toBe("refused");
    expect(payload.outcome).toBe("refused");
  });

  it("« on ne peut pas aller au-delà de ce qui était prévu » : refusé", () => {
    expect(turnOf(scenario("garde-accord-non-verifiable")).asks.find((ask) => ask.id === "prix")?.status).toBe("refused");
  });

  it("une négation, mais un nouveau montant écrit et retenu : c'est bien une contre-proposition", () => {
    const base = scenario("garde-refus-lu-contre-proposition");
    const reply = "On ne peut pas aller jusqu'à votre tarif. Par contre on peut monter le budget à 450 €.";
    const s: Scenario = {
      ...base,
      reponse_marque: reply,
      sortie_modele: {
        ...base.sortie_modele,
        outcome: "counter",
        asks: base.sortie_modele.asks.map((ask) =>
          ask.id === "prix" ? { ...ask, status: "countered", quote: "On ne peut pas aller jusqu'à votre tarif." } : ask,
        ),
        changes: [{ group: "amount", quote: "on peut monter le budget à 450 €" }],
        deal: { ...base.sortie_modele.deal, payment: { ...base.sortie_modele.deal?.payment, amount_eur: 450 } },
      },
    };
    const payload = turnOf(s);
    expect(payload.changes.map((change) => change.group)).toEqual(["amount"]);
    expect(payload.asks.find((ask) => ask.id === "prix")?.status).toBe("countered");
  });
});

describe("C — « Accordé » quand la marque fait mieux que la demande", () => {
  it("scénario 04 : l'exclusivité supprimée accorde la demande de la réduire", () => {
    expect(turnOf(scenario("termes-a-la-baisse")).asks.find((ask) => ask.id === "c2")?.status).toBe("granted");
  });
});

describe("D — le titre du tour vient des statuts affichés", () => {
  const ask = (id: string, status: Ask["status"], turn = 2): Ask => ({ ...newAsk(id, id), status, turn: status === "unanswered" ? null : turn });
  const title = (asks: Ask[], model: Parameters<typeof outcomeFromAsks>[2]["model"], changed = false, questions = 0) =>
    outcomeFromAsks(asks, 2, { model, changed, questions });

  it("une demande accordée en partie, le reste sans réponse : « accepte en partie », même si le modèle dit « contre »", () => {
    expect(title([ask("prix", "unanswered"), ask("c1", "partial")], "counter")).toBe("partial");
    expect(turnOf(scenario("garde-titre-du-tour")).outcome).toBe("partial");
  });
  it("majorité d'accords face aux contre-propositions : « accepte en partie »", () => {
    expect(title([ask("a", "granted"), ask("b", "granted"), ask("c", "countered")], "counter")).toBe("partial");
  });
  it("autant de contre-propositions que d'accords : « propose d'autres termes »", () => {
    expect(title([ask("a", "granted"), ask("b", "countered")], "partial")).toBe("counter");
  });
  it("accords et refus, sans contre-proposition : « accepte en partie »", () => {
    expect(title([ask("a", "granted"), ask("b", "refused"), ask("c", "refused")], "refused")).toBe("partial");
  });
  it("tout accordé, dans ce tour ou avant : « accepte »", () => {
    expect(title([ask("a", "granted"), ask("b", "unanswered")], "accepted")).toBe("partial");
    expect(outcomeFromAsks([ask("a", "granted", 2), ask("b", "granted", 3)], 3, { model: "partial", changed: false, questions: 0 })).toBe("accepted");
  });
  it("seulement des refus : « refuse »", () => {
    expect(title([ask("a", "refused"), ask("b", "unanswered")], "counter")).toBe("refused");
  });
  it("aucune réponse vérifiée : un terme changé est une proposition ; un accord que rien ne montre devient « ne tranche pas »", () => {
    expect(title([ask("a", "unanswered")], "vague", true)).toBe("counter");
    expect(title([ask("a", "unanswered")], "accepted")).toBe("vague");
    expect(title([ask("a", "unanswered")], "partial", false, 1)).toBe("question");
    expect(title([ask("a", "unanswered")], "refused")).toBe("refused");
  });
  it("sans demande suivie : le titre du modèle", () => {
    expect(title([], "accepted")).toBe("accepted");
  });
});

describe("E — la conclusion", () => {
  it("E1 — « l'état du deal » est du jargon : le doute est remplacé", () => {
    const [doubt] = cleanDoubts(["La marque accepte ta contre-offre tarifaire sans reprendre le montant exact ; le montant indiqué dans l'état du deal reste donc inchangé."]);
    expect(doubt).not.toContain("état du deal");
  });

  it("E2 — le préfixe ne précède qu'un vrai doute de lecture", () => {
    expect(unclearDoubt("Le prix des droits pub supplémentaires n'est pas précisé.")).toBe(
      "L'outil n'est pas sûr d'avoir bien lu : Le prix des droits pub supplémentaires n'est pas précisé.",
    );
    // Un conseil reste un conseil.
    expect(unclearDoubt("Le contrat devra préciser que le raw footage est une option payante.")).toBe(
      "Le contrat devra préciser que le raw footage est une option payante.",
    );
    // Un doute déjà rédigé par le code n'est pas préfixé une seconde fois.
    const written = "« Paiement » : l'outil a cru lire « 50 % à la signature et le solde à 30 jours », mais ce n'est pas écrit dans la réponse de la marque. Ce n'est pas retenu : fais-le-lui préciser.";
    expect(unclearDoubt(written)).toBe(written);
  });

  it("E3 — une demande qui a déjà sa ligne n'est pas répétée ; plus précise, elle remplace la ligne", () => {
    const rows = [
      { label: "Exclusivité", value: "Oui, 1 mois (cosmétique)" },
      { label: "Paiement", value: "À 30 jours" },
      { label: "Droits d'utilisation", value: "Publication par la marque sur ses comptes, publicité payante — durée : 6 mois" },
    ];
    const granted = ["Droits pub 6 mois facturés en plus de la création", "Exclusivité ramenée à 1 mois", "Raw footage en option payante", "Paiement à 30 jours, 50 % à la signature"];
    const folded = foldGranted(rows, granted, true);
    expect(folded.rows.find((row) => row.label === "Paiement")?.value).toBe("À 30 jours, 50 % à la signature");
    expect(folded.rows.find((row) => row.label === "Exclusivité")?.value).toBe("Oui, 1 mois (cosmétique)");
    // Ce que les lignes ne disent pas reste dans la liste : rien d'accordé ne se perd.
    expect(folded.rest).toEqual(["Droits pub 6 mois facturés en plus de la création", "Raw footage en option payante"]);
  });

  it("E3 — conclusion du scénario 01 : ni l'exclusivité ni le paiement répétés, dans le récapitulatif ni dans le message", () => {
    const payload = turnOf(scenario("acceptation-franche"));
    const recap = payload.conclusion?.recap ?? [];
    const granted = recap.find((row) => row.label === "Accordé par la marque")?.value ?? "";
    expect(granted).not.toContain("Exclusivité");
    expect(granted).not.toContain("Paiement");
    expect(granted).toContain("Raw footage en option payante");
    const message = payload.conclusion?.message ?? "";
    expect(message.match(/exclusivité/gi)).toHaveLength(1);
    expect(message.match(/30 jours/g)).toHaveLength(1);
  });
});
