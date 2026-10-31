import { callStructured, type ExtractOptions } from "@/lib/llm/extract";
import { fuitesDeLExtraction, scriptsAutorises, scriptsNonLatins, type FuiteDeLangue, type ScriptNomme } from "@/lib/llm/langue";
import { MODEL } from "@/lib/llm/model";
import { buildUserMessage, extractionJsonSchema, extractionSchema, SYSTEM_PROMPT, type Extraction } from "@/lib/llm/prompt";
import { CORPUS } from "@/evals/langue-corpus";
import { newcombe, promptEnTete, wilson } from "@/evals/langue-mesure";

// Mission #211 — À QUELLE FRÉQUENCE LA LANGUE FUIT-ELLE, ET LA POSITION DE
// LA CONSIGNE Y CHANGE-T-ELLE QUELQUE CHOSE.
//
// CONSOMME DE L'API. Sans --confirm, rien n'est appelé : le coût estimé
// s'affiche et le script s'arrête.
//
//   node --env-file-if-exists=.env.local --import ./evals/register-alias.mjs \
//        --disable-warning=MODULE_TYPELESS_PACKAGE_JSON evals/langue.ts \
//        --passes=30 --confirm
//
// POURQUOI CE SCRIPT N'APPELLE PAS extractDeal.
//
// extractDeal REPREND quand il voit une fuite (lib/llm/extract.ts) : mesurer
// à travers lui ne mesurerait pas la fréquence de la fuite, mais la fréquence
// de son échec après reprise — et coûterait deux appels à chaque fois. Ici un
// échantillon vaut UN appel, et le contrôle de langue est appliqué APRÈS, sur
// la sortie brute. C'est la fréquence par appel, celle dont dépend la décision.
//
// Le schéma, le modèle, la verbosité, l'effort de raisonnement et le message
// utilisateur sont ceux de la production. Seule la POSITION de la consigne de
// langue change d'une condition à l'autre.
//
// TEMPÉRATURE : aucune n'est envoyée, ni ici ni en production — le code ne
// passe pas ce paramètre (lib/llm/extract.ts, client.responses.create). La
// valeur par défaut du fournisseur s'applique. Elle n'est donc pas à zéro par
// construction, et la répétition a un sens : la mesure du 18/10/2026
// (evals/results/tour-effort-*.json) montre des sorties différentes d'une
// passe à l'autre sur la même entrée.

const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? fallback;
const CONFIRM = args.includes("--confirm");
const PASSES = Number(flag("passes", "30"));
const PARALLELE = Number(flag("parallele", "4"));
const PLAFOND_EUR = Number(flag("plafond", "5"));

const CONDITIONS: Record<string, string> = {
  actuel: SYSTEM_PROMPT,
  tete: promptEnTete(),
};

// ── MESURE D'UN ÉCHANTILLON ─────────────────────────────────────────────────

const SCHEMA = extractionJsonSchema();
const OPTIONS: ExtractOptions = {};

type Echantillon = {
  offre: string;
  condition: string;
  passe: number;
  /** Fuite au sens de la production : écriture absente de l'offre. */
  fuites: FuiteDeLangue[];
  /** Écritures non latines présentes, autorisées ou non. Sépare « le modèle en a écrit » de « il n'avait pas le droit ». */
  nonLatinPresent: string[];
  inputTokens: number;
  outputTokens: number;
  costEur: number;
  latencyMs: number;
  attempts: number;
  schemaValidFirstTry: boolean;
  erreur: string | null;
};

// Le `parse` de l'éval NE contrôle PAS la langue : sinon il déclencherait la
// reprise de callStructured et l'échantillon vaudrait deux appels. Le schéma
// reste contrôlé — une sortie illisible fait une reprise ici comme en
// production, et c'est compté dans `attempts`.
function parseSansControle(outputText: string): { extraction: Extraction } | { problem: string } {
  let json: unknown;
  try {
    json = JSON.parse(outputText);
  } catch {
    return { problem: "JSON illisible" };
  }
  const parsed = extractionSchema.safeParse(json);
  if (!parsed.success) return { problem: parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join(" ; ") };
  return { extraction: parsed.data };
}

async function mesurer(offreId: string, condition: string, passe: number): Promise<Echantillon> {
  const offre = CORPUS.find((o) => o.id === offreId)!;
  const autorises = scriptsAutorises(offre.texte);
  const vide: Echantillon = {
    offre: offreId, condition, passe, fuites: [], nonLatinPresent: [],
    inputTokens: 0, outputTokens: 0, costEur: 0, latencyMs: -1, attempts: 0,
    schemaValidFirstTry: false, erreur: null,
  };
  try {
    const { value, usage } = await callStructured({
      instructions: CONDITIONS[condition],
      input: buildUserMessage(offre.texte),
      schemaName: "deal_analysis",
      schema: SCHEMA,
      parse: parseSansControle,
      options: OPTIONS,
    });
    const fuites = fuitesDeLExtraction(value.extraction, autorises);
    // Toute écriture non latine écrite par le modèle dans sa prose, autorisée
    // ou non : c'est ce chiffre qui dit si l'offre hébraïque est un vrai test.
    const nonLatinPresent = [
      ...new Set(fuitesDeLExtraction(value.extraction, new Set<ScriptNomme>()).flatMap((f) => f.scripts)),
    ].sort();
    return {
      ...vide, fuites, nonLatinPresent,
      inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costEur: usage.costEur,
      latencyMs: usage.latencyMs, attempts: usage.attempts, schemaValidFirstTry: usage.schemaValidFirstTry,
    };
  } catch (caught) {
    return { ...vide, erreur: caught instanceof Error ? caught.message : String(caught) };
  }
}

const pct = (x: number) => (Number.isNaN(x) ? "  n/a" : `${(x * 100).toFixed(2).padStart(5)} %`);

// ── LE PLAN ET SON COÛT, AVANT LE MOINDRE APPEL ─────────────────────────────

// Mesurés le 17/09/2026 et le 18/10/2026 sur de vraies passes de ce dépôt
// (evals/results/effort-*.json, verbosity-*.json) : une analyse d'offre tient
// dans ~2 100 jetons d'entrée et ~1 200 de sortie. Le prompt système a grossi
// depuis (7 725 caractères aujourd'hui) : on majore l'entrée.
const JETONS_ENTREE_ESTIMES = 3_600;
const JETONS_SORTIE_ESTIMES = 1_500;

const offres = CORPUS.length;
const conditions = Object.keys(CONDITIONS);
const appels = offres * conditions.length * PASSES;
const { input: prixEntree, output: prixSortie } = MODEL.pricingUsdPerMillion;
const coutUnitaireUsd = (JETONS_ENTREE_ESTIMES * prixEntree + JETONS_SORTIE_ESTIMES * prixSortie) / 1_000_000;
const totalUsd = coutUnitaireUsd * appels;
const totalEur = totalUsd / MODEL.usdPerEur;

// Une offre dont `attendu` ne correspond pas à son texte rendrait la mesure
// fausse dans le sens le plus coûteux : une fuite comptée comme légitime.
for (const offre of CORPUS) {
  const reel = [...new Set(scriptsNonLatins(offre.texte))].sort();
  const declare = [...offre.attendu].sort();
  if (JSON.stringify(reel) !== JSON.stringify(declare)) {
    throw new Error(`corpus ${offre.id} : écritures réelles [${reel}] ≠ déclarées [${declare}]`);
  }
}

console.log(`Modèle          : ${MODEL.id}  (effort ${MODEL.reasoningEffort ?? "non envoyé"}, verbosité ${MODEL.textVerbosity ?? "non envoyée"})`);
console.log(`Température     : AUCUNE n'est envoyée — valeur par défaut du fournisseur, pas zéro.`);
console.log(`Prompt système  : ${SYSTEM_PROMPT.length} car. (actuel) / ${CONDITIONS.tete.length} car. (consigne en tête)`);
console.log(`Schéma          : ${JSON.stringify(SCHEMA).length} car.`);
console.log(`Corpus          : ${offres} offres, toutes vérifiées contre leurs écritures déclarées`);
console.log("");
console.log("ESTIMATION DU COÛT, AVANT TOUT APPEL");
console.log(`  appels            ${offres} offres × ${conditions.length} conditions × ${PASSES} passes = ${appels}`);
console.log(`  jetons par appel  ~${JETONS_ENTREE_ESTIMES} en entrée, ~${JETONS_SORTIE_ESTIMES} en sortie (mesurés en éval, entrée majorée)`);
console.log(`  tarif             $${prixEntree}/M en entrée, $${prixSortie}/M en sortie`);
console.log(`  coût par appel    $${coutUnitaireUsd.toFixed(5)}`);
console.log(`  TOTAL ESTIMÉ      $${totalUsd.toFixed(2)}  =  ${totalEur.toFixed(2)} €   (plafond ${PLAFOND_EUR.toFixed(2)} €)`);
console.log("");

if (totalEur > PLAFOND_EUR) {
  console.log(`ARRÊT : ${totalEur.toFixed(2)} € dépasse le plafond de ${PLAFOND_EUR.toFixed(2)} €. Baisse --passes ou relève --plafond en connaissance de cause.`);
  process.exit(1);
}
if (!CONFIRM) {
  console.log("Aucun appel : relance avec --confirm.");
  process.exit(0);
}

// ── EXÉCUTION ───────────────────────────────────────────────────────────────

const travaux: { offre: string; condition: string; passe: number }[] = [];
for (let passe = 1; passe <= PASSES; passe++) {
  for (const offre of CORPUS) for (const condition of conditions) travaux.push({ offre: offre.id, condition, passe });
}

const echantillons: Echantillon[] = [];
let faits = 0;
let prochain = 0;

async function ouvrier() {
  while (prochain < travaux.length) {
    const t = travaux[prochain++];
    const e = await mesurer(t.offre, t.condition, t.passe);
    echantillons.push(e);
    faits++;
    const etat = e.erreur ? `ÉCHEC ${e.erreur}` : e.fuites.length ? `FUITE ${e.fuites.map((f) => `${f.champ}[${f.scripts}]`).join(" ")}` : "ok";
    console.log(`[${String(faits).padStart(3)}/${travaux.length}] ${t.offre.padEnd(22)} ${t.condition.padEnd(7)} p${String(t.passe).padStart(2)}  ${String(e.latencyMs).padStart(6)} ms  ${etat}`);
  }
}

await Promise.all(Array.from({ length: Math.max(1, PARALLELE) }, ouvrier));

// ── RÉSULTATS ───────────────────────────────────────────────────────────────

const { mkdirSync, writeFileSync } = await import("node:fs");
const path = await import("node:path");
const dossier = path.join(process.cwd(), "evals", "results");
mkdirSync(dossier, { recursive: true });
const fichier = path.join(dossier, `langue-${new Date().toISOString().replaceAll(":", "-").replace(".", "-")}.json`);

const reussis = echantillons.filter((e) => e.erreur === null);
const coutReel = echantillons.reduce((s, e) => s + e.costEur, 0);

function taux(sous: Echantillon[]) {
  const n = sous.filter((e) => e.erreur === null).length;
  const s = sous.filter((e) => e.erreur === null && e.fuites.length > 0).length;
  return { s, n, ...wilson(s, n) };
}

console.log("\n\n════ QUESTION 1 — À QUELLE FRÉQUENCE LA FUITE ARRIVE-T-ELLE, PROMPT ACTUEL ════\n");
const actuel = taux(echantillons.filter((e) => e.condition === "actuel"));
console.log(`  ${actuel.s} fuites sur ${actuel.n} appels   taux ${pct(actuel.taux)}   IC 95 % [${pct(actuel.bas)} ; ${pct(actuel.haut)}]`);
console.log("\n  Par offre (prompt actuel) :");
for (const offre of CORPUS) {
  const t = taux(echantillons.filter((e) => e.condition === "actuel" && e.offre === offre.id));
  const nonLatin = echantillons.filter((e) => e.condition === "actuel" && e.offre === offre.id && e.nonLatinPresent.length > 0).length;
  console.log(`    ${offre.id.padEnd(22)} ${String(t.s).padStart(3)}/${String(t.n).padEnd(3)} ${pct(t.taux)}  IC [${pct(t.bas)} ; ${pct(t.haut)}]   écriture non latine écrite : ${nonLatin}/${t.n}`);
}

console.log("\n════ QUESTION 2 — LA CONSIGNE EN TÊTE CHANGE-T-ELLE CE TAUX ? ════\n");
const tete = taux(echantillons.filter((e) => e.condition === "tete"));
console.log(`  actuel        ${String(actuel.s).padStart(3)}/${String(actuel.n).padEnd(3)}  ${pct(actuel.taux)}  IC 95 % [${pct(actuel.bas)} ; ${pct(actuel.haut)}]`);
console.log(`  en tête       ${String(tete.s).padStart(3)}/${String(tete.n).padEnd(3)}  ${pct(tete.taux)}  IC 95 % [${pct(tete.bas)} ; ${pct(tete.haut)}]`);
const ecart = newcombe({ s: actuel.s, n: actuel.n }, { s: tete.s, n: tete.n });
console.log(`  écart (actuel − tête) ${pct(ecart.diff)}   IC 95 % [${pct(ecart.bas)} ; ${pct(ecart.haut)}]  (Newcombe)`);
console.log(
  ecart.bas <= 0 && ecart.haut >= 0
    ? "\n  L'INTERVALLE DE L'ÉCART CONTIENT ZÉRO : cette éval NE PERMET PAS de distinguer les deux conditions.\n  Aucun gagnant n'est désigné."
    : "\n  L'intervalle de l'écart exclut zéro : la différence est mesurée.",
);

console.log("\n════ CE QUE L'ÉVAL A COÛTÉ ET CE QU'ELLE A VU D'AUTRE ════\n");
console.log(`  appels réussis       ${reussis.length}/${echantillons.length}`);
console.log(`  coût RÉEL            ${coutReel.toFixed(4)} €   (estimé ${totalEur.toFixed(2)} €)`);
if (reussis.length > 0) {
  const entree = Math.round(reussis.reduce((s, e) => s + e.inputTokens, 0) / reussis.length);
  const sortie = Math.round(reussis.reduce((s, e) => s + e.outputTokens, 0) / reussis.length);
  const latences = reussis.map((e) => e.latencyMs).sort((a, b) => a - b);
  console.log(`  jetons moyens        ${entree} en entrée, ${sortie} en sortie`);
  console.log(`  latence p50 / p95    ${latences[Math.floor(latences.length * 0.5)]} ms / ${latences[Math.floor(latences.length * 0.95)]} ms`);
  console.log(`  schéma bon du 1er coup ${reussis.filter((e) => e.schemaValidFirstTry).length}/${reussis.length}`);
}
const champs = new Map<string, number>();
for (const e of echantillons) for (const f of e.fuites) champs.set(f.champ, (champs.get(f.champ) ?? 0) + 1);
if (champs.size > 0) {
  console.log("  champs fautifs       " + [...champs].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c}×${n}`).join(", "));
  const scripts = new Map<string, number>();
  for (const e of echantillons) for (const f of e.fuites) for (const s of f.scripts) scripts.set(s, (scripts.get(s) ?? 0) + 1);
  console.log("  écritures fautives   " + [...scripts].sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s}×${n}`).join(", "));
}
const echecs = echantillons.filter((e) => e.erreur !== null);
if (echecs.length > 0) {
  const parErreur = new Map<string, number>();
  for (const e of echecs) parErreur.set(e.erreur!, (parErreur.get(e.erreur!) ?? 0) + 1);
  console.log("  échecs               " + [...parErreur].map(([m, n]) => `${n}× ${m}`).join(" | "));
}

writeFileSync(
  fichier,
  JSON.stringify(
    {
      modele: MODEL.id,
      temperature: "non envoyée",
      promptVersionActuel: SYSTEM_PROMPT.length,
      promptVersionTete: CONDITIONS.tete.length,
      passes: PASSES,
      corpus: CORPUS.map((o) => ({ id: o.id, role: o.role, attendu: o.attendu })),
      coutEstimeEur: totalEur,
      coutReelEur: coutReel,
      resume: { actuel, tete, ecart },
      echantillons,
    },
    null,
    1,
  ),
  "utf8",
);
console.log(`\nÉcrit : ${path.relative(process.cwd(), fichier)}`);
