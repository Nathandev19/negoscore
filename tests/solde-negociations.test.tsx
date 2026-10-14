import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mission #182 — COMBIEN IL EN RESTE.
//
// Le solde est LU là où le quota vit (lib/billing/entitlement.ts), jamais
// recalculé par un comptage de son côté. Trois magasins selon la formule : le
// compteur free_usage, credits.balance, et — pour un abonnement — le nombre
// d'analyses de la période, qui EST le quota.
//
// Le test qui compte le plus est celui de CONCORDANCE : « restantes === 0 »
// doit valoir exactement « le serveur refuse ». Sans lui, l'écran promettrait
// une analyse que /api/analyse refuserait, ou l'inverse.

const db = vi.hoisted(() => ({
  credits: [] as Array<Record<string, unknown>>,
  grants: [] as Array<Record<string, unknown>>,
  free: [] as Array<Record<string, unknown>>,
  // Analyses de la période, pour le quota d'un abonnement.
  analyses: [] as Array<Record<string, unknown>>,
  deals: [] as Array<Record<string, unknown>>,
  // Table free_usage absente (migration 015 non appliquée).
  freeTableMissing: false,
  fail: false,
  lectures: [] as string[],
}));

vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/server")>();
  return {
    ...actual,
    selectRows: async (table: string) => {
      db.lectures.push(table);
      if (db.fail) throw new actual.SupabaseRequestError("panne", 500, null);
      if (table === "free_usage") {
        if (db.freeTableMissing) throw new actual.SupabaseRequestError("relation absente", 404, "42P01");
        return db.free;
      }
      if (table === "credits") return db.credits;
      if (table === "admin_entitlements") return db.grants;
      if (table === "analyses") return db.analyses;
      if (table === "deals") return db.deals;
      return [];
    },
    countRows: async () => 0,
  };
});

const { analysisBalance, analysisRightStatus } = await import("@/lib/billing/entitlement");
const { FREE_ANALYSES, PRO_ANALYSES_PER_PERIOD } = await import("@/lib/billing/plans");
const { SOLDE_ILLIMITE, SOLDE_SEUIL_BAS, soldeBadge, soldePastille, soldeTexte, soldeTon } = await import("@/lib/content/labels");
const { AccountView } = await import("@/components/account/account-view");

const USER = { id: "u-createur", email: "camille@exemple.test" };
const JETON = "jeton-de-navigateur";

beforeEach(() => {
  vi.stubEnv("IP_HASH_SALT", "sel-de-test");
  db.credits = [];
  db.grants = [];
  db.free = [];
  db.analyses = [];
  db.deals = [];
  db.freeTableMissing = false;
  db.fail = false;
  db.lectures = [];
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const dans = (jours: number) => new Date(Date.now() + jours * 86_400_000);
const analyses = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `a-${i}` }));

// ═══════════════════ D. LES CAS QUI DOIVENT MARCHER ═══════════════════════

describe("D1 — session anonyme (deal_anon_token)", () => {
  it("navigateur neuf : sa gratuité est entière, sans aucune lecture inutile", async () => {
    expect(await analysisBalance(null, null)).toEqual({ restantes: FREE_ANALYSES, rechargeLe: null, source: "gratuit", intact: true });
    // Sans jeton, rien n'a pu être consommé : on ne va pas le demander.
    expect(db.lectures).toEqual([]);
  });

  it("jeton connu, gratuité pas encore prise : il en reste une", async () => {
    db.free = [{ used: 0 }];
    expect(await analysisBalance(null, JETON)).toMatchObject({ restantes: FREE_ANALYSES, source: "gratuit" });
  });

  it("jeton connu, gratuité consommée : zéro, et pas de date de recharge", async () => {
    db.free = [{ used: FREE_ANALYSES }];
    expect(await analysisBalance(null, JETON)).toEqual({ restantes: 0, rechargeLe: null, source: "gratuit", intact: false });
  });

  it("le solde anonyme est LU dans le compteur durable, pas déduit des lignes d'analyses", async () => {
    // Le compteur dit « prise », et il y a zéro ligne d'analyse en base : un
    // solde qui compterait les lignes annoncerait 1.
    db.free = [{ used: FREE_ANALYSES }];
    db.analyses = [];
    db.deals = [];
    expect((await analysisBalance(null, JETON)).restantes).toBe(0);
    expect(db.lectures).toContain("free_usage");
  });

  it("table free_usage absente : on retombe sur la règle du moteur, pas sur une estimation", async () => {
    db.freeTableMissing = true;
    db.deals = [{ id: "d-1" }];
    expect((await analysisBalance(null, JETON)).restantes).toBe(0);
    db.deals = [];
    expect((await analysisBalance(null, JETON)).restantes).toBe(FREE_ANALYSES);
  });
});

describe("D2 — compte connecté, chaque palier", () => {
  it("compte gratuit neuf : une négociation", async () => {
    db.free = [{ used: 0 }];
    expect(await analysisBalance(USER, null)).toMatchObject({ restantes: 1, source: "gratuit" });
  });

  it("compte gratuit dont la gratuité est prise : zéro", async () => {
    db.free = [{ used: FREE_ANALYSES }];
    expect(await analysisBalance(USER, null)).toMatchObject({ restantes: 0, source: "gratuit" });
  });

  it("réserve achetée : le solde est celui de la réserve, et il ne se recharge pas", async () => {
    db.credits = [{ plan: "pack", balance: 3, period_end: null }];
    expect(await analysisBalance(USER, null)).toEqual({ restantes: 3, rechargeLe: null, source: "pack", intact: false });
  });

  it("réserve épuisée après un achat : zéro, et on ne repasse PAS par la gratuité", async () => {
    // Le compteur de gratuité dirait « encore disponible » ; le moteur, lui,
    // refuse (decideRight). L'écran ne doit pas promettre l'inverse.
    db.credits = [{ plan: "pack", balance: 0, period_end: null }];
    db.free = [{ used: 0 }];
    expect(await analysisBalance(USER, null)).toMatchObject({ restantes: 0, source: "pack" });
  });

  it("abonnement en cours : le quota du mois moins ce qui est consommé, et la date de recharge", async () => {
    const fin = dans(10);
    db.credits = [{ plan: "pro", balance: 0, period_end: fin.toISOString() }];
    db.analyses = analyses(4);
    const solde = await analysisBalance(USER, null);
    expect(solde.restantes).toBe(PRO_ANALYSES_PER_PERIOD - 4);
    expect(solde.source).toBe("pro");
    expect(solde.rechargeLe?.toISOString()).toBe(fin.toISOString());
  });

  it("abonnement + réserve achetée : les deux s'additionnent, comme le moteur les additionne", async () => {
    db.credits = [{ plan: "pro", balance: 2, period_end: dans(5).toISOString() }];
    db.analyses = analyses(PRO_ANALYSES_PER_PERIOD);
    // Quota épuisé, mais les crédits prennent le relais : 0 serait faux.
    expect((await analysisBalance(USER, null)).restantes).toBe(2);
  });

  it("abonnement épuisé sans réserve : zéro, avec la date de recharge", async () => {
    const fin = dans(3);
    db.credits = [{ plan: "pro", balance: 0, period_end: fin.toISOString() }];
    db.analyses = analyses(PRO_ANALYSES_PER_PERIOD + 5);
    const solde = await analysisBalance(USER, null);
    expect(solde.restantes).toBe(0);
    expect(solde.rechargeLe).not.toBeNull();
  });

  it("abonnement expiré avec des crédits : c'est un Pack, pas un Pro", async () => {
    db.credits = [{ plan: "pro", balance: 2, period_end: dans(-1).toISOString() }];
    expect(await analysisBalance(USER, null)).toEqual({ restantes: 2, rechargeLe: null, source: "pack", intact: false });
  });

  it("abonnement expiré sans crédit : zéro, et pas de retour à la gratuité", async () => {
    db.credits = [{ plan: "pro", balance: 0, period_end: dans(-1).toISOString() }];
    db.free = [{ used: 0 }];
    expect(await analysisBalance(USER, null)).toMatchObject({ restantes: 0, source: "pro" });
  });

  it("accès Pro offert : même quota, et la fin de l'accès sert de date", async () => {
    const fin = dans(20);
    db.grants = [{ id: "g-1", granted_at: dans(-5).toISOString(), expires_at: fin.toISOString(), source: "admin_grant" }];
    db.analyses = analyses(7);
    const solde = await analysisBalance(USER, null);
    expect(solde.restantes).toBe(PRO_ANALYSES_PER_PERIOD - 7);
    expect(solde.source).toBe("pro_offert");
    expect(solde.rechargeLe?.toISOString()).toBe(fin.toISOString());
  });

  it("accès Pro offert sans fin déclarée : aucune date, donc l'écran dira par où en avoir plus", async () => {
    db.grants = [{ id: "g-1", granted_at: dans(-5).toISOString(), expires_at: null, source: "admin_grant" }];
    db.analyses = analyses(PRO_ANALYSES_PER_PERIOD);
    expect(await analysisBalance(USER, null)).toMatchObject({ restantes: 0, rechargeLe: null, source: "pro_offert" });
  });
});

describe("D3 — concordance avec le droit réel : le solde ne promet jamais l'inverse", () => {
  // La garde qui compte. Chaque situation est passée aux DEUX fonctions, et
  // « restantes === 0 » doit valoir exactement « refusé ».
  const situations: Array<{ nom: string; monte: () => void; user: typeof USER | null; jeton: string | null }> = [
    { nom: "navigateur neuf", monte: () => { db.free = [{ used: 0 }]; }, user: null, jeton: JETON },
    { nom: "navigateur dont la gratuité est prise", monte: () => { db.free = [{ used: FREE_ANALYSES }]; }, user: null, jeton: JETON },
    { nom: "compte gratuit neuf", monte: () => { db.free = [{ used: 0 }]; }, user: USER, jeton: null },
    { nom: "compte gratuit épuisé", monte: () => { db.free = [{ used: FREE_ANALYSES }]; }, user: USER, jeton: null },
    { nom: "réserve achetée", monte: () => { db.credits = [{ plan: "pack", balance: 2, period_end: null }]; }, user: USER, jeton: null },
    {
      nom: "réserve épuisée",
      monte: () => { db.credits = [{ plan: "pack", balance: 0, period_end: null }]; db.free = [{ used: 0 }]; },
      user: USER,
      jeton: null,
    },
    {
      nom: "abonnement avec du quota",
      monte: () => { db.credits = [{ plan: "pro", balance: 0, period_end: dans(5).toISOString() }]; db.analyses = analyses(1); },
      user: USER,
      jeton: null,
    },
    {
      nom: "abonnement au plafond, sans réserve",
      monte: () => { db.credits = [{ plan: "pro", balance: 0, period_end: dans(5).toISOString() }]; db.analyses = analyses(PRO_ANALYSES_PER_PERIOD); },
      user: USER,
      jeton: null,
    },
    {
      nom: "abonnement au plafond, avec réserve",
      monte: () => { db.credits = [{ plan: "pro", balance: 1, period_end: dans(5).toISOString() }]; db.analyses = analyses(PRO_ANALYSES_PER_PERIOD); },
      user: USER,
      jeton: null,
    },
    {
      nom: "abonnement expiré sans crédit",
      monte: () => { db.credits = [{ plan: "pro", balance: 0, period_end: dans(-1).toISOString() }]; db.free = [{ used: 0 }]; },
      user: USER,
      jeton: null,
    },
    {
      nom: "accès offert avec du quota",
      monte: () => { db.grants = [{ id: "g", granted_at: dans(-2).toISOString(), expires_at: null, source: "admin_grant" }]; db.analyses = analyses(2); },
      user: USER,
      jeton: null,
    },
    {
      nom: "accès offert au plafond",
      monte: () => { db.grants = [{ id: "g", granted_at: dans(-2).toISOString(), expires_at: null, source: "admin_grant" }]; db.analyses = analyses(PRO_ANALYSES_PER_PERIOD); },
      user: USER,
      jeton: null,
    },
  ];

  for (const situation of situations) {
    it(`${situation.nom} : « il en reste 0 » et « le droit est refusé » disent la même chose`, async () => {
      situation.monte();
      const solde = await analysisBalance(situation.user, situation.jeton);
      const droit = await analysisRightStatus(situation.user, situation.jeton);
      expect(solde.restantes === 0, `solde ${solde.restantes} / droit ${droit.allowed}`).toBe(!droit.allowed);
    });
  }
});

describe("D4 — changer de niveau sur une analyse existante ne consomme RIEN", () => {
  it("la route du niveau n'enregistre qu'une préférence : aucun décompte dans son code", () => {
    const route = readFileSync("app/api/niveau/route.ts", "utf8");
    for (const consommation of ["reserveAnalysis", "consumeFree", "adjustInteger", "free_usage_consume", "insertRow"]) {
      expect(route, consommation).not.toContain(consommation);
    }
  });

  it("le solde ne bouge pas quand la préférence de niveau change", async () => {
    db.credits = [{ plan: "pack", balance: 3, period_end: null }];
    const avant = await analysisBalance(USER, null);
    const { POST } = await import("@/app/api/niveau/route");
    await POST(
      new Request("https://negoscore.fr/api/niveau", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier: "confirme", at: Date.now() }),
      }),
    );
    expect((await analysisBalance(USER, null)).restantes).toBe(avant.restantes);
  });
});

describe("D5 — si la lecture échoue, aucun nombre", () => {
  it("la fonction laisse l'erreur remonter : elle n'invente pas de zéro", async () => {
    db.fail = true;
    await expect(analysisBalance(USER, null)).rejects.toThrow();
  });

  it("la route répond 503 sans champ « restantes »", async () => {
    db.fail = true;
    const { GET } = await import("@/app/api/solde/route");
    // Avec un jeton : sans lui, aucune lecture ne part et il n'y a rien à
    // faire échouer — la gratuité d'un navigateur neuf est entière de droit.
    const response = await GET(
      new Request("https://negoscore.fr/api/solde", { headers: { cookie: `deal_anon_token=${JETON}` } }),
    );
    expect(response.status).toBe(503);
    const corps = (await response.json()) as Record<string, unknown>;
    expect(corps.restantes).toBeUndefined();
    expect(corps).toEqual({ unknown: true });
  });

  it("la réponse n'est jamais mise en cache partagé : ce nombre est celui d'une seule personne", async () => {
    db.free = [{ used: 0 }];
    const { GET } = await import("@/app/api/solde/route");
    const response = await GET(new Request("https://negoscore.fr/api/solde"));
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("la route répond à un navigateur sans compte, et ne pose aucun cookie", async () => {
    db.free = [{ used: 0 }];
    const { GET } = await import("@/app/api/solde/route");
    const response = await GET(
      new Request("https://negoscore.fr/api/solde", { headers: { cookie: `deal_anon_token=${JETON}` } }),
    );
    expect(response.status).toBe(200);
    expect((await response.json()) as Record<string, unknown>).toMatchObject({ restantes: FREE_ANALYSES, source: "gratuit" });
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("le composant n'invente aucun nombre tant qu'il ne sait pas", () => {
    const source = readFileSync("components/solde-negociations.tsx", "utf8");
    // Le solde du champ reste absent ; la cellule mobile indique seulement
    // que la lecture est en cours et garde une cible accessible.
    expect(source).toContain("if (!solde && !compact) return null;");
    expect(source).toContain("if (!solde) return <Link");
    // Et aucune valeur par défaut, ni dans le magasin ni au rendu serveur.
    expect(source).toContain("{ cle: null, valeur: null, fini: false, abonnes: new Set() }");
    expect(source).toMatch(/\(\) => null,\s*\);/);
  });
});

describe("D6 — le solde est frais après une analyse", () => {
  const source = readFileSync("components/solde-negociations.tsx", "utf8");

  it("la lecture part en no-store, et la route répond no-store", () => {
    expect(source).toContain('cache: "no-store"');
    expect(readFileSync("app/api/solde/route.ts", "utf8")).toContain('"Cache-Control": "no-store"');
  });

  it("l'en-tête est rendu par chaque page, jamais par un layout partagé : il se remonte à la navigation", () => {
    // C'est ce qui rafraîchit le solde quand l'analyse pousse vers la page de
    // résultat. Si l'en-tête passait dans app/layout.tsx, il survivrait à la
    // navigation et garderait son chiffre d'avant.
    expect(readFileSync("app/layout.tsx", "utf8")).not.toContain("SiteHeader");
    expect(readFileSync("components/account/history-view.tsx", "utf8")).toContain("<SiteHeader />");
  });

  it("UNE SEULE lecture par page, partagée par les trois surfaces", () => {
    // MESURÉ dans le navigateur : trois exemplaires sont montés sur l'accueil
    // (barre de bureau, panneau mobile, ligne au-dessus du champ). Avec un
    // état par composant c'était trois requêtes pour un seul nombre, et trois
    // occasions d'afficher deux valeurs différentes sur le même écran.
    expect(source).toContain("const magasin: Magasin");
    expect(source).toContain("useSyncExternalStore");
    // Un seul endroit appelle le réseau.
    expect(source.split('fetch("/api/solde"')).toHaveLength(2);
    // Et il ne redemande pas pour un chemin déjà lu.
    expect(source).toContain("if (magasin.cle === cle) return;");
  });

  it("la lecture est refaite quand le CHEMIN change : c'est ce qui la rend fraîche", () => {
    // Un cache par session resservirait le nombre d'avant sur la page de
    // résultat, juste après l'analyse qui vient de le changer.
    expect(source).toContain("usePathname()");
    expect(source).toMatch(/useEffect\(\(\) => \{\s*charger\(chemin\);\s*\}, \[chemin\]\);/);
    // Une réponse arrivée après un changement de chemin n'est pas affichée.
    expect(source).toContain("if (magasin.cle !== cle) return;");
  });
});

// ════════════════════════ C. LE TON ═══════════════════════════════════════

describe("C — le ton change avec le solde, et le seuil n'est pas dans un composant", () => {
  it("le seuil vit dans lib/content/, et aucun composant n'écrit de nombre à sa place", () => {
    expect(SOLDE_SEUIL_BAS).toBeGreaterThan(0);
    const composant = readFileSync("components/solde-negociations.tsx", "utf8");
    expect(composant).toContain("soldeTon(");
    // Aucune comparaison chiffrée dans le composant : il ne décide pas du ton.
    expect(composant).not.toMatch(/restantes\s*[<>]=?\s*\d/);
  });

  it("solde confortable : discret", () => {
    expect(soldeTon(SOLDE_SEUIL_BAS + 1)).toBe("discret");
    expect(soldeTon(30)).toBe("discret");
    expect(soldeTexte(12, null)).toBe("12 négociations restantes");
  });

  it("le ton d'alerte ne démarre PAS au solde confortable", () => {
    // La mutation à tuer : faire monter le ton dès le confort. Quelqu'un qui a
    // de la marge n'a aucune raison de rationner.
    for (const restantes of [SOLDE_SEUIL_BAS + 1, 5, 12, 30]) expect(soldeTon(restantes), String(restantes)).toBe("discret");
  });

  it("UN STOCK INTACT N'EST PAS UN STOCK BAS — relevé à l'écran, pas déduit", async () => {
    // Le défaut mesuré dans le navigateur : une visiteuse qui arrive a
    // exactement FREE_ANALYSES négociation, soit le seuil bas, et lisait
    // « c'est ta dernière » avant d'avoir commencé. C'est la personne la plus
    // importante du produit.
    expect(FREE_ANALYSES).toBeLessThanOrEqual(SOLDE_SEUIL_BAS);
    const neuf = await analysisBalance(null, null);
    expect(neuf.intact).toBe(true);
    expect(soldeTon(neuf.restantes, neuf.intact)).toBe("discret");
    // Et la phrase s'annonce comme une offre, pas comme un reste.
    const phrase = soldeTexte(neuf.restantes, neuf.rechargeLe, neuf.intact);
    expect(phrase).toContain("offerte");
    expect(phrase).not.toContain("dernière");
    expect(soldeBadge(neuf.restantes, neuf.intact)).toBe("1 négociation offerte");
  });

  it("dès qu'une négociation est dépensée, le stock n'est plus intact", async () => {
    db.free = [{ used: FREE_ANALYSES }];
    expect((await analysisBalance(null, JETON)).intact).toBe(false);
    // Et une réserve achetée n'est jamais « intacte » : son stock d'origine
    // n'est stocké nulle part, donc à une négociation de la fin elle est basse.
    db.credits = [{ plan: "pack", balance: 1, period_end: null }];
    const pack = await analysisBalance(USER, null);
    expect(pack.intact).toBe(false);
    expect(soldeTon(pack.restantes, pack.intact)).toBe("bas");
  });

  it("solde bas : le ton monte UNE fois, sans compte à rebours ni urgence fabriquée", () => {
    expect(soldeTon(SOLDE_SEUIL_BAS)).toBe("bas");
    const phrase = soldeTexte(SOLDE_SEUIL_BAS, null);
    expect(phrase).toContain("1 négociation");
    for (const mot of ["vite", "dernière chance", "attention", "urgent", "plus que", "il ne te reste plus que", "!"]) {
      expect(phrase.toLowerCase(), mot).not.toContain(mot);
    }
  });

  it("solde bas avec une recharge : la phrase dit la date, pas un décompte de jours", () => {
    const phrase = soldeTexte(1, new Date("2026-11-03T00:00:00Z"));
    expect(phrase).toContain("3 novembre");
    expect(phrase).not.toMatch(/\bjours?\b/);
  });

  it("zéro avec recharge : la phrase dit ce qui se passe ensuite, et quand", () => {
    expect(soldeTon(0)).toBe("zero");
    const phrase = soldeTexte(0, new Date("2026-11-03T00:00:00Z"));
    expect(phrase).toContain("3 novembre");
    expect(phrase).toContain("recharge");
  });

  it("zéro sans recharge : la phrase dit le chemin pour en avoir plus", () => {
    const phrase = soldeTexte(0, null);
    expect(phrase).toContain("tarifs");
    // Jamais un « 0 » sec, ni un mur sans explication.
    expect(phrase).not.toMatch(/^0\b/);
    expect(phrase.length).toBeGreaterThan(30);
  });

  it("aucun état ne produit un « 0 » sec, à l'écran comme dans l'en-tête", () => {
    for (const phrase of [soldeTexte(0, null), soldeTexte(0, new Date()), soldeBadge(0)]) {
      expect(phrase, phrase).not.toContain("0 négociation");
    }
  });

  it("palier sans plafond : le mot est « illimité », pas un nombre inventé ni un tiret", () => {
    expect(soldeTexte(null, null)).toBe(SOLDE_ILLIMITE);
    expect(soldeBadge(null)).toBe(SOLDE_ILLIMITE);
    expect(SOLDE_ILLIMITE.toLowerCase()).toContain("illimité");
    expect(soldeTon(null)).toBe("discret");
    expect(soldeBadge(null)).not.toContain("—");
  });

  it("le ton de la route voyage avec le solde : le composant ne le devine pas", () => {
    const composant = readFileSync("components/solde-negociations.tsx", "utf8");
    // Le composant transmet « intact », il ne le reconstitue pas depuis un
    // nombre : lui seul ne peut pas savoir si quelque chose a été dépensé.
    expect(composant).toContain("soldeTon(solde.restantes, solde.intact)");
    expect(composant).toContain("value.intact === true");
    expect(readFileSync("app/api/solde/route.ts", "utf8")).toContain("intact: solde.intact");
  });

  it("le pluriel est juste à 0 comme à 1 comme au-delà", () => {
    expect(soldeBadge(1)).toBe("1 négociation restante");
    expect(soldeBadge(2)).toBe("2 négociations restantes");
    expect(soldeTexte(1, null)).toContain("1 négociation,");
    expect(soldeTexte(2, null)).toBe("2 négociations restantes");
  });

  it("la pastille montre le nombre d'abord et garde une destination à zéro", () => {
    expect(soldePastille(3, false)).toMatchObject({ nombre: "3", libelle: "négociations restantes", href: "/compte" });
    expect(soldePastille(0, false)).toMatchObject({ nombre: "0", libelle: "Recharger", href: "/tarifs" });
    expect(soldePastille(null, false)).toMatchObject({ nombre: "∞", href: "/compte" });
  });
});

// ════════════════════════ E. LE VOCABULAIRE ═══════════════════════════════

describe("E — le vocabulaire des missions #093 et #174-#178 est respecté", () => {
  const phrases = [
    soldeTexte(0, null),
    soldeTexte(0, new Date()),
    soldeTexte(1, null),
    soldeTexte(1, new Date()),
    soldeTexte(12, null),
    soldeTexte(null, null),
    soldeBadge(0),
    soldeBadge(1),
    soldeBadge(12),
    soldeBadge(null),
  ];

  it("ni « score », ni « note », ni « crédit » : l'unité vendue est la négociation", () => {
    for (const phrase of phrases) {
      expect(phrase, phrase).not.toMatch(/\bscores?\b/i);
      // « noté » ne contient pas « note » : le motif cherche le mot.
      expect(phrase, phrase).not.toMatch(/\bnotes?(?![a-zà-ÿ])/i);
      expect(phrase, phrase).not.toMatch(/\bcrédits?\b/i);
      expect(phrase, phrase).not.toMatch(/\/100/);
    }
  });

  it("tous les libellés partent de lib/content/labels.ts, aucun du JSX", () => {
    const composant = readFileSync("components/solde-negociations.tsx", "utf8");
    // Aucune chaîne française en dur dans le composant : tout vient des
    // fonctions de libellé.
    const dur = [...composant.matchAll(/>\s*([A-ZÀ-Ý][a-zà-ÿ]{3,}[^<{]*)</g)].map((m) => m[1].trim());
    expect(dur).toEqual([]);
  });
});

// ═══════════════ B. OÙ ÇA S'AFFICHE, ET OÙ ÇA NE S'AFFICHE PAS ════════════

describe("B — les deux surfaces, et seulement elles", () => {
  it("le solde est dans l'en-tête bureau et dans la barre basse mobile", () => {
    const nav = readFileSync("components/header-nav.tsx", "utf8");
    const barre = readFileSync("components/mobile-analyze-bar.tsx", "utf8");
    expect(nav.split("<SoldeEntete")).toHaveLength(2);
    expect(barre).toContain("<SoldeEntete compact");
  });

  it("l'écran de saisie le porte au-dessus du champ", () => {
    const saisie = readFileSync("components/deal-input.tsx", "utf8");
    expect(saisie).toContain("<SoldeLigne />");
    // Et pas en même temps que le refus : le refus dit déjà tout.
    expect(saisie).toContain("<NoRightNotice message={right.message} offerSignIn={right.offerSignIn} /> : <SoldeLigne />");
  });

  it("/historique garde son compteur d'analyses FAITES et ne reçoit PAS le solde", () => {
    const vue = readFileSync("components/account/history-view.tsx", "utf8");
    expect(vue).toContain("data-compteur-analyses");
    expect(vue).not.toContain("Solde");
    expect(vue).not.toContain("soldeTexte");
    expect(readFileSync("app/historique/page.tsx", "utf8")).not.toContain("analysisBalance");
  });
});

// ═════════════ A. /compte cesse de contredire le reste ════════════════════

describe("A — un seul endroit dit ce qu'il reste", () => {
  const vue = (restantes: number | null | "illisible") =>
    renderToStaticMarkup(
      <AccountView
        data={{
          email: "camille@exemple.test",
          summary: {
            plan: "pro",
            planLabel: "Pro",
            balance: 0,
            periodEnd: null,
            accessEndsAt: null,
            canCancel: false,
            accessSource: "subscription",
          },
          solde: restantes === "illisible" ? "illisible" : { restantes, rechargeLe: null, intact: false },
        }}
      />,
    );

  it("un abonné avec du quota ne lit plus 0 : la ligne montre le solde réel", () => {
    // Avant la #182 : « Négociations restantes » affichait credits.balance,
    // donc 0 pour un abonné qui en avait 28 devant lui.
    const html = vue(28);
    expect(html).toContain("28 négociations");
    expect(html).not.toMatch(/data-restantes[^>]*>0</);
  });

  it("lecture impossible : un tiret, jamais un zéro inventé", () => {
    expect(vue("illisible")).toMatch(/data-restantes[^>]*>—</);
  });

  it("aucun plafond : le mot, pas un tiret", () => {
    expect(vue(null)).toContain(SOLDE_ILLIMITE);
  });

  it("la page ne lit plus credits.balance pour cette ligne", () => {
    const page = readFileSync("app/compte/page.tsx", "utf8");
    expect(page).toContain("analysisBalanceFrom(user, credits ?? null, adminGrant, freeCounter)");
    expect(readFileSync("components/account/account-view.tsx", "utf8")).not.toContain("summary.balance");
  });

  it("le solde ne vient JAMAIS d'un comptage de lignes d'analyses côté affichage", () => {
    // La mutation à tuer. Les deux surfaces et la page de compte passent par
    // la fonction du moteur ; aucune ne compte de lignes pour son compte.
    for (const fichier of [
      "components/solde-negociations.tsx",
      "app/api/solde/route.ts",
      "app/compte/page.tsx",
      "components/account/account-view.tsx",
    ]) {
      const source = readFileSync(fichier, "utf8");
      expect(source, fichier).not.toContain('countRows("analyses"');
      expect(source, fichier).not.toContain('countRows("deals"');
      expect(source, fichier).not.toContain("rows.length");
    }
    // Et la seule lecture du quota d'abonnement reste celle du moteur.
    const moteur = readFileSync("lib/billing/entitlement.ts", "utf8");
    expect(moteur.split("analysesInPeriod(")).toHaveLength(6);
  });
});
