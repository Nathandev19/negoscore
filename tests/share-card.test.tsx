import { beforeEach, describe, expect, it, vi } from "vitest";
import sample from "@/lib/fixtures/analysis-legacy-1.0.json";
import { PREVIEW_STATES, previewAnalysis } from "@/lib/fixtures/preview-states";
import { analysisSchema } from "@/lib/schema";

// LA CARTE PARTAGEABLE : contenu fermé (aucune donnée personnelle, pas le nom
// de la marque) et accès réservé au propriétaire de l'analyse.
//
// Mission #169 — ce fichier vérifiait la carte de la #064 et sa route
// /analyse/resultat/[id]/carte. Les deux ont disparu ; les règles d'accès,
// elles, n'ont pas changé d'un pouce et sont ici reportées telles quelles sur
// /api/carte/[id]. Un test qui disparaît avec une route est une régression,
// pas un nettoyage.
//
// CE QUI A CHANGÉ, et c'est volontaire :
//   - il n'y a plus de paramètre d'adresse du tout. Le niveau de calcul est
//     lu dans l'analyse enregistrée (payload->>profile_tier), plus passé en
//     « ?niveau= ». La question « un paramètre peut-il élargir l'accès ? » ne
//     se pose donc plus, et un test le verrouille quand même ;
//   - la réponse n'est plus une pièce jointe : la carte s'affiche d'abord,
//     et c'est le navigateur qui la télécharge au second clic (#165).
//     « jamais de cache partagé » reste vérifié.

const db = vi.hoisted(() => ({
  analyses: [] as Array<{ id: string; userId: string | null; anonToken: string | null; payload: Record<string, unknown> }>,
  requetes: [] as string[],
}));
const user = vi.hoisted(() => ({ current: null as { id: string; email: string } | null }));
const rendu = vi.hoisted(() => ({ calls: 0 }));

// Le mock rend ce que PostgREST rendrait pour la projection demandée : il
// APPLIQUE les filtres. Sans ça, le test ne vérifierait pas l'accès, il
// vérifierait seulement que la route ne plante pas.
vi.mock("@/lib/supabase/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/server")>()),
  selectRows: async (table: string, query: string) => {
    db.requetes.push(`${table}?${query}`);
    if (table !== "analyses") return [];
    const id = decodeURIComponent(/[?&]id=eq\.([^&]+)/.exec(query)?.[1] ?? "");
    const parUser = decodeURIComponent(/deal\.user_id=eq\.([^&]+)/.exec(query)?.[1] ?? "");
    const parJeton = decodeURIComponent(/deal\.anon_token=eq\.([^&]+)/.exec(query)?.[1] ?? "");
    const ligne = db.analyses.find(
      (a) => a.id === id && ((parUser !== "" && a.userId === parUser) || (parJeton !== "" && a.anonToken === parJeton)),
    );
    return ligne ? [projection(ligne.payload)] : [];
  },
}));
vi.mock("@/lib/auth/request-user", async () => (await import("./helpers/request-session")).requestSessionMock(() => user.current));

// Le rendu PNG lui-même est vérifié par tests/carte-rendu.test.tsx ; ici, on
// vérifie QUI y a accès. On compte les rendus pour qu'un refus qui dessinerait
// quand même la carte soit visible.
vi.mock("next/og", () => ({
  ImageResponse: class {
    status = 200;
    headers: Headers;
    constructor(_element: unknown, options: { headers?: Record<string, string> }) {
      rendu.calls += 1;
      this.headers = new Headers({ "Content-Type": "image/png", ...(options.headers ?? {}) });
    }
  },
}));

const { GET } = await import("@/app/api/carte/[id]/route");
const { CARTE_COLONNES } = await import("@/lib/share-card/verdict-data");
const { verdictCardAvailable, verdictCardTexts } = await import("@/lib/share-card/verdict-card");
const { carteDeLAnalyse } = await import("@/lib/share-card/verdict-data");

const ANON_ID = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_ID = "22222222-2222-4222-8222-222222222222";
const MISSING_ID = "44444444-4444-4444-8444-444444444444";
const OWNER_TOKEN = "jeton-du-navigateur-auteur";

// Analyse chargée de données personnelles et du nom de la marque, pour
// vérifier qu'aucune n'atteint la carte.
const SENSITIVE = {
  brand: "Maison Ortie",
  person: "Camille Durand",
  email: "camille@ortie.fr",
};

function sensitiveAnalysis() {
  const base = analysisSchema.parse(sample);
  return {
    ...base,
    deal: {
      ...base.deal,
      brand: SENSITIVE.brand,
      deliverables: [{ type: "video" as const, platform: "tiktok" as const, quantity: 2, format: `Pour ${SENSITIVE.brand}, contact ${SENSITIVE.email}` }],
      termination: `Résiliation par ${SENSITIVE.person}`,
      governing_law: SENSITIVE.email,
    },
    good_points: [{ label: `Merci ${SENSITIVE.person}`, why: SENSITIVE.email }],
    red_flags: [{ label: `${SENSITIVE.brand} impose tout`, severity: "high" as const, why: SENSITIVE.person }],
    ready_to_send_message: { tone: "cordial", text: `Bonjour ${SENSITIVE.person}, ${SENSITIVE.brand}` },
  };
}

// La projection de CARTE_COLONNES, appliquée à un payload : exactement ce que
// PostgREST renverrait, et RIEN DE PLUS. Si la route lisait un champ qui n'est
// pas dans la liste auditée, il serait `undefined` ici.
function projection(payload: Record<string, unknown>): Record<string, unknown> {
  const lire = (chemin: string): unknown =>
    chemin.split(/->>?/).reduce<unknown>((valeur, clef) => (valeur as Record<string, unknown> | null)?.[clef], { payload });
  const row: Record<string, unknown> = {};
  for (const colonne of CARTE_COLONNES) {
    const [alias, chemin] = colonne.includes(":") ? colonne.split(/:([\s\S]*)/) : [colonne, null];
    row[alias] = chemin === null ? (payload as Record<string, unknown>)[alias] : lire(chemin);
  }
  return row;
}

beforeEach(() => {
  db.analyses = [];
  db.requetes = [];
  user.current = null;
  rendu.calls = 0;
  const payload = { ...sensitiveAnalysis(), rate_table_version: "fr-2026.1" } as unknown as Record<string, unknown>;
  db.analyses.push({ id: ANON_ID, userId: null, anonToken: OWNER_TOKEN, payload });
  db.analyses.push({ id: ACCOUNT_ID, userId: "user-a", anonToken: null, payload });
});

function get(id: string, cookie: string | null, query = "") {
  return GET(new Request(`http://localhost:3000/api/carte/${id}${query}`, { headers: cookie ? { cookie } : {} }), {
    params: Promise.resolve({ id }),
  });
}

describe("contenu de la carte", () => {
  it("ni le nom de la marque, ni un nom, ni un email : même quand l'analyse en contient partout", () => {
    const texts = verdictCardTexts(carteDeLAnalyse(sensitiveAnalysis()));
    const text = Object.values(texts).join(" | ");
    for (const value of Object.values(SENSITIVE)) expect(text).not.toContain(value);
    expect(text).not.toMatch(/@/);
  });

  it("rien d'autre que ce que la carte annonce : montant, fourchette, verdict, offre, barème et niveau", () => {
    const texts = verdictCardTexts(carteDeLAnalyse(sensitiveAnalysis()));
    expect(Object.keys(texts).sort()).toEqual(["aConfirmer", "bareme", "offre", "pied", "propose", "proposeLabel", "vaut", "verdict"]);
    expect(texts.verdict).toBe("Faible");
    expect(texts.propose?.replace(/\s/g, " ")).toBe("300 €");
    expect(texts.vaut?.replace(/\s/g, " ")).toBe("510 € – 1 100 €");
    // Le champ libre « format » n'est jamais recopié.
    expect(texts.offre).toContain("2 vidéos");
    expect(texts.offre).not.toContain("TikTok");
    // Le niveau nomme une ligne de la table, jamais une personne.
    expect(texts.pied).toContain("Déjà des collabs payées");
  });

  it("pas de carte vide : ni « unpriced » ni « incomplete » ; les états chiffrés en ont une", () => {
    // Mission #116 — la règle porte sur l'ÉVALUABILITÉ, pas sur le nom de
    // l'aperçu : l'offre à commission est « unpriced » (aucun montant
    // proposé), et n'a donc pas de carte. Une carte pour une offre à
    // commission laisserait croire à un montant que le produit refuse de
    // chiffrer.
    for (const state of PREVIEW_STATES) {
      const { analysis } = previewAnalysis(state);
      const chiffrable = analysis.evaluability !== "incomplete" && analysis.evaluability !== "unpriced";
      // La carte de la #165 exige en plus un VERDICT : « terms_unknown » n'en
      // a pas, et n'a donc pas de carte là où la #064 en faisait une.
      const attendu = chiffrable && analysis.evaluability === "complete";
      expect(verdictCardAvailable(carteDeLAnalyse(analysis)), state).toBe(attendu);
    }
    expect(previewAnalysis("commission").analysis.evaluability).toBe("unpriced");
  });
});

describe("accès à la carte : même règle que la suppression", () => {
  it("un autre visiteur, avec son propre cookie : introuvable, rien n'est rendu", async () => {
    expect((await get(ANON_ID, "deal_anon_token=un-autre-navigateur")).status).toBe(404);
    expect(rendu.calls).toBe(0);
  });

  it("un visiteur sans cookie ni session, même avec l'identifiant exact : introuvable", async () => {
    expect((await get(ANON_ID, null)).status).toBe(404);
    expect(rendu.calls).toBe(0);
    // Et la base n'est même pas interrogée : rien à filtrer, rien à demander.
    expect(db.requetes).toHaveLength(0);
  });

  it("un identifiant inexistant ou mal formé : introuvable", async () => {
    expect((await get(MISSING_ID, `deal_anon_token=${OWNER_TOKEN}`)).status).toBe(404);
    expect((await get("pas-un-uuid", `deal_anon_token=${OWNER_TOKEN}`)).status).toBe(404);
    expect(rendu.calls).toBe(0);
  });

  it("une analyse rattachée à un compte : ni le cookie anonyme, ni un autre compte ne suffisent", async () => {
    expect((await get(ACCOUNT_ID, `deal_anon_token=${OWNER_TOKEN}`)).status).toBe(404);
    user.current = { id: "user-b", email: "b@example.com" };
    expect((await get(ACCOUNT_ID, null)).status).toBe(404);
    expect(rendu.calls).toBe(0);
    user.current = { id: "user-a", email: "a@example.com" };
    expect((await get(ACCOUNT_ID, null)).status).toBe(200);
  });

  it("offre sans montant (« unpriced ») : même le propriétaire n'obtient pas de carte vide", async () => {
    const base = sensitiveAnalysis();
    db.analyses = [
      {
        id: ANON_ID,
        userId: null,
        anonToken: OWNER_TOKEN,
        payload: {
          ...base,
          evaluability: "unpriced",
          score: null,
          deal: { ...base.deal, payment: { ...base.deal.payment, amount_eur: null }, in_kind_value_eur: null },
        } as unknown as Record<string, unknown>,
      },
    ];
    expect((await get(ANON_ID, `deal_anon_token=${OWNER_TOKEN}`)).status).toBe(404);
    expect(rendu.calls).toBe(0);
  });

  it("l'auteure anonyme : une image, jamais mise en cache partagé", async () => {
    const response = await get(ANON_ID, `deal_anon_token=${OWNER_TOKEN}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(rendu.calls).toBe(1);
  });
});

describe("le niveau de calcul ne passe plus par l'adresse", () => {
  it("il est lu dans l'analyse enregistrée, pas dans un paramètre", async () => {
    expect((await get(ANON_ID, `deal_anon_token=${OWNER_TOKEN}`)).status).toBe(200);
    // Une seule requête, et le niveau en est une colonne auditée.
    expect(db.requetes[0]).toContain("niveau:payload->>profile_tier");
    expect(verdictCardTexts(carteDeLAnalyse(sensitiveAnalysis())).pied).toContain("Déjà des collabs payées");
  });

  it("aucun paramètre d'adresse n'élargit l'accès ni ne change les chiffres", async () => {
    // Il n'y en a plus un seul : ce test interdit d'en réintroduire un qui
    // servirait de levier.
    expect((await get(ANON_ID, "deal_anon_token=un-autre", "?niveau=starter")).status).toBe(404);
    const avec = await get(ANON_ID, `deal_anon_token=${OWNER_TOKEN}`, "?niveau=experienced&score=100");
    expect(avec.status).toBe(200);
    const requete = db.requetes.at(-1) ?? "";
    expect(requete).not.toContain("experienced");
    expect(requete).not.toContain("score=100");
  });
});
