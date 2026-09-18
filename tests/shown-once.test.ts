import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isShowing, noteLocation, resetShownOnce, showOnce } from "@/lib/shown-once";

// Mission #068, partie A — un message montré une fois ne réapparaît jamais
// dans le même document. Chaque test rejoue ce que fait l'application à chaque
// page : l'enregistrement à l'arrivée, puis noteLocation (la mise en page, à
// chaque changement de chemin), puis la décision d'affichage du composant.

beforeEach(() => {
  resetShownOnce();
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("bandeau « Déconnexion réussie » : aller-retour interne sur sa page d'arrivée", () => {
  it("affiché à l'arrivée, disparu ailleurs, et ne revient pas au retour", async () => {
    const { bannerVisible, FLASH_KEY } = await import("@/components/flash-banner");
    const { noteLocation: note, showOnce: show } = await import("@/lib/shown-once");
    const flash = { kind: "deconnexion" as const, pathname: "/" };
    show(FLASH_KEY, "/"); // lecture du cookie à l'arrivée

    note("/");
    expect(bannerVisible(flash, "/", false)).toBe(true);
    note("/tarifs"); // lien interne vers /tarifs
    expect(bannerVisible(flash, "/tarifs", false)).toBe(false);
    note("/"); // retour sur l'accueil, sans rechargement
    expect(bannerVisible(flash, "/", false)).toBe(false);
  });

  it("fermé par son bouton : ne revient pas non plus", async () => {
    const { bannerVisible, FLASH_KEY } = await import("@/components/flash-banner");
    const { spend, showOnce: show } = await import("@/lib/shown-once");
    const flash = { kind: "connexion" as const, pathname: "/historique" };
    show(FLASH_KEY, "/historique");
    spend(FLASH_KEY);
    expect(bannerVisible(flash, "/historique", false)).toBe(false);
  });

  it("un document neuf (rechargement complet) repart de zéro : le bandeau n'y revient que si le cookie est reposé", async () => {
    const { bannerVisible, FLASH_KEY } = await import("@/components/flash-banner");
    const { resetShownOnce: reset, showOnce: show } = await import("@/lib/shown-once");
    const flash = { kind: "connexion" as const, pathname: "/" };
    reset(); // rechargement : registre vide
    expect(bannerVisible(flash, "/", false)).toBe(false); // pas de cookie relu, rien d'enregistré
    show(FLASH_KEY, "/"); // cookie reposé par le serveur, relu à l'arrivée
    expect(bannerVisible(flash, "/", false)).toBe(true);
  });
});

describe("pastille « Débloqué à l'instant » : aller-retour interne sur la page de résultat", () => {
  const RESULT = "/analyse/resultat/11111111-1111-4111-8111-111111111111";

  function at(pathname: string, hash = "") {
    vi.stubGlobal("window", { location: { pathname, hash } });
  }

  it("affichée à l'arrivée sur #message, et plus jamais après un aller-retour sans rechargement", async () => {
    const { readArrival } = await import("@/components/result/analysis-result");
    const { noteLocation: note } = await import("@/lib/shown-once");

    at(RESULT, "#message"); // arrivée après la connexion qui débloque
    expect(readArrival()).toBe(true);
    note(RESULT);
    expect(readArrival()).toBe(true); // re-rendus sur la même visite : toujours là

    at("/historique"); // lien interne vers « Mes analyses »
    note("/historique");

    at(RESULT); // retour sur l'analyse (l'ancre a été retirée à l'arrivée)
    note(RESULT);
    expect(readArrival()).toBe(false);
  });

  it("sans #message à l'arrivée : jamais de pastille", async () => {
    const { readArrival } = await import("@/components/result/analysis-result");
    at(RESULT);
    expect(readArrival()).toBe(false);
  });
});

describe("registre « montré une fois »", () => {
  it("un message ne s'enregistre qu'une fois par document : un réenregistrement ne le ranime pas", () => {
    showOnce("x", "/a");
    expect(isShowing("x", "/a")).toBe(true);
    noteLocation("/b");
    showOnce("x", "/a"); // ignoré : il reste consommé
    noteLocation("/a");
    expect(isShowing("x", "/a")).toBe(false);
  });
});
