import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { baseExtraction } from "@/lib/fixtures/preview-states";
import { composeAnalysis } from "@/lib/analysis/compose";
import { CURRENT_RATE_VERSION } from "@/lib/rates/tables";
import { allZones } from "@/lib/rates/zones";

// Mission #165 — LA CARTE DE VERDICT.
//
// Une image 1080 × 1350 que la créatrice envoie à ses copines. Ce fichier
// tient quatre promesses :
//   1. la route rend un VRAI PNG, pour un deal sous-évalué, correct et
//      sur-évalué — on ne construit pas la carte que pour l'indignation ;
//   2. sans cookie, ou sans analyse, elle répond 404 à corps vide ;
//   3. la requête ne lit que des colonnes nommées, et jamais le nom de la
//      marque ;
//   4. rien de ce qui s'affiche ne vient du modèle ou de l'offre.

type Ligne = Record<string, unknown>;

const db = vi.hoisted(() => ({ lignes: [] as Ligne[], requetes: [] as string[], panne: false }));

vi.mock("@/lib/supabase/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/server")>()),
  selectRows: async (table: string, query: string) => {
    db.requetes.push(`${table}?${query}`);
    if (db.panne) throw new Error("base injoignable");
    return db.lignes;
  },
}));

const { GET } = await import("@/app/api/carte/route");
const { CARTE_COLONNES, verdictDataFromRow } = await import("@/lib/share-card/verdict-data");
const { offerLine, VERDICT_CARD_SIZE, VERDICT_UN_MOT, verdictCardAvailable, verdictCardTexts } = await import(
  "@/lib/share-card/verdict-card"
);

const TOKEN = "jeton-du-navigateur";
const PNG = [0x89, 0x50, 0x4e, 0x47];

function appel(cookie: string | null = `deal_anon_token=${TOKEN}`) {
  return GET(new Request("https://www.negoscore.fr/api/carte", { headers: cookie ? { cookie } : {} }));
}

// Une ligne telle que PostgREST la rend pour la projection de CARTE_COLONNES.
function ligne(part: Partial<Ligne> = {}): Ligne {
  return {
    rate_table_version: CURRENT_RATE_VERSION,
    propose: 300,
    produits: null,
    bas: 540,
    haut: 1190,
    bande: "weak",
    evaluabilite: "complete",
    livrables: [{ type: "video", platform: "tiktok", quantity: 3, format: "30 s, 3 hooks" }],
    droits_mois: 6,
    droits_a_vie: false,
    zones: ["france", "europe_francophone"],
    exclusivite: true,
    exclusivite_mois: 3,
    ...part,
  };
}

beforeEach(() => {
  db.lignes = [];
  db.requetes = [];
  db.panne = false;
});

// ───────────────────────────────────────────────────────────────────────────
describe("la route rend une image, quel que soit le verdict", () => {
  // Trois situations réelles, et la carte doit tenir pour les trois : on ne
  // la construit pas uniquement pour l'indignation.
  const CAS = [
    { nom: "sous-évalué", propose: 300, bande: "bad" },
    { nom: "correct", propose: 800, bande: "fair" },
    { nom: "sur-évalué", propose: 1500, bande: "excellent" },
  ] as const;

  it.each(CAS)("$nom : un PNG de 1080 × 1350", async ({ propose, bande }) => {
    db.lignes = [ligne({ propose, bande })];
    const reponse = await appel();
    expect(reponse.status).toBe(200);
    expect(reponse.headers.get("content-type")).toContain("image/png");
    const octets = new Uint8Array(await reponse.arrayBuffer());
    // La signature PNG, pas seulement l'en-tête annoncé.
    expect([...octets.slice(0, 4)]).toEqual(PNG);
    expect(octets.byteLength).toBeGreaterThan(1000);
    expect(VERDICT_CARD_SIZE).toEqual({ width: 1080, height: 1350 });
  });

  it("l'image n'est jamais mise en cache partagé", async () => {
    db.lignes = [ligne()];
    expect((await appel()).headers.get("cache-control")).toContain("no-store");
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("sans carte à montrer, 404 à corps vide", () => {
  it("aucun cookie : 404, et la base n'est même pas interrogée", async () => {
    const reponse = await appel(null);
    expect(reponse.status).toBe(404);
    expect(await reponse.text()).toBe("");
    expect(db.requetes).toEqual([]);
  });

  it("cookie valide mais aucune analyse : 404", async () => {
    db.lignes = [];
    const reponse = await appel();
    expect(reponse.status).toBe(404);
    expect(await reponse.text()).toBe("");
  });

  it("analyse sans verdict, sans fourchette ou sans montant : 404", async () => {
    for (const manque of [{ bande: null }, { evaluabilite: "terms_unknown" }, { bas: null }, { haut: null }, { propose: null, produits: null }]) {
      db.lignes = [ligne(manque)];
      const reponse = await appel();
      expect(reponse.status, JSON.stringify(manque)).toBe(404);
      expect(await reponse.text()).toBe("");
    }
  });

  it("base injoignable : 404 aussi, et rien dans la réponse ne dit laquelle des quatre", async () => {
    db.panne = true;
    const vraiErreur = console.error;
    console.error = () => undefined;
    try {
      const reponse = await appel();
      expect(reponse.status).toBe(404);
      expect(await reponse.text()).toBe("");
    } finally {
      console.error = vraiErreur;
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// LA GARDE DE SÉCURITÉ. Le payload d'une analyse contient `deal.brand` : le
// charger pour n'en tirer qu'un montant ferait transiter le nom de
// l'annonceur par une route qui fabrique une image destinée à être postée.
describe("la requête ne lit que ce qu'elle affiche", () => {
  const MARQUE = /brand|marque|annonceur|advertiser|enseigne|client/i;

  it("aucune colonne ne porte la marque ni l'annonceur", () => {
    for (const colonne of CARTE_COLONNES) {
      expect(colonne, colonne).not.toMatch(MARQUE);
    }
  });

  it("jamais d'étoile, et jamais le payload en bloc", async () => {
    db.lignes = [ligne()];
    await appel();
    expect(db.requetes).toHaveLength(1);
    const requete = db.requetes[0];
    expect(requete).not.toContain("select=*");
    expect(requete).not.toMatch(/select=[^&]*(^|,)payload(,|&|$)/);
    // Chaque colonne demandée est l'une des colonnes auditées.
    const select = /select=([^&]*)/.exec(requete)?.[1] ?? "";
    const demandees = select.split(",").filter((c) => !c.startsWith("deal:") && !c.startsWith("anon_token"));
    for (const colonne of demandees) {
      expect(CARTE_COLONNES as readonly string[], colonne).toContain(colonne);
    }
    expect(requete, "le jeton filtre la requête").toContain("deal.anon_token=eq.");
  });

  it("le fichier de la route ne lit aucun champ de marque", () => {
    const source = readFileSync("app/api/carte/route.tsx", "utf8") + readFileSync("lib/share-card/verdict-data.ts", "utf8");
    // Les commentaires expliquent justement pourquoi : on ne regarde que le
    // code, lignes de commentaire retirées.
    const code = source
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join("\n");
    expect(code).not.toMatch(/\bbrand\b/);
    expect(code).not.toMatch(/select=\*/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("rien de ce qui s'affiche ne vient du modèle", () => {
  it("le `format` libre d'un livrable n'entre pas dans les données de la carte", () => {
    const data = verdictDataFromRow(ligne());
    expect(JSON.stringify(data)).not.toContain("hooks");
    expect(data.livrables).toEqual([{ type: "video", quantity: 3 }]);
  });

  it("la ligne d'offre n'est faite que de champs structurés", () => {
    const texte = offerLine(verdictDataFromRow(ligne()))!;
    // Les zones sont des ÉLÉMENTS de la ligne, chacune avec son libellé de
    // table, France comprise (#167).
    expect(texte).toBe("3 vidéos · 6 mois de droits pub · exclusivité 3 mois · France · Europe francophone");
    // Ni plateforme écrite par le modèle, ni format, ni catégorie.
    expect(texte).not.toMatch(/tiktok|hooks/i);
  });

  // Mission #167 — le nombre affiché est celui qui a été comparé à la
  // fourchette. Sans argent, ce sont les produits, et c'est dit.
  it("« On m'a proposé » affiche le montant qui a été comparé, produits compris", () => {
    // L'espace avant l'euro est insécable : on compare sur le nombre et le
    // suffixe, pas sur l'octet d'espace.
    expect(verdictCardTexts(verdictDataFromRow(ligne())).propose).toMatch(/^300\s€$/);
    const enProduits = verdictCardTexts(verdictDataFromRow(ligne({ propose: null, produits: 267 })));
    expect(enProduits.propose).toMatch(/^267\s€ en produits$/);
    // Et jamais la somme des deux : 300 + 267 ne s'affiche pas.
    expect(verdictCardTexts(verdictDataFromRow(ligne({ produits: 267 }))).propose).toMatch(/^300\s€$/);
  });

  // ─── Mission #167, point 2 : les deux gardes nommées ────────────────────

  it("une zone absente de l'offre ne sort pas sur la carte", () => {
    // Trois zones demandées sur cinq : les deux autres n'apparaissent pas, et
    // rien ne vient les compléter.
    const texte = offerLine(verdictDataFromRow(ligne({ zones: ["france", "europe_francophone", "amerique_nord"] })))!;
    expect(texte).toContain("France · Europe francophone · Amérique du Nord");
    expect(texte).not.toMatch(/reste de l'Europe|reste du monde|monde entier/);
    // Et une zone que la table ne connaît pas n'est jamais affichée telle
    // quelle : elle est écartée avant d'arriver à la carte.
    expect(verdictDataFromRow(ligne({ zones: ["mars", "europe"] })).zones).toEqual(["europe"]);
    expect(offerLine(verdictDataFromRow(ligne({ zones: ["mars", "europe"] })))!).not.toContain("mars");
  });

  it("la France seule rend « France », pas une ligne vide", () => {
    // Elle était retirée avant #167 parce que sa majoration vaut zéro : une
    // offre France-seulement rendait une carte sans aucun territoire.
    expect(offerLine(verdictDataFromRow(ligne({ zones: ["france"], droits_mois: null, exclusivite: false })))).toBe(
      "3 vidéos · France",
    );
    // Aucune zone demandée reste aucune zone affichée : on n'invente pas la
    // France quand l'offre ne dit rien du territoire.
    expect(offerLine(verdictDataFromRow(ligne({ zones: [], droits_mois: null, exclusivite: false })))).toBe("3 vidéos");
  });

  // Trouvé en RENDANT la carte, pas en la relisant : avec les quatre zones
  // énumérées, la ligne d'offre faisait quatre lignes et poussait le pied de
  // page hors de la marge de 100 px.
  it("des zones qui atteignent le mondial se disent « monde entier », pas en liste", () => {
    const toutes = ["france", "europe_francophone", "europe", "amerique_nord", "reste_du_monde"];
    const texte = offerLine(verdictDataFromRow(ligne({ zones: toutes })))!;
    expect(texte).toContain("monde entier");
    expect(texte).not.toContain("Amérique du Nord");
    // Et c'est la MÊME règle que celle du chiffrage : deux façons de le dire,
    // jamais deux vérités.
    expect(texte.length).toBeLessThan(100);
  });

  it("les cinq bandes ont leur mot, et le verdict en est un seul", () => {
    for (const mot of Object.values(VERDICT_UN_MOT)) {
      expect(mot, mot).not.toContain(" ");
    }
    expect(Object.keys(VERDICT_UN_MOT).sort()).toEqual(["bad", "excellent", "fair", "good", "weak"]);
  });

  it("toutes les zones de la table ont un libellé affichable", () => {
    for (const zone of allZones()) {
      expect(offerLine(verdictDataFromRow(ligne({ zones: [zone, "reste_du_monde"] }))), zone).not.toContain(zone);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("le barème affiché est celui qui a produit les chiffres", () => {
  it("une analyse fraîche porte CURRENT_RATE_VERSION", () => {
    // La fixture publique passée par le vrai moteur : sa version est, par
    // construction, celle de la table courante.
    const analyse = composeAnalysis(baseExtraction(), { tier: "starter" });
    expect(analyse.estimate.rate_table_version).toBe(CURRENT_RATE_VERSION);
    const textes = verdictCardTexts(verdictDataFromRow(ligne({ rate_table_version: analyse.estimate.rate_table_version })));
    expect(textes.bareme).toBe(`barème ${CURRENT_RATE_VERSION}`);
  });

  it("la version n'est écrite en dur nulle part dans la carte", () => {
    const source = readFileSync("lib/share-card/verdict-card.tsx", "utf8") + readFileSync("app/api/carte/route.tsx", "utf8");
    expect(source).not.toMatch(/fr-20\d\d\.\d/);
  });

  it("une analyse d'hier affiche SA version, pas celle d'aujourd'hui", () => {
    // Sinon la carte annoncerait un barème qui n'a pas produit ses chiffres —
    // c'est tout le propos de la #085, et une carte est faite pour être vue.
    const textes = verdictCardTexts(verdictDataFromRow(ligne({ rate_table_version: "fr-2026.3" })));
    expect(textes.bareme).toBe("barème fr-2026.3");
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("le bouton de partage", () => {
  const SOURCE = readFileSync("components/result/verdict-card-share.tsx", "utf8");

  it("l'appel à share part du clic, sans await devant : iOS perd sinon le geste", () => {
    // Le fichier est récupéré À L'AFFICHAGE de la carte, pas au clic de
    // partage : c'est ce qui permet au gestionnaire de n'avoir rien à attendre.
    expect(SOURCE).toContain("const fichier = new File([blob]");
    const partager = SOURCE.slice(SOURCE.indexOf("function partager"), SOURCE.indexOf("return ("));
    expect(partager).toContain("navigator\n        .share({ files: [fichier] })");
    expect(partager, "aucun await entre le clic et share()").not.toContain("await");
    expect(SOURCE).toContain("onClick={() => partager(etat.fichier)}");
  });

  it("le partage natif n'est proposé que si le navigateur accepte le fichier", () => {
    expect(SOURCE).toContain('"canShare" in navigator');
    expect(SOURCE).toContain("navigator.canShare({ files: [fichier] })");
    // Sinon : téléchargement, et le libellé le dit.
    expect(SOURCE).toContain("Télécharger");
    expect(SOURCE).toContain("Partager");
  });

  it("un abandon n'est pas une erreur", () => {
    expect(SOURCE).toContain('erreur.name !== "AbortError"');
  });

  it("aucun partage automatique : rien ne part sans un second clic", () => {
    // Le fetch est dans `preparer`, déclenché par « Voir ma carte », et
    // `partager` n'est appelé que par onClick.
    //
    // On COMPTE les occurrences : chercher `useEffect(…preparer` laissait
    // passer `useEffect(() => { void preparer(); }, [])`, parce que la classe
    // négative s'arrête à la première parenthèse fermante — celle du `()` de
    // la fonction fléchée. Deux occurrences chacun, et deux seulement : la
    // déclaration, et le gestionnaire de clic.
    const fois = (nom: string) => SOURCE.split(nom).length - 1;
    expect(SOURCE).toContain("onClick={preparer}");
    expect(SOURCE).toContain("onClick={() => partager(etat.fichier)}");
    expect(fois("preparer"), "preparer n'est appelé que par le clic").toBe(2);
    expect(fois("partager("), "partager n'est appelé que par le clic").toBe(2);
  });

  it("les deux drapeaux ne portent que le fait qu'une carte est partie", () => {
    const signaler = SOURCE.slice(SOURCE.indexOf("function signaler"), SOURCE.indexOf("export function VerdictCardShare"));
    expect(signaler).toContain('"carte_partagee" | "carte_telechargee"');
    // Aucun montant, aucune fourchette, aucun identifiant dans le corps.
    expect(signaler).not.toMatch(/propose|bas|haut|bande|analysisId|montant/);
    expect(signaler).toContain('body: JSON.stringify({ event, attribution: currentAttribution() })');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("la page de résultat propose la carte là où elle existe", () => {
  const PAGE = readFileSync("app/analyse/resultat/[id]/page.tsx", "utf8");

  it("au visiteur anonyme, qui a le cookie ; à la personne connectée, la carte de #064", () => {
    // Se connecter EFFACE le cookie anonyme (lib/auth/sign-in.ts) : la carte
    // de verdict n'a alors plus de quoi se construire, et proposer son bouton
    // serait proposer un 404.
    expect(PAGE).toContain("user === null ? <VerdictCardShare /> : <ShareCardLink");
    expect(readFileSync("lib/auth/sign-in.ts", "utf8")).toContain("expiredCookieHeader(ANON_COOKIE)");
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("ce que la carte refuse de produire", () => {
  it("verdictCardAvailable exige un montant, une fourchette et un verdict", () => {
    const complet = verdictDataFromRow(ligne());
    expect(verdictCardAvailable(complet)).toBe(true);
    expect(verdictCardAvailable({ ...complet, propose: null, produits: null })).toBe(false);
    expect(verdictCardAvailable({ ...complet, bas: null })).toBe(false);
    expect(verdictCardAvailable({ ...complet, bande: null })).toBe(false);
    // Des produits offerts suffisent comme montant proposé.
    expect(verdictCardAvailable({ ...complet, propose: null, produits: 120 })).toBe(true);
  });
});
