import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadScenarios, readingOf, scenarioContext } from "@/lib/negotiation/scenarios/index";

// Mission #210 — LA CHAÎNE D'UN TOUR DE NÉGOCIATION.
//
// Ce fichier existe parce que la batterie de mutation a montré qu'il manquait :
// retirer le contrôle de langue de lib/llm/turn.ts ne cassait aucun test.
// tests/langue-sortie.test.ts éprouve le module, tests/negotiation-route.test.ts
// remplace readBrandReply par un faux — personne ne traversait parseReading.
//
// Les doutes, ce qu'il reste à préciser et la note de pertinence sont de la
// prose française qui va au même écran que les risques d'une analyse. Ils
// méritent le même enchaînement : reprise, puis réparation, jamais d'échec.

const HEBREU = "בלבד";

const appels = vi.hoisted(() => ({ sorties: [] as string[], recues: 0 }));

vi.mock("openai", () => {
  class OpenAI {
    responses = {
      create: async () => {
        const sortie = appels.sorties[appels.recues] ?? appels.sorties.at(-1) ?? "{}";
        appels.recues += 1;
        return {
          output_text: sortie,
          usage: {
            input_tokens: 800,
            input_tokens_details: { cached_tokens: 0 },
            output_tokens: 400,
            output_tokens_details: { reasoning_tokens: 0 },
          },
        };
      },
    };
  }
  return { default: OpenAI };
});

const { readBrandReply } = await import("@/lib/llm/turn");

// Une lecture valide, tirée d'un scénario réel du dépôt.
const scenario = loadScenarios().find((s) => s.id === "03-termes-a-la-hausse")!;
const context = scenarioContext(scenario);
const LECTURE = readingOf(scenario, context.original);

const ENTREE = {
  deal: context.original.deal,
  asks: [],
  points: [],
  lastMessage: "Bonjour, merci pour votre proposition.",
  brandReply: scenario.reponse_marque,
};

function sortie(doutes: string[]): string {
  return JSON.stringify({ ...LECTURE, uncertainties: doutes });
}

let journal: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  appels.sorties = [];
  appels.recues = 0;
  vi.stubEnv("OPENAI_API_KEY", "cle-de-test");
  journal = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

const dit = () => journal.mock.calls.flat().join(" ");

describe("un doute qui fuit dans un tour", () => {
  it("LA RÉPONSE DE LA MARQUE NE CONTIENT AUCUN SCRIPT NON LATIN", () => {
    // Sans ça, la fuite serait tolérée et le test ne prouverait rien.
    expect(/\p{Script=Hebrew}/u.test(scenario.reponse_marque)).toBe(false);
  });

  it("PREMIER ESSAI FAUTIF : on redemande au modèle", async () => {
    appels.sorties = [
      sortie([`La marque ne dit pas ${HEBREU} si les droits pub sont inclus.`]),
      sortie(["La marque ne dit pas si les droits pub sont inclus."]),
    ];
    const { reading } = await readBrandReply(ENTREE);
    expect(appels.recues).toBe(2);
    expect(reading.uncertainties).toEqual(["La marque ne dit pas si les droits pub sont inclus."]);
    expect(dit()).toContain("langue_fuite_reprise_tour");
    expect(dit()).not.toContain("langue_fuite_reparee_tour");
  });

  it("DEUX ESSAIS FAUTIFS : le doute est retiré, le tour arrive quand même", async () => {
    const fautif = sortie([`La marque ne dit pas ${HEBREU} si les droits pub sont inclus.`, "Le délai reste flou."]);
    appels.sorties = [fautif, fautif];
    const { reading } = await readBrandReply(ENTREE);
    expect(appels.recues).toBe(2);
    expect(reading.uncertainties).toEqual(["Le délai reste flou."]);
    expect(dit()).toContain("langue_fuite_reparee_tour");
  });

  it("LE RESTE DE LA LECTURE EST INTACT : issue, citations, termes, message", async () => {
    const fautif = sortie([`${HEBREU} doute`]);
    appels.sorties = [fautif, fautif];
    const { reading } = await readBrandReply(ENTREE);
    expect(reading.outcome).toBe(LECTURE.outcome);
    expect(reading.relevance).toBe(LECTURE.relevance);
    expect(reading.changes).toEqual(LECTURE.changes);
    expect(reading.asks).toEqual(LECTURE.asks);
    expect(reading.deal).toEqual(LECTURE.deal);
    expect(reading.next_message).toEqual(LECTURE.next_message);
  });

  it("une lecture propre : UN SEUL appel, aucun journal", async () => {
    appels.sorties = [sortie(["La marque ne précise pas la durée."])];
    const { reading } = await readBrandReply(ENTREE);
    expect(appels.recues).toBe(1);
    expect(reading.uncertainties).toHaveLength(1);
    expect(dit()).not.toContain("langue_fuite");
  });

  it("UNE RÉPONSE DE MARQUE EN HÉBREU autorise l'hébreu dans les doutes", async () => {
    // La réponse collée est la référence : ce qu'elle contient a le droit de
    // ressortir. Sinon on refuserait la marque elle-même.
    appels.sorties = [sortie([`La marque écrit ${HEBREU} sans préciser.`])];
    const { reading } = await readBrandReply({
      ...ENTREE,
      brandReply: "שלום, אנחנו מסכימים על 450 אירו בלבד.",
    });
    expect(appels.recues).toBe(1);
    expect(reading.uncertainties[0]).toContain(HEBREU);
    expect(dit()).not.toContain("langue_fuite");
  });

  it("LE MESSAGE SUIVANT N'EST PAS CONTRÔLÉ : il suit la langue de la marque", async () => {
    appels.sorties = [
      JSON.stringify({
        ...LECTURE,
        uncertainties: [],
        next_message: { ...LECTURE.next_message, text: "שלום,\n\nתודה על התשובה.\n\nיום טוב," },
      }),
    ];
    const { reading } = await readBrandReply(ENTREE);
    expect(appels.recues).toBe(1);
    expect(reading.next_message.text).toContain("שלום");
    expect(dit()).not.toContain("langue_fuite");
  });
});
