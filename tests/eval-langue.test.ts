import { describe, expect, it } from "vitest";
import { CORPUS } from "@/evals/langue-corpus";
import { CONSIGNE_LANGUE, newcombe, promptEnTete, wilson } from "@/evals/langue-mesure";
import { scriptsNonLatins } from "@/lib/llm/langue";
import { SYSTEM_PROMPT } from "@/lib/llm/prompt";

// Mission #211 — CE QUI DOIT RESTER VRAI POUR QUE L'ÉVAL DE LANGUE DISE
// ENCORE QUELQUE CHOSE.
//
// L'éval elle-même coûte de l'argent et ne tourne pas en intégration. Ses
// deux hypothèses silencieuses se tiennent donc ici, gratuitement :
//   — la consigne de langue est bien là où l'éval croit la trouver, et la
//     déplacer ne change QUE sa position ;
//   — une offre du corpus déclare exactement les écritures qu'elle contient.
//     Une faute de frappe y ferait passer une fuite pour un cas légitime, et
//     c'est l'erreur qui coûterait le plus cher : elle rendrait le taux
//     mesuré FAUX dans le sens rassurant.

describe("la consigne de langue, et son déplacement", () => {
  it("existe dans SYSTEM_PROMPT, une seule fois, suivie d'un retour à la ligne", () => {
    const occurrences = SYSTEM_PROMPT.split(`${CONSIGNE_LANGUE}\n`).length - 1;
    expect(occurrences).toBe(1);
  });

  it("n'est PAS en tête du prompt de production : c'est tout l'objet de l'éval", () => {
    expect(SYSTEM_PROMPT.startsWith(CONSIGNE_LANGUE.slice(2))).toBe(false);
    // Et elle est bien noyée : du texte la précède, beaucoup.
    expect(SYSTEM_PROMPT.indexOf(CONSIGNE_LANGUE)).toBeGreaterThan(3_000);
  });

  it("DÉPLACÉE, elle ouvre le prompt — sans tiret de liste", () => {
    const tete = promptEnTete();
    expect(tete.startsWith(CONSIGNE_LANGUE.slice(2))).toBe(true);
    expect(tete.startsWith("- ")).toBe(false);
  });

  it("DÉPLACÉE, elle n'apparaît plus qu'une fois : la ligne est bougée, pas dupliquée", () => {
    const tete = promptEnTete();
    expect(tete.split(CONSIGNE_LANGUE.slice(2)).length - 1).toBe(1);
  });

  it("LE RESTE DU PROMPT EST INTACT, mot pour mot", () => {
    // Reconstituer l'original depuis la variante : si un seul caractère avait
    // été réécrit au passage, l'égalité tomberait.
    const tete = promptEnTete();
    const corps = tete.slice(`${CONSIGNE_LANGUE.slice(2)}\n\n`.length);
    expect(SYSTEM_PROMPT.replace(`${CONSIGNE_LANGUE}\n`, "")).toBe(corps);
  });

  it("LA LONGUEUR NE BOUGE QUE DU TIRET DE LISTE : « le prompt est plus long » n'explique rien", () => {
    // « - » retiré (2 car.), « \n\n » ajouté à la place du « \n » consommé (1 car.).
    expect(promptEnTete().length).toBe(SYSTEM_PROMPT.length - 1);
  });
});

describe("le corpus de l'éval", () => {
  it("chaque offre déclare EXACTEMENT les écritures non latines qu'elle contient", () => {
    for (const offre of CORPUS) {
      const reel = [...new Set(scriptsNonLatins(offre.texte))].sort();
      expect(reel, offre.id).toEqual([...offre.attendu].sort());
    }
  });

  it("couvre les quatre cas que la mission exige", () => {
    const ids = CORPUS.map((o) => o.id);
    // Du français pur, sans un caractère non latin.
    expect(CORPUS.filter((o) => o.attendu.length === 0 && /^(fr|gifting)/.test(o.id)).length).toBeGreaterThanOrEqual(3);
    // Un nom de marque étranger légitime dans une offre française.
    expect(ids).toContain("fr-marque-japonaise");
    // Une offre dans une autre langue.
    expect(CORPUS.some((o) => o.attendu.includes("Hebrew"))).toBe(true);
    // Du gifting sans rémunération : la classe qui a produit la fuite du
    // 31/10. Trois offres, aucune annonçant un tarif de prestation — la
    // valeur boutique d'un produit offert, elle, a sa place : une vraie offre
    // de gifting la donne presque toujours.
    const gifting = CORPUS.filter((o) => o.id.startsWith("gifting"));
    expect(gifting.length).toBeGreaterThanOrEqual(3);
    for (const o of gifting) {
      expect(o.texte, o.id).not.toMatch(/(budget|rémunération forfaitaire|tarif|cachet)\s*:/i);
      expect(o.role, o.id).toMatch(/gifting/);
    }
  });

  it("l'offre à marque latine rare contient bien un caractère latin inhabituel", () => {
    // U+02BC : son Script est Common, son Script_Extensions contient Latin.
    // C'est le caractère qui distingue les deux propriétés Unicode, et il ne
    // doit déclencher aucun contrôle.
    const offre = CORPUS.find((o) => o.id === "fr-marque-latine-rare")!;
    expect(offre.texte).toContain("ʼ");
    expect(scriptsNonLatins(offre.texte)).toEqual([]);
  });

  it("aucune offre ne vient de la base : elles sont toutes écrites dans le dépôt", () => {
    for (const offre of CORPUS) {
      expect(offre.texte.length, offre.id).toBeGreaterThan(200);
      expect(offre.role.length, offre.id).toBeGreaterThan(20);
    }
  });
});

describe("les intervalles annoncés dans le rapport", () => {
  it("WILSON À ZÉRO SUCCÈS NE REND PAS UN INTERVALLE NUL", () => {
    // C'est la raison du choix : l'intervalle normal donnerait [0 % ; 0 %] et
    // ferait conclure à l'absence de fuite.
    const w = wilson(0, 100);
    expect(w.taux).toBe(0);
    expect(w.bas).toBe(0);
    // Valeur de référence pour 0/100 à 95 % : 3,7 %.
    expect(w.haut).toBeCloseTo(0.037, 3);
  });

  it("WILSON SUR UN CAS CONNU : 50/100 donne [40,4 % ; 59,6 %]", () => {
    const w = wilson(50, 100);
    expect(w.bas).toBeCloseTo(0.4038, 3);
    expect(w.haut).toBeCloseTo(0.5962, 3);
  });

  it("la borne haute se resserre quand l'échantillon grandit", () => {
    expect(wilson(0, 450).haut).toBeLessThan(wilson(0, 100).haut);
    expect(wilson(0, 450).haut).toBeGreaterThan(0);
  });

  it("un total nul ne rend pas un faux zéro mais NaN", () => {
    const w = wilson(0, 0);
    expect(Number.isNaN(w.taux)).toBe(true);
    expect(Number.isNaN(w.haut)).toBe(true);
  });

  it("NEWCOMBE : deux taux nuls donnent un écart nul dont l'intervalle CONTIENT zéro", () => {
    // Le cas qu'on risque d'observer. Un intervalle qui s'effondrerait à
    // [0 ; 0] ferait annoncer « aucune différence » là où rien n'est mesuré.
    const e = newcombe({ s: 0, n: 450 }, { s: 0, n: 450 });
    expect(e.diff).toBe(0);
    expect(e.bas).toBeLessThan(0);
    expect(e.haut).toBeGreaterThan(0);
  });

  it("NEWCOMBE : un écart franc sur de gros échantillons exclut zéro", () => {
    const e = newcombe({ s: 200, n: 450 }, { s: 20, n: 450 });
    expect(e.diff).toBeCloseTo(0.4, 2);
    expect(e.bas).toBeGreaterThan(0);
  });

  it("NEWCOMBE est antisymétrique sur le signe de l'écart", () => {
    const ab = newcombe({ s: 30, n: 300 }, { s: 10, n: 300 });
    const ba = newcombe({ s: 10, n: 300 }, { s: 30, n: 300 });
    expect(ba.diff).toBeCloseTo(-ab.diff, 10);
    expect(ba.bas).toBeCloseTo(-ab.haut, 10);
    expect(ba.haut).toBeCloseTo(-ab.bas, 10);
  });
});
