import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { feedbackInputSchema } from "@/lib/analysis/feedback-schema";

// Mission #137 — CE QUE LE NAVIGATEUR TÉLÉCHARGE AVANT D'ÊTRE UTILE.
//
// Mesuré en #134, téléphone 4G, processeur bridé ×4, cache vide : l'accueil
// mettait 2 312 ms à afficher quoi que ce soit et bloquait le fil principal
// 3 348 ms. Le serveur n'y était pour rien (44 à 120 ms, cache edge). Deux
// bibliothèques pesaient pour rien dans le paquet de CHAQUE page :
//
//   zod ....... 390,3 ko décodés, y compris sur /tarifs qui n'en a aucun usage
//   posthog ... 290,2 ko décodés, pour une mesure qui démarrait à 6 642 ms
//
// LA CAUSE DE ZOD N'ÉTAIT PAS CELLE QU'ON CROYAIT. Aucun composant du
// navigateur n'a jamais appelé `safeParse` : la validation vit côté serveur,
// elle n'a jamais bougé. zod entrait par UNE ligne — lib/content/vocabulaire.ts
// importait la constante `LAST_TURN` depuis lib/negotiation/types.ts, où les
// constantes cohabitaient avec les schémas. Un import de valeur embarque tout
// le module.
//
// Ce fichier garde les deux portes fermées.

const RACINE = process.cwd();

function fichiersDe(dossier: string): string[] {
  const sorties: string[] = [];
  for (const entree of readdirSync(dossier, { withFileTypes: true })) {
    if (entree.name === "node_modules" || entree.name === ".next") continue;
    const p = path.join(dossier, entree.name);
    if (entree.isDirectory()) sorties.push(...fichiersDe(p));
    else if (/\.tsx?$/.test(entree.name)) sorties.push(p);
  }
  return sorties;
}

function resoudre(spec: string, depuis: string): string | null {
  if (!spec.startsWith("@/") && !spec.startsWith(".")) return null;
  const base = spec.startsWith("@/") ? path.join(RACINE, spec.slice(2)) : path.resolve(path.dirname(depuis), spec);
  for (const suffixe of [".ts", ".tsx", "/index.ts", "/index.tsx", ""]) {
    const candidat = base + suffixe;
    try {
      if (statSync(candidat).isFile()) return candidat;
    } catch {
      // pas ce suffixe
    }
  }
  return null;
}

// Les imports de VALEUR seulement : `import type` est effacé à la compilation
// et ne fait entrer aucun octet dans le navigateur.
function importsDeValeur(source: string): string[] {
  const sorties: string[] = [];
  const re = /import\s+(type\s+)?([^;]*?)\s*from\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    if (m[1]) continue;
    const accolades = m[2].match(/\{([^}]*)\}/);
    if (accolades) {
      const noms = accolades[1].split(",").map((n) => n.trim()).filter(Boolean);
      const valeurs = noms.filter((n) => !n.startsWith("type "));
      const reste = m[2].replace(/\{[^}]*\}/, "").replace(/,/g, "").trim();
      if (valeurs.length === 0 && reste === "") continue;
    }
    sorties.push(m[3]);
  }
  return sorties;
}

// Un module « use server » n'est jamais envoyé au navigateur : Next n'en
// transmet qu'une référence. On ne le suit donc pas.
function cheminVers(paquet: string, fichier: string, pile: string[] = [], vus = new Set<string>()): string[] | null {
  if (vus.has(fichier)) return null;
  vus.add(fichier);
  let source: string;
  try {
    source = readFileSync(fichier, "utf8");
  } catch {
    return null;
  }
  if (pile.length > 0 && /^["']use server["']/.test(source.trimStart())) return null;
  for (const spec of importsDeValeur(source)) {
    if (spec === paquet) return [...pile, fichier, paquet];
    const cible = resoudre(spec, fichier);
    if (!cible) continue;
    const trouve = cheminVers(paquet, cible, [...pile, fichier], vus);
    if (trouve) return trouve;
  }
  return null;
}

const CLIENTS = [...fichiersDe(path.join(RACINE, "components")), ...fichiersDe(path.join(RACINE, "app"))].filter((f) =>
  /^["']use client["']/.test(readFileSync(f, "utf8").trimStart()),
);

const court = (chemin: string[]) => chemin.map((p) => p.replace(RACINE + path.sep, "").replace(/\\/g, "/")).join(" -> ");

// ───────────────────────────────────────────────────────────────────────────
describe("ce que le navigateur n'a pas à télécharger", () => {
  it("il y a bien des composants clients à inspecter", () => {
    expect(CLIENTS.length).toBeGreaterThan(20);
  });

  it("aucun module du navigateur n'atteint zod", () => {
    const chemins = CLIENTS.map((c) => cheminVers("zod", c)).filter((c): c is string[] => c !== null);
    expect(chemins.map(court)).toEqual([]);
  });

  it("aucun module du navigateur n'atteint posthog-js, et la dépendance n'existe plus", () => {
    // Mission #142 — il n'est plus différé, il est RETIRÉ : ~380 ms de
    // blocage et 96,7 ko sur chaque page, pour une mesure que personne ne
    // lisait. La règle du projet depuis #103 est « on lit /admin, jamais
    // PostHog ».
    const chemins = CLIENTS.map((c) => cheminVers("posthog-js", c)).filter((c): c is string[] => c !== null);
    expect(chemins.map(court)).toEqual([]);
    const paquet = JSON.parse(readFileSync(path.join(RACINE, "package.json"), "utf8"));
    expect({ ...paquet.dependencies, ...paquet.devDependencies }).not.toHaveProperty("posthog-js");
  });

  it("les trois modules partagés par l'écran n'ont aucune dépendance", () => {
    // C'est leur raison d'être : une seule ligne d'import suffisait à faire
    // entrer 390 ko sur toutes les pages.
    for (const fichier of [
      "lib/negotiation/libelles.ts",
      "lib/analysis/feedback-options.ts",
    ]) {
      const source = readFileSync(path.join(RACINE, fichier), "utf8");
      expect(importsDeValeur(source), fichier).toEqual([]);
      expect(source, fichier).not.toContain('from "zod"');
    }
    // vocabulaire.ts garde des imports, mais aucun qui mène à un schéma.
    expect(cheminVers("zod", path.join(RACINE, "lib/content/vocabulaire.ts"))).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("la validation n'a pas disparu avec zod", () => {
  // Elle n'a jamais eu lieu dans le navigateur : les deux composants cités
  // lisent `response.json()` et n'en gardent que `error`. Le schéma, lui, est
  // appliqué par le serveur, et il l'est toujours.
  it("un corps malformé est refusé, champ par champ", () => {
    for (const malformé of [
      null,
      {},
      { rating: "excellent", tier: "starter" },
      { rating: "fair" },
      { rating: "fair", tier: "patron" },
      { rating: "fair", tier: "starter", comment: "x".repeat(201) },
      { rating: "fair", tier: "starter", turn: 1 },
      { rating: "fair", tier: "starter", turn: 9 },
      { rating: "fair", tier: "starter", turn: 2.5 },
    ]) {
      expect(feedbackInputSchema.safeParse(malformé).success, JSON.stringify(malformé)).toBe(false);
    }
  });

  it("un corps valide passe, et il est normalisé", () => {
    const ok = feedbackInputSchema.safeParse({ rating: "fair", tier: "starter", comment: "  trop bas  " });
    expect(ok.success).toBe(true);
    expect(ok.success && ok.data).toMatchObject({ rating: "fair", tier: "starter", comment: "trop bas", turn: 0 });
  });

  it("la route de l'avis refuse avant d'écrire quoi que ce soit", () => {
    const source = readFileSync(path.join(RACINE, "app/api/analyses/[id]/avis/route.ts"), "utf8");
    expect(source).toContain("feedbackInputSchema.safeParse(body)");
    // Le refus vient AVANT toute lecture de l'analyse et toute écriture.
    expect(source.indexOf("if (!input.success) return json(400")).toBeLessThan(source.indexOf("await loadResultForViewer"));
  });
});
