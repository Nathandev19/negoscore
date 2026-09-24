import { describe, expect, it } from "vitest";
import { resolveEnvironment, TELEMETRY_ENVIRONMENTS, type EnvironmentSource } from "@/lib/telemetry/environment";

// Mission #103 — l'environnement d'une ligne de télémétrie, décidé par le
// serveur et par lui seul. Fonction pure : aucun process.env n'est muté ici.

const env = (source: EnvironmentSource) => resolveEnvironment(source);

describe("les sept règles, une par une", () => {
  it("1. run de tests (VITEST défini) : test", () => {
    expect(env({ VITEST: "true" })).toBe("test");
  });

  it("2. VERCEL_ENV=production : production", () => {
    expect(env({ VERCEL_ENV: "production" })).toBe("production");
  });

  it("3. VERCEL_ENV=preview : preview", () => {
    expect(env({ VERCEL_ENV: "preview" })).toBe("preview");
  });

  it("4. VERCEL_ENV=development : development", () => {
    expect(env({ VERCEL_ENV: "development" })).toBe("development");
  });

  it("5. NODE_ENV=test : test", () => {
    expect(env({ NODE_ENV: "test" })).toBe("test");
  });

  it("6. NODE_ENV=development : development", () => {
    expect(env({ NODE_ENV: "development" })).toBe("development");
  });

  it("7. rien d'autre : unknown", () => {
    expect(env({ NODE_ENV: "production" })).toBe("unknown");
  });
});

describe("ce qui ne doit jamais devenir de la production", () => {
  it("VITEST défini ET VERCEL_ENV=production : test, jamais production", () => {
    // L'ordre est volontaire : un test d'intégration lancé avec VERCEL_ENV
    // positionné ne doit pas pouvoir écrire de la production.
    expect(env({ VITEST: "true", VERCEL_ENV: "production" })).toBe("test");
    expect(env({ VITEST: "", VERCEL_ENV: "production" })).toBe("test");
  });

  it("rien de défini : unknown", () => {
    expect(env({})).toBe("unknown");
  });

  it("valeur VERCEL_ENV inconnue : unknown", () => {
    expect(env({ VERCEL_ENV: "staging" })).toBe("unknown");
    expect(env({ VERCEL_ENV: "Production" })).toBe("unknown");
    expect(env({ VERCEL_ENV: "prod" })).toBe("unknown");
  });

  it("aucune entrée ne produit une valeur hors de l'énumération", () => {
    const sources: EnvironmentSource[] = [
      {}, { VITEST: "1" }, { VERCEL_ENV: "production" }, { VERCEL_ENV: "preview" }, { VERCEL_ENV: "development" },
      { VERCEL_ENV: "n'importe quoi" }, { NODE_ENV: "test" }, { NODE_ENV: "development" }, { NODE_ENV: "production" },
      { VITEST: "true", VERCEL_ENV: "production", NODE_ENV: "production" },
    ];
    for (const source of sources) expect(TELEMETRY_ENVIRONMENTS).toContain(env(source));
  });

  it("la fonction ne lit rien d'autre que ce qu'on lui donne", async () => {
    // Un seul appelant de process.env dans le module : currentEnvironment.
    const source = (await import("node:fs")).readFileSync("lib/telemetry/environment.ts", "utf8");
    const code = source.replace(/^\s*\/\/.*$/gm, "");
    expect(code.match(/process\.env/g) ?? []).toHaveLength(1);
    // Pas d'interrupteur propre au produit : un réglage qu'on peut mettre à
    // « production » à la main est exactement le défaut qu'on corrige.
    expect(code).not.toMatch(/NEGOSCORE_ENV|TELEMETRY_ENV=|request\.headers/i);
  });
});
