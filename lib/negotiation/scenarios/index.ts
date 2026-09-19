import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { composeAnalysis } from "@/lib/analysis/compose";
import type { Extraction } from "@/lib/llm/prompt";
import { processTurn, type TurnContext, type TurnResult } from "@/lib/negotiation/turn";
import { turnReadingSchema, type Deal, type TurnReading } from "@/lib/negotiation/types";
import type { Tier } from "@/lib/rates/tier";
import type { Analysis } from "@/lib/schema";

// Mission #080, F8 — scénarios de réponses de marque, un fichier JSON par
// scénario dans ce dossier. Voir README.md pour en ajouter un ou remplacer un
// scénario inventé par un échange réel.
//
// Chaque scénario contient la réponse de la marque, la sortie du modèle pour
// cette réponse (inventée, ou enregistrée par `pnpm negociation:enregistrer`),
// et ce qui est attendu. Les tests (tests/negotiation-scenarios.test.tsx) font
// tourner le CODE sur cette sortie : vérification des citations, termes,
// chiffrage, message, conclusion. Ils n'appellent jamais le modèle.

export const SCENARIOS_DIR = path.join(process.cwd(), "lib", "negotiation", "scenarios");

type DealPatch = Partial<Omit<Deal, "usage" | "exclusivity" | "payment">> & {
  usage?: Partial<Deal["usage"]>;
  exclusivity?: Partial<Deal["exclusivity"]>;
  payment?: Partial<Deal["payment"]>;
};

export type Scenario = {
  id: string;
  titre: string;
  // « inventé » : écrit à la main. « réel » : un vrai échange, anonymisé.
  // « garde » : sortie du modèle écrite À LA MAIN pour tester le code face à
  // un modèle qui dérape ; jamais réenregistrée (mission #080 quater, C1).
  source: "inventé" | "réel" | "garde";
  // Offre de départ : lib/fixtures/<offre>.json (extraction du modèle).
  offre: string;
  niveau: Tier;
  reponse_marque: string;
  // Sortie du modèle. « deal » peut n'être qu'un correctif de l'offre de
  // départ (scénario inventé) ; une sortie enregistrée le contient en entier.
  sortie_modele: Omit<TurnReading, "deal" | "global_agreement"> & { deal?: DealPatch; global_agreement?: string | null };
  attendu: {
    type: "tour" | "hors_sujet";
    issue?: TurnReading["outcome"];
    // true : un terme a changé, le chiffrage est refait (ancien et nouveau).
    nouveau_chiffrage?: boolean;
    conclusion?: boolean;
    // true : le brouillon du modèle doit être écarté par les contrôles.
    message_de_repli?: boolean;
    // Statut attendu de certaines demandes après ce tour.
    demandes?: Record<string, "granted" | "refused" | "countered" | "unanswered">;
    // Groupes de termes qui doivent changer (et eux seuls).
    termes_changes?: string[];
    // Au moins un doute doit être affiché.
    doutes?: boolean;
    // Valeurs qui ne doivent figurer nulle part dans les termes retenus
    // (mission #080 quater : ce que la marque n'a pas écrit).
    valeurs_interdites?: string[];
    // Demandes restées sans réponse explicite, dont un terme prouvé a changé
    // dans leur sens (mission #080 quinquies, C).
    alignees?: string[];
  };
};

export function loadScenarios(dir: string = SCENARIOS_DIR): Scenario[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => JSON.parse(readFileSync(path.join(dir, name), "utf8")) as Scenario);
}

export function baseAnalysis(offre: string, tier: Tier): Analysis {
  const extraction = JSON.parse(readFileSync(path.join(process.cwd(), "lib", "fixtures", `${offre}.json`), "utf8")) as Extraction;
  return composeAnalysis(extraction, { tier });
}

function patchDeal(base: Deal, patch: DealPatch = {}): Deal {
  return {
    ...base,
    ...patch,
    usage: { ...base.usage, ...patch.usage },
    exclusivity: { ...base.exclusivity, ...patch.exclusivity },
    payment: { ...base.payment, ...patch.payment },
  };
}

// Sortie du modèle complète et validée par le schéma du modèle : un scénario
// mal écrit échoue ici, comme une vraie sortie invalide.
export function readingOf(scenario: Scenario, original: Pick<Analysis, "deal">): TurnReading {
  const { deal, ...rest } = scenario.sortie_modele;
  // global_agreement absent (scénario écrit avant la mission #080 quater) : aucun.
  return turnReadingSchema.parse({ global_agreement: null, ...rest, deal: patchDeal(original.deal, deal) });
}

export function scenarioContext(scenario: Scenario): TurnContext {
  const original = baseAnalysis(scenario.offre, scenario.niveau);
  return { original, previous: [], turnNumber: 2, tier: scenario.niveau, brandReply: scenario.reponse_marque };
}

export function runScenario(scenario: Scenario): { context: TurnContext; result: TurnResult } {
  const context = scenarioContext(scenario);
  return { context, result: processTurn(context, readingOf(scenario, context.original)) };
}
