import { readBrandReply } from "@/lib/llm/turn";
import { TURN_SYSTEM_PROMPT, buildTurnUserMessage, turnReadingJsonSchema } from "@/lib/llm/turn-prompt";
import type { ExtractOptions } from "@/lib/llm/extract";
import { loadScenarios, scenarioContext } from "@/lib/negotiation/scenarios/index";
import { processTurn, stateBefore } from "@/lib/negotiation/turn";
import type { TurnReading } from "@/lib/negotiation/types";

// Mission #202 — LE RÉGLAGE DE RAISONNEMENT D'UN TOUR, MESURÉ.
//
// Même fonction que la production (readBrandReply), même prompt, même schéma,
// même fixture : seul le réglage change. Ce qui est comparé n'est pas la
// latence seule mais la SORTIE — accords, refus, citations, message — parce
// qu'un réglage plus rapide qui lit mal ne vaut rien.
//
// CONSOMME DE L'API. Sans --confirm, rien n'est appelé : le plan s'affiche.
//
//   node --env-file-if-exists=.env.local --import ./evals/register-alias.mjs \
//        --disable-warning=MODULE_TYPELESS_PACKAGE_JSON evals/tour-effort.ts \
//        --variantes=defaut,none --passes=3 --confirm

const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? fallback;
const CONFIRM = args.includes("--confirm");
const PASSES = Number(flag("passes", "3"));
const SCENARIO = flag("scenario", "03-termes-a-la-hausse");

// « defaut » : le paramètre reasoning n'est PAS envoyé, l'API applique sa
// valeur par défaut (« medium » pour ce modèle). C'était la production avant
// la mission #202. « production » : ce que le code envoie aujourd'hui.
const VARIANTES: Record<string, ExtractOptions> = {
  defaut: { reasoningEffort: null },
  production: {},
  none: { reasoningEffort: "none" },
  low: { reasoningEffort: "low" },
  medium: { reasoningEffort: "medium" },
};

const demandees = flag("variantes", "defaut,none").split(",");

const scenario = loadScenarios().find((s) => s.id === SCENARIO);
if (!scenario) throw new Error(`scénario ${SCENARIO} introuvable`);
const context = scenarioContext(scenario);
const state = stateBefore(context.original, [], scenario.reponse_marque);
const lastMessage = context.original.ready_to_send_message?.text ?? "";
const entree = {
  deal: state.deal,
  asks: state.asks,
  points: state.points,
  lastMessage,
  brandReply: scenario.reponse_marque,
};

const systemeChars = TURN_SYSTEM_PROMPT.length;
const userChars = buildTurnUserMessage(entree).length;
const schemaChars = JSON.stringify(turnReadingJsonSchema()).length;

console.log(`Scénario   : ${scenario.id} (${scenario.titre})`);
console.log(`Prompt     : système ${systemeChars} car. + utilisateur ${userChars} car.`);
console.log(`Schéma     : ${schemaChars} car.`);
console.log(`Plan       : ${demandees.length} variantes × ${PASSES} passes = ${demandees.length * PASSES} appels`);
if (!CONFIRM) {
  console.log("\nAucun appel : relance avec --confirm.");
  process.exit(0);
}

// Ce qui doit rester identique d'un réglage à l'autre. Pas le texte du message
// mot pour mot — un modèle ne réécrit jamais deux fois la même phrase — mais
// tout ce dont une décision dépend.
function empreinte(reading: TurnReading) {
  return {
    relevance: reading.relevance,
    outcome: reading.outcome,
    global_agreement: reading.global_agreement,
    asks: reading.asks.map((a) => `${a.id}=${a.status}${a.quote ? `«${a.quote}»` : ""}`).sort(),
    changes: reading.changes.map((c) => `${c.group}«${c.quote}»`).sort(),
    deal: reading.deal,
    questions: reading.brand_questions.map((q) => q.quote).sort(),
  };
}

type Ligne = {
  variante: string;
  passe: number;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  schemaValidFirstTry: boolean;
  attempts: number;
  costEur: number;
  erreur: string | null;
  empreinte: unknown;
  // Ce que le MOTEUR en fait : c'est ça que la personne voit.
  aval: { kind: string; outcome?: string; changes?: number; messageFallback?: boolean; messageChars?: number } | null;
};

const lignes: Ligne[] = [];

for (const nom of demandees) {
  const options = VARIANTES[nom];
  if (!options) throw new Error(`variante inconnue : ${nom}`);
  for (let passe = 1; passe <= PASSES; passe++) {
    try {
      const { reading, usage } = await readBrandReply(entree, options);
      const sortie = processTurn({ ...context, offerText: scenario.reponse_marque }, reading);
      lignes.push({
        variante: nom,
        passe,
        latencyMs: usage.latencyMs,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        reasoningTokens: usage.reasoningTokens,
        schemaValidFirstTry: usage.schemaValidFirstTry,
        attempts: usage.attempts,
        costEur: usage.costEur,
        erreur: null,
        empreinte: empreinte(reading),
        aval:
          sortie.kind === "off_topic"
            ? { kind: "off_topic" }
            : {
                kind: "turn",
                outcome: sortie.payload.outcome,
                changes: sortie.payload.changes.length,
                messageFallback: sortie.payload.message.fallback,
                messageChars: sortie.payload.message.text.length,
              },
      });
      const l = lignes.at(-1)!;
      console.log(
        `${nom.padEnd(8)} passe ${passe}  ${String(l.latencyMs).padStart(6)} ms  ` +
          `entrée ${l.inputTokens} / sortie ${l.outputTokens} (dont raisonnement ${l.reasoningTokens})  ` +
          `schéma bon du 1er coup : ${l.schemaValidFirstTry ? "oui" : "NON"}  ` +
          `aval ${l.aval?.kind}/${l.aval?.outcome ?? "-"} ${l.aval?.changes ?? "-"} chgt, repli ${l.aval?.messageFallback}`,
      );
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      lignes.push({
        variante: nom, passe, latencyMs: -1, inputTokens: 0, outputTokens: 0, reasoningTokens: 0,
        schemaValidFirstTry: false, attempts: 0, costEur: 0, erreur: message, empreinte: null, aval: null,
      });
      console.log(`${nom.padEnd(8)} passe ${passe}  ÉCHEC : ${message}`);
    }
  }
}

// Les mesures sont écrites, pas seulement affichées : un rapport qui cite un
// chiffre doit pouvoir pointer le fichier qui le contient.
const { mkdirSync, writeFileSync } = await import("node:fs");
const path = await import("node:path");
const dossier = path.join(process.cwd(), "evals", "results");
mkdirSync(dossier, { recursive: true });
const fichier = path.join(dossier, `tour-effort-${new Date().toISOString().replaceAll(":", "-").replace(".", "-")}.json`);
writeFileSync(fichier, JSON.stringify({ scenario: scenario.id, systemeChars, userChars, schemaChars, lignes }, null, 1), "utf8");
console.log(`\nÉcrit : ${path.relative(process.cwd(), fichier)}`);

// Les empreintes identiques d'une variante à l'autre : la seule chose qui
// autorise à retenir un réglage plus rapide.
const parVariante = new Map<string, string[]>();
for (const l of lignes) {
  if (l.empreinte === null) continue;
  parVariante.set(l.variante, [...(parVariante.get(l.variante) ?? []), JSON.stringify(l.empreinte)]);
}
for (const [nom, empreintes] of parVariante) {
  const stables = new Set(empreintes).size === 1;
  console.log(`${nom.padEnd(10)} : ${stables ? "les passes donnent la MÊME lecture" : `${new Set(empreintes).size} lectures différentes sur ${empreintes.length} passes`}`);
}
const noms = [...parVariante.keys()];
if (noms.length === 2) {
  const [a, b] = noms;
  const communes = parVariante.get(a)!.filter((e) => parVariante.get(b)!.includes(e)).length;
  console.log(`${a} vs ${b} : ${communes > 0 ? "lecture IDENTIQUE" : "lectures DIFFÉRENTES — à examiner champ par champ"}`);
}
