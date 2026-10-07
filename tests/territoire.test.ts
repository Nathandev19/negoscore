import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { knownTerms, missingTermKeys } from "@/lib/analysis/evaluability";
import { FAQ } from "@/lib/content/home";
import { normalizeDeal } from "@/lib/analysis/normalize";
import { applyGroups } from "@/lib/negotiation/terms";
import { computeEstimate, isWorldwide } from "@/lib/rates/engine";
import fr20263 from "@/lib/rates/fr-2026.3.json";
import fr20264 from "@/lib/rates/fr-2026.4.json";
import { CURRENT_RATE_TABLE, CURRENT_RATE_VERSION, rateTable } from "@/lib/rates/tables";
import { allZones, billableZones, HOME_ZONE, reachesWorld, requestedZones, ZONE_LABEL, zonesTotal, zoneRate } from "@/lib/rates/zones";
import sample from "@/lib/fixtures/sample-extraction.json";
import { analysisSchema, type Analysis } from "@/lib/schema";

// Mission #160 — LE TERRITOIRE : DES ZONES, PAS UN INTERRUPTEUR.
//
// Avant, le moteur n'avait qu'un interrupteur « monde », déclenché par une
// expression régulière sur le TEXTE LIBRE de l'offre :
//   /monde|world|international|global|tous (les )?(pays|territoires)/i
// « France, Belgique et Suisse » n'y correspond pas. L'offre coûtait +0 %.
// Ce n'était pas un barème trop bas : c'était une règle absente.
//
// Et une expression régulière sur le texte brut n'est pas une extraction. Le
// modèle sort désormais des ZONES typées (usage.territory_zones), la table les
// chiffre, le moteur les additionne — « le modèle extrait, le code chiffre ».

type Deal = Analysis["deal"];

function deal(part: Partial<Deal> = {}): Deal {
  return normalizeDeal({
    brand: null,
    deliverables: [{ type: "video", platform: "tiktok", quantity: 1, format: null }],
    publication_required: true,
    usage: { organic: true, paid_ads: true, whitelisting: false, spark_ads: false, perpetual: false, duration_months: 6, territory: null, territory_zones: [] },
    exclusivity: { present: false, duration_months: null, category: null },
    raw_footage: false,
    ip_transfer: "license",
    ai_training_rights: "absent",
    revisions: { count: null, unlimited: false },
    payment: { amount_eur: null, currency: "EUR", terms_days: null, schedule: null },
    in_kind_value_eur: null,
    deadlines: [],
    kill_fee: null,
    termination: null,
    governing_law: null,
    ...part,
  } as Deal);
}

// Trois vidéos plutôt qu'une : à une seule vidéo au niveau « Je débute », une
// majoration de +5 % disparaît dans l'arrondi à la dizaine, et le test ne
// prouverait rien.
const avecZones = (texte: string | null, zones: string[]) =>
  deal({
    deliverables: [{ type: "video", platform: "tiktok", quantity: 3, format: null }],
    usage: { organic: true, paid_ads: true, whitelisting: false, spark_ads: false, perpetual: false, duration_months: 6, territory: texte, territory_zones: zones } as Deal["usage"],
  });

const lignesTerritoire = (d: Deal) => computeEstimate(d, { tier: "starter" }).lines.filter((l) => l.topic === "territory");
const total = (d: Deal): [number, number] => {
  const e = computeEstimate(d, { tier: "starter" });
  // Tous les cas de ce fichier sont chiffrables : un total nul serait un
  // changement de comportement, pas une valeur à tolérer.
  expect(e.total_low).not.toBeNull();
  expect(e.total_high).not.toBeNull();
  return [e.total_low as number, e.total_high as number];
};

// ───────────────────────────────────────────────────────────────────────────
describe("la liste des zones est fermée, et elle vit dans la table", () => {
  it("les cinq zones sont dans la table de tarifs, pas dans le code", () => {
    const source = readFileSync("lib/rates/zones.ts", "utf8");
    expect(allZones()).toEqual(["france", "europe_francophone", "europe", "amerique_nord", "reste_du_monde"]);
    // Le fichier de code ne porte que des LIBELLÉS : aucune valeur chiffrée.
    expect(source).not.toMatch(/low:\s*0?\.\d/);
    for (const zone of allZones()) {
      expect(zoneRate(zone), zone).toEqual(expect.objectContaining({ low: expect.any(Number), high: expect.any(Number) }));
      // Une ligne sans nom ne se conteste pas : chaque zone a son libellé.
      expect(ZONE_LABEL[zone], zone).toBeTruthy();
    }
  });

  it("la France est incluse à +0, et ne se facture pas", () => {
    expect(HOME_ZONE).toBe("france");
    expect(zoneRate("france")).toEqual({ low: 0, high: 0, confidence: "low" });
    expect(billableZones()).not.toContain("france");
    // Une offre « France seulement » ne paie rien de plus, et n'affiche aucune ligne.
    expect(lignesTerritoire(avecZones("France", ["france"]))).toEqual([]);
  });

  it("la confiance de la nouvelle règle est la plus basse, tant que personne ne l'a confirmée", () => {
    for (const zone of allZones()) {
      expect((CURRENT_RATE_TABLE.territory_zones as Record<string, { confidence: string }>)[zone].confidence, zone).toBe("low");
    }
    expect(fr20264.source_notes.territory_zones).toMatch(/recalibrer/i);
  });

  it("une zone inconnue n'ajoute rien et ne fait rien échouer", () => {
    for (const hostile of ["__proto__", "constructor", "toString", "mars", "", "FRANCE "]) {
      expect(requestedZones([hostile]), hostile).toEqual([]);
      const sujet = avecZones("quelque part", [hostile]);
      expect(() => computeEstimate(sujet, { tier: "starter" }), hostile).not.toThrow();
      expect(lignesTerritoire(sujet), hostile).toEqual([]);
    }
    // Et une zone inconnue au milieu de zones connues laisse passer les connues.
    expect(requestedZones(["europe", "mars", "france"])).toEqual(["europe"]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("les formulations qui passaient à +0 % sont chiffrées", () => {
  // Les trois formulations relevées à l'étape 0 : aucune ne contient un mot
  // que l'expression régulière cherchait, donc aucune ne coûtait quoi que ce
  // soit. Ce sont les zones extraites qui les chiffrent désormais.
  const CAS: Array<{ texte: string; zones: string[]; attendues: string[] }> = [
    { texte: "France, Belgique et Suisse", zones: ["france", "europe_francophone"], attendues: ["europe_francophone"] },
    { texte: "toute l'Europe", zones: ["france", "europe_francophone", "europe"], attendues: ["europe_francophone", "europe"] },
    { texte: "France, États-Unis et Canada", zones: ["france", "amerique_nord"], attendues: ["amerique_nord"] },
  ];

  it.each(CAS)("« $texte » : l'expression régulière la rate, les zones la chiffrent", ({ texte, zones, attendues }) => {
    // 1. L'interrupteur d'avant ne voit rien.
    expect(isWorldwide(texte)).toBe(false);
    // 2. Sans zones — c'est-à-dire comme avant cette mission — le territoire
    //    ne coûte rien. C'est le défaut, reproduit.
    const avant = avecZones(texte, []);
    expect(lignesTerritoire(avant)).toEqual([]);
    // 3. Avec les zones extraites, chaque zone a SA ligne, nommée.
    const apres = avecZones(texte, zones);
    expect(lignesTerritoire(apres).map((l) => l.label)).toEqual(attendues.map((z) => `Diffusion ${ZONE_LABEL[z]}`));
    // 4. Et ça coûte réellement quelque chose de plus.
    expect(total(apres)[0]).toBeGreaterThan(total(avant)[0]);
    expect(total(apres)[1]).toBeGreaterThan(total(avant)[1]);
  });

  it("chaque ligne porte son impact en euros : une créatrice sait laquelle discuter", () => {
    const lignes = lignesTerritoire(avecZones("France, Belgique, Allemagne", ["france", "europe_francophone", "europe"]));
    expect(lignes).toHaveLength(2);
    for (const ligne of lignes) {
      expect(ligne.type).toBe("percent");
      expect(ligne.eur_low).toBeGreaterThanOrEqual(0);
      expect(ligne.label).toMatch(/^Diffusion /);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("le plafond de cohérence : le monde est le plafond du territoire", () => {
  const combinaisons = (): string[][] => {
    const zones = billableZones();
    const out: string[][] = [];
    for (let masque = 1; masque < 1 << zones.length; masque++) {
      out.push(zones.filter((_, i) => masque & (1 << i)));
    }
    return out;
  };

  it("sur TOUTES les combinaisons, la somme des zones ne dépasse jamais le mondial", () => {
    const monde = CURRENT_RATE_TABLE.multipliers.territory_worldwide;
    const toutes = combinaisons();
    expect(toutes).toHaveLength(15);
    for (const zones of toutes) {
      const somme = zonesTotal(zones);
      expect(somme.low, zones.join("+")).toBeLessThanOrEqual(monde.low + 1e-9);
      expect(somme.high, zones.join("+")).toBeLessThanOrEqual(monde.high + 1e-9);
    }
  });

  it("aucune combinaison ne coûte plus cher que « monde entier »", () => {
    const monde = total(avecZones("monde entier", []));
    for (const zones of combinaisons()) {
      const sujet = total(avecZones("plusieurs pays", zones));
      expect(sujet[0], zones.join("+")).toBeLessThanOrEqual(monde[0]);
      expect(sujet[1], zones.join("+")).toBeLessThanOrEqual(monde[1]);
    }
  });

  // Le texte ne doit surtout PAS déclencher l'interrupteur « monde » : sinon
  // ce test passerait par l'autre branche et ne prouverait rien du plafond.
  it("les quatre zones ensemble SONT le monde, et c'est « Diffusion mondiale » qui s'affiche", () => {
    const texte = "France, Belgique, Allemagne, Canada et Brésil";
    expect(isWorldwide(texte)).toBe(false);
    const toutes = avecZones(texte, billableZones());
    expect(reachesWorld(billableZones())).toBe(true);
    expect(lignesTerritoire(toutes).map((l) => l.label)).toEqual(["Diffusion mondiale"]);
    expect(total(toutes)).toEqual(total(avecZones("monde entier", [])));
    // Et les quatre zones somment EXACTEMENT au mondial : le plafond est
    // structurel, pas un rattrapage. (Comparaison à 1e-9 près : additionner
    // quatre décimaux en virgule flottante donne 0,30000000000000004.)
    const monde = CURRENT_RATE_TABLE.multipliers.territory_worldwide;
    const somme = zonesTotal(billableZones());
    expect(somme.low).toBeCloseTo(monde.low, 9);
    expect(somme.high).toBeCloseTo(monde.high, 9);
  });

  it("l'interrupteur « monde » garde la main : un texte mondial reste chiffré comme avant", () => {
    for (const texte of ["monde entier", "worldwide", "international", "tous pays", "diffusion globale"]) {
      expect(isWorldwide(texte), texte).toBe(true);
      expect(lignesTerritoire(avecZones(texte, ["france"])).map((l) => l.label), texte).toEqual(["Diffusion mondiale"]);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("ce qui ne doit pas bouger n'a pas bougé", () => {
  // Mission #160 — LA PREUVE, pas le raisonnement. fr-2026.4 est comparée
  // champ par champ à fr-2026.3 : une seule différence autorisée, le bloc des
  // zones. Si quelqu'un touche un tarif en passant, ce test tombe.
  it("fr-2026.4 = fr-2026.3 + les zones, et rien d'autre", () => {
    const strip = (table: Record<string, unknown>) => {
      const { version, source_notes: notes, territory_zones: zones, ...rest } = table;
      expect([version, notes]).toHaveLength(2);
      return { ...rest, zones: zones ?? null };
    };
    const quatre = strip(fr20264 as unknown as Record<string, unknown>);
    const trois = strip(fr20263 as unknown as Record<string, unknown>);
    expect({ ...quatre, zones: null }).toEqual({ ...trois, zones: null });
    // La seule nouveauté : le bloc des zones, absent de fr-2026.3.
    expect(trois.zones).toBeNull();
    expect(quatre.zones).not.toBeNull();
    // Et les notes de source gagnent une entrée, sans en perdre aucune.
    for (const cle of Object.keys(fr20263.source_notes)) {
      expect(fr20264.source_notes, cle).toHaveProperty(cle);
    }
  });

  it("une analyse faite en fr-2026.3 se recalcule au centime près avec sa table", () => {
    const sujet = avecZones("monde entier", []);
    const ancienne = rateTable("fr-2026.3")!;
    const avant = computeEstimate(sujet, { tier: "starter", table: ancienne });
    const maintenant = computeEstimate(sujet, { tier: "starter" });
    expect([avant.total_low, avant.total_high]).toEqual([maintenant.total_low, maintenant.total_high]);
    expect(avant.rate_table_version).toBe("fr-2026.3");
    expect(maintenant.rate_table_version).toBe(CURRENT_RATE_VERSION);
  });

  // Les quatre fourchettes verrouillées, recalculées DEUX FOIS : avec la table
  // de l'analyse d'hier (fr-2026.3) et avec celle d'aujourd'hui. Deux d'entre
  // elles mentionnent un territoire (« monde entier »), deux n'en mentionnent
  // aucun — toutes les quatre doivent rendre le même nombre.
  // Les quatre fourchettes sont reconstruites EXACTEMENT comme dans
  // tests/arrondi-fourchette.test.ts : même base (la fixture publique), même
  // socle « aucun droit », mêmes plateformes — les stories et les photos sont
  // sur Instagram, ce qui déclenche la majoration multi-plateforme. Les
  // recopier autrement aurait prouvé autre chose.
  const BASE = analysisSchema.shape.deal.parse((sample as { deal: unknown }).deal);
  const NO_RIGHTS = {
    usage: { organic: true, paid_ads: false, whitelisting: false, spark_ads: false, perpetual: false, duration_months: null, territory: null },
    exclusivity: { present: false, duration_months: null, category: null },
    raw_footage: false,
    ip_transfer: "none" as const,
    ai_training_rights: "absent" as const,
  };
  const verrou = (patch: Partial<Deal>): Deal => ({ ...BASE, ...NO_RIGHTS, ...patch } as Deal);
  const video = (quantity: number) => ({ type: "video" as const, platform: "tiktok" as const, quantity, format: null });
  const story = (quantity: number) => ({ type: "story" as const, platform: "instagram" as const, quantity, format: null });
  const photo = (quantity: number) => ({ type: "photo" as const, platform: "instagram" as const, quantity, format: null });

  const lot = verrou({
    deliverables: [video(1), story(3), photo(3)],
    usage: { organic: true, paid_ads: false, whitelisting: true, spark_ads: false, perpetual: false, duration_months: 3, territory: "monde entier" },
  });

  const VERROUILLEES: Array<{ nom: string; deal: Deal; tier: "starter" | "experienced"; attendu: [number, number]; territoire: boolean }> = [
    {
      nom: "2 vidéos, « C'est mon métier », aucun droit cédé",
      deal: verrou({ deliverables: [video(2)] }),
      tier: "experienced",
      attendu: [1000, 1600],
      territoire: false,
    },
    { nom: "1 vidéo, 3 stories, 3 photos, whitelisting 3 mois, monde entier", deal: lot, tier: "starter", attendu: [540, 1190], territoire: true },
    { nom: "le même lot au niveau expérimenté", deal: lot, tier: "experienced", attendu: [2700, 5280], territoire: true },
    {
      nom: "4 vidéos, 6 stories, 1 photo, whitelisting 3 mois, exclusivité 1 mois",
      deal: verrou({
        deliverables: [video(4), story(6), photo(1)],
        usage: { organic: true, paid_ads: false, whitelisting: true, spark_ads: false, perpetual: false, duration_months: 3, territory: null },
        exclusivity: { present: true, duration_months: 1, category: "x" },
      }),
      tier: "starter",
      attendu: [970, 2210],
      territoire: false,
    },
  ];

  it.each(VERROUILLEES)("$nom : identique avant et après", ({ deal: sujet, tier, attendu }) => {
    const avant = computeEstimate(sujet, { tier, table: rateTable("fr-2026.3")! });
    const apres = computeEstimate(sujet, { tier });
    expect([avant.total_low, avant.total_high]).toEqual(attendu);
    expect([apres.total_low, apres.total_high]).toEqual(attendu);
    // Et pas seulement le total : les lignes aussi, libellé pour libellé.
    expect(apres.lines.map((l) => l.label)).toEqual(avant.lines.map((l) => l.label));
  });

  it("deux des quatre mentionnent un territoire, et c'est « monde entier » : le chemin qui n'a pas changé", () => {
    const avecTerritoire = VERROUILLEES.filter((v) => v.territoire);
    expect(avecTerritoire).toHaveLength(2);
    for (const v of avecTerritoire) {
      expect(v.deal.usage.territory).toBe("monde entier");
      expect(computeEstimate(v.deal, { tier: v.tier }).lines.filter((l) => l.topic === "territory").map((l) => l.label)).toEqual(["Diffusion mondiale"]);
    }
    for (const v of VERROUILLEES.filter((x) => !x.territoire)) {
      expect(v.deal.usage.territory).toBeNull();
      expect(computeEstimate(v.deal, { tier: v.tier }).lines.filter((l) => l.topic === "territory")).toEqual([]);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("le territoire absent est une information qui manque, jamais une majoration", () => {
  it("rien sur le territoire : aucune majoration, une hypothèse, et le territoire compté comme manquant", () => {
    const sujet = avecZones(null, []);
    const estimate = computeEstimate(sujet, { tier: "starter" });
    expect(estimate.lines.filter((l) => l.topic === "territory")).toEqual([]);
    expect(estimate.assumptions).toContain("Territoire non précisé : diffusion en France supposée.");
    // Le territoire n'est pas un terme connu, et il figure dans ce qui manque :
    // c'est par là que la page le fait remonter, parce que l'information
    // manque — jamais parce qu'un montant serait jugé faible.
    expect(knownTerms(sujet)).not.toContain("territory");
    expect(missingTermKeys(sujet)).toContain("territory");
  });

  it("le territoire écrit devient un terme connu, et la majoration ne dépend que des zones", () => {
    const ecrit = avecZones("France, Belgique et Suisse", []);
    expect(knownTerms(ecrit)).toContain("territory");
    expect(missingTermKeys(ecrit)).not.toContain("territory");
    // Écrit mais sans zone extraite : le code ne devine pas le texte, donc
    // rien n'est facturé — et aucune hypothèse « France supposée » non plus,
    // puisque le territoire EST écrit.
    expect(lignesTerritoire(ecrit)).toEqual([]);
    expect(computeEstimate(ecrit, { tier: "starter" }).assumptions).not.toContain("Territoire non précisé : diffusion en France supposée.");
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("un tour de négociation emporte les zones avec le territoire", () => {
  it("changer le territoire change les zones : les deux sont la même information", () => {
    const avant = avecZones("France", ["france"]);
    const apres = avecZones("France, Belgique et Suisse", ["france", "europe_francophone"]);
    const applique = applyGroups(avant, apres, ["territory"]);
    expect(applique.usage.territory).toBe("France, Belgique et Suisse");
    expect(applique.usage.territory_zones).toEqual(["europe_francophone"]);
    // Et le nouveau chiffrage suit : sans les zones, le tour aurait gardé
    // l'ancien territoire chiffré à zéro sous un nouveau libellé.
    expect(lignesTerritoire(applique).map((l) => l.label)).toEqual(["Diffusion Belgique, Suisse, Luxembourg"]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("le modèle extrait, le code chiffre", () => {
  it("le prompt décrit le champ et la liste fermée, sans un seul montant", () => {
    const prompt = readFileSync("lib/llm/prompt.ts", "utf8");
    const ligne = prompt.split("\n").find((l) => l.startsWith("- usage.territory_zones"))!;
    expect(ligne).toBeTruthy();
    // La liste doit être ÉNUMÉRÉE là où elle est annoncée fermée, pas
    // seulement illustrée par des exemples plus loin dans la phrase : un
    // prompt qui laisse le modèle choisir ses zones passerait sinon, puisque
    // les exemples citent les cinq noms.
    const enumeration = ligne.slice(ligne.indexOf("liste fermée"), ligne.indexOf("Tableau vide"));
    expect(ligne.indexOf("liste fermée"), "la liste est annoncée fermée").toBeGreaterThan(0);
    for (const zone of allZones()) expect(enumeration, zone).toContain(`"${zone}"`);
    // Aucun montant, aucun pourcentage : le modèle ne chiffre jamais.
    expect(ligne).not.toMatch(/\d+\s*%|€|\+\d/);
    expect(ligne).toContain("le prix des zones est calculé ailleurs");
  });

  // Mission #160, point 5 — la version affichée vient de CURRENT_RATE_VERSION,
  // jamais recopiée : sinon une table neuve laisse l'écran annoncer l'ancienne,
  // et c'est exactement le genre de chiffre faux qu'on ne rattrape jamais.
  it("aucune version de table n'est écrite en dur dans le produit", () => {
    const fichiers = ["lib", "app", "components"].flatMap((dir) =>
      readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter((e) => e.isFile() && /\.tsx?$/.test(e.name))
        .map((e) => `${e.parentPath.replaceAll("\\", "/")}/${e.name}`),
    );
    expect(fichiers.length).toBeGreaterThan(100);
    for (const fichier of fichiers) {
      // tables.ts est le seul endroit qui NOMME les tables : c'est son métier.
      if (fichier.endsWith("lib/rates/tables.ts")) continue;
      const copie = readFileSync(fichier, "utf8")
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
        .split("\n")
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join("\n");
      expect(copie, fichier).not.toMatch(/fr-20\d\d\.\d/);
    }
    // Et la version affichée sur l'accueil est bien la constante.
    expect(FAQ.map((item) => item.answer).join(" ")).toContain(CURRENT_RATE_VERSION);
  });

  it("la normalisation écarte avant enregistrement, et n'écarte jamais la ligne", () => {
    const sujet = avecZones("partout", ["mars", "europe", "france", "europe"]);
    // Dédoublonné, trié par la table, France retirée, inconnu écarté.
    expect(sujet.usage.territory_zones).toEqual(["europe"]);
  });
});
