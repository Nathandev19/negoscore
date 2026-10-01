import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { isMeasurementAgent, MEASURE_AGENT_TOKEN } from "@/lib/telemetry/internal";

// Mission #135, A — LE NAVIGATEUR DE MESURE SE MARQUE LUI-MÊME.
//
// Les vérifications de #134 et #137 sont passées par un Chrome sans tête piloté
// contre la production. Il remplaçait son User-Agent par celui d'un téléphone,
// pour mesurer les bonnes conditions, et rien ne disait qu'il s'agissait d'une
// mesure : ses passages ont été comptés comme de vraies visites. Au moins une
// visite `dm_exemple` du cockpit vient de là.
//
// Le cookie de #118 ne pouvait pas servir : son secret vit dans Vercel et n'en
// sort pas. Le jeton, lui, n'ouvre rien — il ne fait que dire ce que ce
// navigateur est.

const entetes = vi.hoisted(() => ({ ua: null as string | null }));
// Le marquage se décide PAR REQUÊTE : on contrôle donc les en-têtes, et rien
// d'autre. Pas de cookie, pas de compte : on isole la troisième source.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, has: () => false }),
  headers: async () => new Headers(entetes.ua === null ? {} : { "user-agent": entetes.ua }),
}));
vi.mock("@/lib/supabase/server", () => ({ selectRows: async () => [], isMissingColumn: () => false }));

const UA_TELEPHONE =
  "Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36";
const UA_MESURE = `${UA_TELEPHONE} ${MEASURE_AGENT_TOKEN}`;

describe("le jeton de mesure", () => {
  it("vit à UN SEUL endroit, et le script de mesure le lit là", () => {
    const script = readFileSync("scripts/mesure-pages.mjs", "utf8");
    // Le script ne recopie pas la valeur : il l'extrait du module du produit.
    expect(script).toContain('readFileSync(path.join(process.cwd(), "lib/telemetry/internal.ts"), "utf8")');
    expect(script).toContain('/MEASURE_AGENT_TOKEN = "([^"]+)"/');
    // Et il le colle à l'agent qu'il émule.
    expect(script).toContain("${MEASURE_AGENT_TOKEN}`");
    // Aucune copie en dur de la valeur, nulle part ailleurs dans le script.
    expect(script.split(MEASURE_AGENT_TOKEN)).toHaveLength(1);
  });

  it("se reconnaît dans un User-Agent, quelle que soit la casse", () => {
    expect(isMeasurementAgent(UA_MESURE)).toBe(true);
    expect(isMeasurementAgent(UA_MESURE.toLowerCase())).toBe(true);
    expect(isMeasurementAgent(UA_MESURE.toUpperCase())).toBe(true);
    expect(isMeasurementAgent(MEASURE_AGENT_TOKEN)).toBe(true);
  });

  it("ne se reconnaît pas dans le navigateur de quelqu'un d'autre", () => {
    expect(isMeasurementAgent(UA_TELEPHONE)).toBe(false);
    expect(isMeasurementAgent(null)).toBe(false);
    expect(isMeasurementAgent(undefined)).toBe(false);
    expect(isMeasurementAgent("")).toBe(false);
    expect(isMeasurementAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1")).toBe(false);
  });

  it("n'est pas pris pour un robot : la ligne doit être ÉCRITE, pas jetée", async () => {
    // On veut pouvoir compter combien de requêtes de mesure ont eu lieu. Si le
    // filtre des robots l'écartait, il n'en resterait aucune trace.
    const { isRobot } = await import("@/lib/analytics/robots");
    expect(isRobot(UA_MESURE)).toBe(false);
    // Et le jeton ne contient aucun des mots qui déclenchent ce filtre.
    expect(MEASURE_AGENT_TOKEN).not.toMatch(/bot|crawler|spider|headless|puppeteer|playwright/i);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("une requête de mesure ressort interne", () => {

  async function marquage(userAgent: string | null): Promise<boolean> {
    entetes.ua = userAgent;
    vi.resetModules();
    const { internalTraffic } = await import("@/lib/telemetry/tagged");
    return internalTraffic(null);
  }

  it("avec le jeton : interne", async () => {
    expect(await marquage(UA_MESURE)).toBe(true);
  });

  it("sans le jeton : pas interne", async () => {
    expect(await marquage(UA_TELEPHONE)).toBe(false);
    expect(await marquage(null)).toBe(false);
  });
});
