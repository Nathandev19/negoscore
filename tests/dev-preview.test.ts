import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER } from "next/constants";
import { describe, expect, it } from "vitest";
import { pageExtensionsFor } from "@/next.config";
import { AFTER_READING_STEPS, checkedSteps, formatElapsed, READING_LABEL, REVEAL_TOTAL_MS } from "@/components/loading-steps";

// Route de prévisualisation (app/dev) : reconnue par `next dev` seulement.

describe("prévisualisation de développement", () => {
  it("les extensions .dev.* ne sont des pages ou des routes qu'en développement", () => {
    expect(pageExtensionsFor(PHASE_DEVELOPMENT_SERVER)).toEqual(expect.arrayContaining(["dev.tsx", "dev.ts"]));
    for (const phase of [PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER]) {
      expect(pageExtensionsFor(phase).some((ext) => ext.startsWith("dev."))).toBe(false);
    }
  });

  it("tout fichier de app/dev porte l'extension .dev : rien n'y devient une route en production", () => {
    const files = readdirSync(path.join(process.cwd(), "app", "dev"), { recursive: true, withFileTypes: true }).filter((e) => e.isFile());
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) expect(file.name, file.name).toMatch(/\.dev\.tsx?$/);
  });
});

describe("écran d'attente : aucune étape cochée avant d'être franchie", () => {
  it("lecture selon l'entrée, puis les trois étapes faites après la réponse du modèle", () => {
    expect(READING_LABEL).toEqual({ text: "Lecture de l'offre", photo: "Lecture de la capture", pdf: "Lecture du document" });
    expect(AFTER_READING_STEPS).toEqual(["Identification des droits cédés", "Chiffrage sur la table française", "Rédaction de ta réponse"]);
  });

  it("pendant l'appel au modèle, rien n'est coché, quel que soit le temps écoulé", () => {
    expect(checkedSteps(null)).toBe(0);
  });

  it("après la réponse : lecture cochée tout de suite, puis une étape tous les 180 ms, dans l'ordre", () => {
    expect(checkedSteps(0)).toBe(1);
    expect(checkedSteps(179)).toBe(1);
    expect(checkedSteps(180)).toBe(2);
    expect(checkedSteps(360)).toBe(3);
    expect(checkedSteps(540)).toBe(4);
    expect(checkedSteps(10_000)).toBe(4);
    expect(REVEAL_TOTAL_MS).toBe(720);
  });

  it("plus de défilement calé sur une durée estimée", async () => {
    const source = readFileSync(path.join(process.cwd(), "components", "loading-steps.tsx"), "utf8");
    expect(source).not.toMatch(/14[,.]3|médian|WAITING_STEPS|ms: \d/);
  });

  it("temps écoulé affiché lisiblement", () => {
    expect(formatElapsed(0)).toBe("0 s");
    expect(formatElapsed(14_900)).toBe("14 s");
    expect(formatElapsed(65_000)).toBe("1 min 05 s");
  });
});
