import { describe, expect, it } from "vitest";
import { NEGOTIATION_EXCHANGES } from "@/lib/content/vocabulaire";
import {
  limitRule,
  limitVerdict,
  OPENINGS_ACCOUNT,
  OPENINGS_ANON,
  type LimitedAction,
  type Requester,
} from "@/lib/security/limite";

// Mission #102, partie B — le filet horaire ne doit pas casser une négociation
// normale.
//
// Rejeu du test mobile du 23/09/2026 : une analyse, deux échanges avec la
// marque, puis deux analyses par capture — et le produit refusait la suite en
// annonçant « 5 analyses en une heure ». Un échange était compté comme une
// analyse.

const IP = "203.0.113.7";
const anonyme: Requester = { userId: null, ip: IP };
const abonnee: Requester = { userId: "user-pro-1", ip: IP };

// Le compteur atomique (usage_guard), simulé : une clé, un compte, une limite.
function compteur() {
  const counts = new Map<string, number>();
  return {
    hit(rule: ReturnType<typeof limitRule>) {
      if (rule === null) return null;
      const count = (counts.get(rule.key) ?? 0) + 1;
      counts.set(rule.key, count);
      return { allowed: count <= rule.limit, retryInMinutes: 47 };
    },
    count: (key: string) => counts.get(key) ?? 0,
  };
}

// Une action, de bout en bout : la règle, le compteur, puis le verdict.
function run(compte: ReturnType<typeof compteur>, action: LimitedAction, requester: Requester) {
  const rule = limitRule(action, requester);
  return { rule, verdict: limitVerdict(rule, compte.hit(rule)) };
}

// Une négociation entière, dans l'ordre : l'analyse, les échanges, la conclusion.
const NEGOCIATION: LimitedAction[] = ["ouverture", ...Array.from({ length: NEGOTIATION_EXCHANGES }, () => "echange" as const), "conclusion"];

describe("une négociation complète n'est jamais bloquée", () => {
  it("1. analyse, 4 échanges et conclusion d'affilée : un seul passage compté, quel que soit le plan", () => {
    for (const requester of [anonyme, abonnee]) {
      const compte = compteur();
      const verdicts = NEGOCIATION.map((action) => run(compte, action, requester).verdict);

      expect(verdicts.every((verdict) => verdict.allowed)).toBe(true);
      // Un seul de ces six passages est compté : celui qui OUVRE.
      expect(verdicts.filter((verdict) => verdict.allowed && verdict.counted)).toHaveLength(1);
      expect(NEGOCIATION).toHaveLength(NEGOTIATION_EXCHANGES + 2);
    }
  });

  it("2. l'abonnée enchaîne ses négociations : aucune n'est arrêtée au milieu", () => {
    const compte = compteur();
    // Autant de négociations complètes qu'elle peut en ouvrir dans l'heure.
    for (let index = 0; index < OPENINGS_ACCOUNT; index += 1) {
      for (const action of NEGOCIATION) expect(run(compte, action, abonnee).verdict.allowed).toBe(true);
    }
    // Ce sont bien les ouvertures, et elles seules, qui ont été comptées.
    expect(compte.count(`negociation:compte:${abonnee.userId}`)).toBe(OPENINGS_ACCOUNT);
  });

  it("3. un échange ne compte jamais, même présenté seul", () => {
    expect(limitRule("echange", anonyme)).toBeNull();
    expect(limitRule("conclusion", abonnee)).toBeNull();
    // Rien à interroger, donc rien à rendre en cas d'échec : le brouillon collé
    // n'est jamais perdu pour un refus de filet qui n'existe plus.
    expect(limitVerdict(null, null)).toEqual({ allowed: true, counted: false });
  });
});

describe("le filet reste strict sur ce qui ouvre", () => {
  it("4. sixième ouverture en une heure par un anonyme : bloquée, et rien n'est consommé", () => {
    const compte = compteur();
    for (let index = 0; index < OPENINGS_ANON; index += 1) {
      expect(run(compte, "ouverture", anonyme).verdict).toEqual({ allowed: true, counted: true });
    }
    const refus = run(compte, "ouverture", anonyme).verdict;
    expect(refus.allowed).toBe(false);
    if (refus.allowed) throw new Error("refus attendu");
    expect(refus.reason).toBe("trop_d_ouvertures");
    // Le message dit ce qui est bloqué, et jusqu'à quand.
    expect(refus.message).toContain("négociations");
    expect(refus.message).toContain("47 min");
    expect(refus.message).not.toMatch(/crédit|analyses en une heure/);
  });

  it("5. le refus porte sur l'ouverture : les négociations déjà ouvertes continuent", () => {
    const compte = compteur();
    for (let index = 0; index <= OPENINGS_ANON; index += 1) run(compte, "ouverture", anonyme);
    // Le filet est saturé pour ce visiteur…
    expect(run(compte, "ouverture", anonyme).verdict.allowed).toBe(false);
    // …et ses échanges en cours passent quand même.
    expect(run(compte, "echange", anonyme).verdict).toEqual({ allowed: true, counted: false });
    expect(run(compte, "conclusion", anonyme).verdict).toEqual({ allowed: true, counted: false });
  });
});

describe("un utilisateur n'est pas bloqué par l'activité d'un autre", () => {
  it("6. deux comptes derrière la même adresse : chacun son compteur", () => {
    const compte = compteur();
    const premiere: Requester = { userId: "user-a", ip: IP };
    const seconde: Requester = { userId: "user-b", ip: IP };

    // La première sature son propre compteur.
    for (let index = 0; index <= OPENINGS_ACCOUNT; index += 1) run(compte, "ouverture", premiere);
    expect(run(compte, "ouverture", premiere).verdict.allowed).toBe(false);

    // La seconde, sur le même wifi, n'a rien fait : elle passe.
    expect(run(compte, "ouverture", seconde).verdict).toEqual({ allowed: true, counted: true });
    expect(limitRule("ouverture", premiere)?.key).not.toBe(limitRule("ouverture", seconde)?.key);
    expect(limitRule("ouverture", premiere)?.scope).toBe("compte");
  });

  it("7. sans compte, c'est l'adresse qui sert de repère, et la limite est plus stricte", () => {
    expect(limitRule("ouverture", anonyme)).toEqual({ scope: "adresse", key: IP, limit: OPENINGS_ANON, windowSeconds: 3600 });
    expect(OPENINGS_ANON).toBeLessThan(OPENINGS_ACCOUNT);
  });

  it("8. compteur non interrogé alors qu'une règle existait : on laisse passer plutôt que de bloquer à l'aveugle", () => {
    expect(limitVerdict(limitRule("ouverture", abonnee), null)).toEqual({ allowed: true, counted: false });
  });
});
