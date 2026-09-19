import { writeFileSync } from "node:fs";
import path from "node:path";
import { readBrandReply } from "@/lib/llm/turn";
import { loadScenarios, SCENARIOS_DIR, scenarioContext, type Scenario } from "@/lib/negotiation/scenarios/index";
import { processTurn, stateBefore } from "@/lib/negotiation/turn";

// Mission #080, F8 — réenregistre la sortie du VRAI modèle pour les scénarios
// de réponses de marque (lib/negotiation/scenarios/*.json), puis compare le
// résultat du code à ce que chaque scénario attend.
//
// APPEL PAYANT au modèle (un appel par scénario, quelques dixièmes de centime).
// Jamais lancé par les tests.
//
// pnpm negociation:enregistrer                      → tous les scénarios
// pnpm negociation:enregistrer 05-refus-net         → un seul
//
// Seul le champ « sortie_modele » est réécrit. « attendu » reste celui que tu as
// écrit : si le modèle réel ne donne pas ce qui est attendu, le script le dit,
// et `pnpm test` échouera jusqu'à ce que tu tranches (corriger le prompt, ou
// corriger l'attendu si c'est lui qui était faux).

function verdict(scenario: Scenario, result: ReturnType<typeof processTurn>): string[] {
  const problems: string[] = [];
  const { attendu } = scenario;
  if (attendu.type === "hors_sujet") return result.kind === "off_topic" ? [] : ["attendu hors sujet, lu comme une réponse"];
  if (result.kind !== "turn") return ["lu comme hors sujet"];
  const p = result.payload;
  if (attendu.issue && p.outcome !== attendu.issue) problems.push(`issue ${p.outcome} au lieu de ${attendu.issue}`);
  if (attendu.nouveau_chiffrage !== undefined && (p.pricing_after !== null) !== attendu.nouveau_chiffrage) problems.push("chiffrage refait ou non, contrairement à l'attendu");
  if (attendu.conclusion !== undefined && (p.conclusion !== null) !== attendu.conclusion) problems.push("conclusion présente ou absente, contrairement à l'attendu");
  if (attendu.message_de_repli !== undefined && p.message.fallback !== attendu.message_de_repli) {
    problems.push(`message de repli : ${p.message.fallback} (${p.message.fallback_reasons.join(", ") || "aucune raison"})`);
  }
  for (const [id, status] of Object.entries(attendu.demandes ?? {})) {
    const got = p.asks.find((ask) => ask.id === id)?.status;
    if (got !== status) problems.push(`demande ${id} : ${got} au lieu de ${status}`);
  }
  if (attendu.termes_changes) {
    const got = p.changes.map((c) => c.group).sort().join(",");
    if (got !== [...attendu.termes_changes].sort().join(",")) problems.push(`termes changés : ${got || "aucun"}`);
  }
  return problems;
}

async function main() {
  const wanted = process.argv.slice(2);
  const scenarios = loadScenarios().filter((s) => wanted.length === 0 || wanted.includes(s.id));
  if (scenarios.length === 0) throw new Error(`Aucun scénario ne correspond à : ${wanted.join(", ")}`);
  let cost = 0;
  let failures = 0;
  for (const scenario of scenarios) {
    const context = scenarioContext(scenario);
    const state = stateBefore(context.original, context.previous);
    const { reading, usage } = await readBrandReply({
      deal: state.deal,
      asks: state.asks,
      lastMessage: context.original.ready_to_send_message?.text ?? "",
      brandReply: scenario.reponse_marque,
    });
    cost += usage.costEur;
    const updated: Scenario = { ...scenario, sortie_modele: reading };
    writeFileSync(path.join(SCENARIOS_DIR, `${scenario.id}.json`), `${JSON.stringify(updated, null, 2)}\n`);
    const problems = verdict(scenario, processTurn(context, reading));
    if (problems.length > 0) failures += 1;
    console.log(`${problems.length === 0 ? "OK " : "ÉCART"} ${scenario.id} — ${usage.latencyMs} ms${problems.length ? `\n      ${problems.join("\n      ")}` : ""}`);
  }
  console.log(`\n${scenarios.length} scénario(s), ${failures} écart(s), coût ${cost.toFixed(5)} €.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
