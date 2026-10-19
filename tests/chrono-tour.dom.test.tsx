// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NegotiationThread, type ThreadTurnView } from "@/components/result/negotiation/negotiation-thread";
import { CHRONO_FLAG, CHRONO_GLOBAL, CHRONO_MARKS, chronoDebut, chronoMarque, chronoOublie, chronoSeries } from "@/lib/ui/chrono";
import { MIN_REPLY_LENGTH } from "@/lib/negotiation/libelles";
import { loadScenarios, runScenario } from "@/lib/negotiation/scenarios/index";

// Mission #203, chantier B — LES QUATRE REPÈRES DU CHEMIN CLIENT.
//
// Onze secondes n'étaient pas attribuées entre la médiane en base et ce qui
// se voit à l'écran. Ces repères servent à trancher à l'usage. Ce qui est
// vérifié ici est donc : qu'ils tombent tous les quatre, qu'ils ne tombent
// pas sans le drapeau, et — le plus important — QU'IL N'EN SORT QUE DES
// DURÉES. Une sonde qui laisserait passer le texte d'une offre dans la
// console serait pire que pas de sonde.

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/lib/forms/no-js-actions", () => ({ saveTurnWithoutJs: vi.fn() }));

const ANALYSE = "11111111-1111-4111-8111-111111111111";
const REPONSE = "Merci pour le retour. On peut monter à 1 800 € mais on garde l'exclusivité trois mois.".padEnd(MIN_REPLY_LENGTH, ".");

// Un vrai tour, produit par le moteur : c'est ce que le serveur renverrait.
const scenario = loadScenarios().find((s) => s.id === "03-termes-a-la-hausse")!;
const execute = runScenario(scenario).result;
if (execute.kind !== "turn") throw new Error("le scénario de mesure doit produire un tour");
const TOUR: ThreadTurnView = {
  turnNumber: 2,
  createdAt: "2026-10-19T10:00:00.000Z",
  brandReply: scenario.reponse_marque,
  payload: execute.payload,
};

const FIL = { analysisId: ANALYSE, conclusion: null, access: "open" as const };

function requeteSuspendue() {
  let repondre: (value: unknown) => void = () => undefined;
  const promesse = new Promise((resolve) => {
    repondre = resolve;
  });
  const fetchFeint = vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>(() => promesse);
  vi.stubGlobal("fetch", fetchFeint);
  return { fetchFeint, reussir: () => repondre({ ok: true, status: 200, json: async () => ({ turnNumber: 2 }) }) };
}

let journal: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  refresh.mockClear();
  chronoOublie();
  window.localStorage.clear();
  delete (window as unknown as Record<string, unknown>)[CHRONO_GLOBAL];
  journal = vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// Du clic jusqu'au tour affiché. Le quatrième repère ne dépend pas de la
// réponse HTTP mais de l'arrivée du tour dans le fil RENDU PAR LE SERVEUR :
// c'est le nouveau rendu, ici simulé par un rerender, qui le déclenche.
async function unTourComplet() {
  const { reussir, fetchFeint } = requeteSuspendue();
  const user = userEvent.setup();
  const { rerender } = render(<NegotiationThread {...FIL} turns={[]} />);
  await user.click(screen.getByPlaceholderText("Colle ici la réponse de la marque…"));
  await user.paste(REPONSE);
  await user.click(screen.getByRole("button", { name: "Analyser sa réponse" }));
  await waitFor(() => expect(fetchFeint).toHaveBeenCalled());
  reussir();
  await waitFor(() => expect(refresh).toHaveBeenCalled());
  rerender(<NegotiationThread {...FIL} turns={[TOUR]} />);
  return { rerender };
}

describe("le drapeau commande tout", () => {
  it("ÉTEINT par défaut : rien n'est mesuré, rien n'est affiché, rien n'est posé sur window", async () => {
    await unTourComplet();
    expect(chronoSeries()).toHaveLength(0);
    expect((window as unknown as Record<string, unknown>)[CHRONO_GLOBAL]).toBeUndefined();
    expect(journal.mock.calls.flat().join(" ")).not.toContain("[negoscore] chrono");
  });

  it("un localStorage qui refuse de répondre vaut « éteint », pas une exception", async () => {
    const vrai = window.localStorage.getItem;
    window.localStorage.getItem = () => {
      throw new Error("données de site bloquées");
    };
    try {
      await expect(unTourComplet()).resolves.toBeTruthy();
      expect(chronoSeries()).toHaveLength(0);
    } finally {
      window.localStorage.getItem = vrai;
    }
  });
});

describe("les quatre repères, drapeau levé", () => {
  beforeEach(() => {
    window.localStorage.setItem(CHRONO_FLAG, "1");
  });

  it("LES QUATRE TOMBENT, dans l'ordre, du clic au tour affiché", async () => {
    await unTourComplet();
    await waitFor(() => expect(chronoSeries()[0]?.marques.tour_affiche).toBeDefined());
    const serie = chronoSeries()[0];
    expect(serie.rang).toBe(1);
    for (const marque of CHRONO_MARKS) expect(serie.marques[marque], marque).toBeDefined();
    // Des décalages depuis le clic : jamais décroissants, et le clic à zéro.
    expect(serie.marques.clic).toBe(0);
    const suite = CHRONO_MARKS.map((m) => serie.marques[m]!);
    expect([...suite].sort((a, b) => a - b)).toEqual(suite);
  });

  it("LA CONSOLE DIT CE QU'IL S'EST PASSÉ ENTRE LES REPÈRES, pas des heures", async () => {
    await unTourComplet();
    await waitFor(() => expect(journal.mock.calls.flat().join("\n")).toContain("[negoscore] chrono tour 1"));
    const sortie = journal.mock.calls.flat().join("\n");
    expect(sortie).toContain("clic sur le bouton → requête partie");
    expect(sortie).toContain("requête partie → réponse reçue");
    expect(sortie).toContain("réponse reçue → tour affiché");
    expect(sortie).toContain("TOTAL clic → tour affiché");
    // Le plancher d'attente est décompté : sans ça on lirait 900 ms de
    // serveur lent là où il n'y a qu'un plancher d'affichage.
    expect(sortie).toContain("plancher d'attente");
  });

  it("RIEN D'AUTRE QUE DES DURÉES N'EN SORT — ni offre, ni compte, ni montant", async () => {
    await unTourComplet();
    await waitFor(() => expect(journal.mock.calls.flat().join("\n")).toContain("chrono tour 1"));
    const lecteur = (window as unknown as Record<string, () => unknown>)[CHRONO_GLOBAL];
    const tout = `${journal.mock.calls.flat().join("\n")}\n${JSON.stringify(lecteur())}\n${JSON.stringify(chronoSeries())}`;
    // Le texte collé, l'identifiant de l'analyse, le montant de la marque et
    // le message préparé : aucun ne doit figurer nulle part.
    for (const secret of [ANALYSE, REPONSE, "exclusivité", "1 800", "450", scenario.reponse_marque]) {
      expect(tout, secret).not.toContain(secret);
    }
    // Et la sonde ne parle à personne : elle n'appelle que la console.
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0]).toBe(`/api/analyses/${ANALYSE}/tours`);
  });

  it("LE LECTEUR DE CONSOLE est posé, et rend les segments", async () => {
    await unTourComplet();
    await waitFor(() => expect(chronoSeries()[0]?.marques.tour_affiche).toBeDefined());
    const lecteur = (window as unknown as Record<string, () => Array<Record<string, string>>>)[CHRONO_GLOBAL];
    expect(typeof lecteur).toBe("function");
    const lignes = lecteur();
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({ tour: 1 });
    expect(Object.keys(lignes[0])).toContain("clic→requete_partie");
    expect(Object.keys(lignes[0])).toContain("requete_partie→reponse_recue");
    expect(Object.keys(lignes[0])).toContain("reponse_recue→tour_affiche");
    expect(lignes[0].total).toMatch(/^\d+ ms$/);
  });

  it("le fil n'affiche qu'une fois, et ce n'est pas la garde du module qui l'en empêche", async () => {
    // Dit exactement : le composant ne peut PAS reposer le quatrième repère.
    // L'effet d'arrivée a pour dépendances [arrived, analysisId] — un
    // réaffichage du même tour ne le rejoue pas — et chronoRef est vidé juste
    // après. La batterie de mutation l'a montré : retirer la garde du module
    // ne cassait rien ici. Ce test vérifie donc le fil, pas la garde.
    const { rerender } = await unTourComplet();
    await waitFor(() => expect(chronoSeries()[0]?.marques.tour_affiche).toBeDefined());
    const premier = chronoSeries()[0].marques.tour_affiche;
    rerender(<NegotiationThread {...FIL} turns={[TOUR]} />);
    rerender(<NegotiationThread {...FIL} turns={[TOUR]} />);
    expect(chronoSeries()[0].marques.tour_affiche).toBe(premier);
    expect(journal.mock.calls.flat().join("\n").split("[negoscore] chrono tour 1")).toHaveLength(2);
  });

  it("UN REPÈRE NE S'ÉCRIT QU'UNE FOIS — la garde du module, éprouvée à la main", async () => {
    // chronoMarque est exportée : un appelant futur pourra la rappeler avec
    // le même rang. Sans cette garde, le repère serait réécrit plus tard et
    // le total grandirait sans que rien ne se soit passé — un chiffre faux
    // dans l'outil même qui sert à ne plus supposer.
    const t = vi.spyOn(Date, "now");
    t.mockReturnValue(5_000_000);
    const rang = chronoDebut();
    t.mockReturnValue(5_000_040);
    chronoMarque(rang, "reponse_recue");
    t.mockReturnValue(5_009_000);
    chronoMarque(rang, "reponse_recue");
    expect(chronoSeries().at(-1)?.marques.reponse_recue).toBe(40);
  });
});
