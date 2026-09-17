import { readdirSync } from "node:fs";
import path from "node:path";
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER } from "next/constants";
import { describe, expect, it } from "vitest";
import { pageExtensionsFor } from "@/next.config";
import { activeStep, WAITING_STEPS } from "@/components/loading-steps";

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

describe("écran d'attente", () => {
  it("les quatre étapes, dans l'ordre du traitement", () => {
    expect(WAITING_STEPS.map((s) => s.label)).toEqual([
      "Lecture de l'offre",
      "Identification des droits cédés",
      "Chiffrage sur la table française",
      "Rédaction de ta réponse",
    ]);
  });

  it("défile au rythme médian mesuré, la dernière étape attend la réponse réelle", () => {
    expect(activeStep(0, false)).toBe(0);
    expect(activeStep(3_600, false)).toBe(1);
    expect(activeStep(8_600, false)).toBe(2);
    expect(activeStep(12_600, false)).toBe(3);
    // Sans réponse, jamais « terminé », même très longtemps après.
    expect(activeStep(10 * 60_000, false)).toBe(3);
    expect(activeStep(500, true)).toBe(WAITING_STEPS.length);
  });
});
