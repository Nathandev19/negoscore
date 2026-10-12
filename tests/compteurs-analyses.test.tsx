import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mission #181, partie C — COMBIEN D'ANALYSES EXISTENT, ET CE QU'IL EN RESTE.
//
// Deux écrans, deux questions. /admin répond « qu'est-ce que contient
// vraiment la table » : cinq nombres dont quatre forment une partition, pour
// qu'aucune soustraction ne tombe à côté. /historique répond « combien en
// ai-je », sobrement, avec un vocabulaire contraint : les missions #174 à
// #178 ont retiré la note sur 100 de tous ces écrans, et les mots qui la
// nommaient avec elle.

// ─── La table, simulée ligne par ligne ─────────────────────────────────────
type Ligne = { environment: string; internal: boolean };
const table = vi.hoisted(() => ({ lignes: [] as Array<{ environment: string; internal: boolean }>, fail: false }));

vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/server")>();
  return {
    ...actual,
    // Un vrai filtre PostgREST, appliqué aux lignes : si un seau est écrit de
    // travers, il compte autre chose, et la somme ne tombe plus.
    countRows: async (_table: string, query: string) => {
      if (table.fail) throw new actual.SupabaseRequestError("colonne absente", 400, "42703");
      const conditions = query
        .split("&")
        .filter((part) => !part.startsWith("select="))
        .map((part) => {
          const [champ, valeur] = part.split("=");
          const [operateur, attendu] = [valeur.slice(0, valeur.indexOf(".")), valeur.slice(valeur.indexOf(".") + 1)];
          return (ligne: Ligne) => {
            const lu = champ === "internal" ? ligne.internal : ligne.environment;
            if (operateur === "eq") return String(lu) === attendu;
            if (operateur === "neq") return String(lu) !== attendu;
            if (operateur === "is") return lu === (attendu === "true");
            throw new Error(`opérateur inconnu : ${operateur}`);
          };
        });
      return table.lignes.filter((ligne) => conditions.every((test) => test(ligne))).length;
    },
    rpc: async () => ({ total: 0, items: [] }),
  };
});

const { ANALYSES_COUNT_LABELS, analysesNotice, loadAdminAnalyses, loadAnalysesCounts } = await import("@/lib/admin/data");
const { analysesCount, analysesCountTruncated } = await import("@/lib/content/labels");
const { HistoryView } = await import("@/components/account/history-view");
const { default: AdminAnalyses } = await import("@/app/admin/analyses/page");

beforeEach(() => {
  table.lignes = [];
  table.fail = false;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// Un échantillon qui touche les quatre seaux, et les cas limites de chacun.
function echantillon() {
  table.lignes = [
    // Exploitable : la production de quelqu'un d'autre que moi.
    ...Array.from({ length: 6 }, () => ({ environment: "production", internal: false })),
    // Interne : production, mais mon compte ou mes appareils.
    ...Array.from({ length: 3 }, () => ({ environment: "production", internal: true })),
    // Hors production.
    { environment: "preview", internal: false },
    { environment: "development", internal: false },
    { environment: "test", internal: true },
    // Et l'historique d'avant la migration 20260924000031.
    ...Array.from({ length: 4 }, () => ({ environment: "unknown", internal: false })),
    { environment: "unknown", internal: true },
  ];
}

describe("les cinq nombres du cockpit", () => {
  it("les quatre seaux forment une PARTITION : leur somme vaut le brut", async () => {
    echantillon();
    const c = await loadAnalysesCounts();
    expect(c.brut).toBe(17);
    expect(c.inconnu + c.horsProduction + c.internes + c.exploitable).toBe(c.brut);
  });

  it("chaque seau compte ce qu'il annonce, et rien d'autre", async () => {
    echantillon();
    expect(await loadAnalysesCounts()).toEqual({
      brut: 17,
      // Production ET interne. Les lignes internes des autres environnements
      // sont comptées comme hors production ou inconnues : une ligne ne peut
      // pas être dans deux seaux.
      internes: 3,
      horsProduction: 3,
      inconnu: 5,
      exploitable: 6,
    });
  });

  it("une ligne interne hors production ne se compte pas deux fois", async () => {
    table.lignes = [{ environment: "preview", internal: true }];
    const c = await loadAnalysesCounts();
    expect(c.internes).toBe(0);
    expect(c.horsProduction).toBe(1);
    expect(c.inconnu + c.horsProduction + c.internes + c.exploitable).toBe(c.brut);
  });

  it("une ligne « unknown » n'est PAS comptée dans hors production : elle a son propre nombre", async () => {
    // C'était le recouvrement de #131 : « hors production » comptait aussi
    // l'historique, et plus aucune soustraction ne tombait juste.
    table.lignes = [{ environment: "unknown", internal: false }];
    const c = await loadAnalysesCounts();
    expect(c.inconnu).toBe(1);
    expect(c.horsProduction).toBe(0);
  });

  it("table vide : cinq zéros, et la somme tient encore", async () => {
    const c = await loadAnalysesCounts();
    expect(c).toEqual({ brut: 0, internes: 0, horsProduction: 0, inconnu: 0, exploitable: 0 });
  });

  it("colonnes absentes (migrations pas encore passées) : zéro, et aucun écran cassé", async () => {
    table.fail = true;
    expect(await loadAnalysesCounts()).toEqual({ brut: 0, internes: 0, horsProduction: 0, inconnu: 0, exploitable: 0 });
  });

  it("les cinq libellés sont là, dans l'ordre, et le dernier est celui qui compte", () => {
    expect(ANALYSES_COUNT_LABELS.map((l) => l.cle)).toEqual(["brut", "internes", "horsProduction", "inconnu", "exploitable"]);
    expect(ANALYSES_COUNT_LABELS.at(-1)?.label).toBe("Reste exploitable");
    // Chacun dit ce qu'il contient : un nombre sans définition ne se lit pas.
    for (const { label, aide } of ANALYSES_COUNT_LABELS) expect(aide.length, label).toBeGreaterThan(10);
  });

  it("la ligne sous la liste dit le reste exploitable ET le brut, sans les mélanger", async () => {
    echantillon();
    const page = await loadAdminAnalyses(1);
    expect(page).not.toBe("missing");
    if (page === "missing") return;
    const notice = analysesNotice(page);
    expect(notice).toContain("6 analyse(s) sur 17 enregistrée(s)");
    expect(page.counts).toBeDefined();
  });

  it("sans les compteurs, la ligne ne fabrique aucun chiffre", () => {
    expect(analysesNotice({ total: 0, items: [] })).toBe("Production uniquement, hors analyses internes.");
  });
});

describe("les cinq nombres sont À L'ÉCRAN, pas seulement calculés", () => {
  // La mutation 14 de la batterie avait survécu : les seaux étaient
  // verrouillés, le BLOC qui les montre ne l'était pas. Un nombre juste que
  // personne ne voit ne répond à aucune question.
  it("/admin/analyses rend les cinq libellés et les cinq valeurs", async () => {
    echantillon();
    const html = renderToStaticMarkup(await AdminAnalyses({ searchParams: Promise.resolve({}), params: Promise.resolve({}) }));
    const lu = texte(html);
    for (const { label } of ANALYSES_COUNT_LABELS) expect(lu, label).toContain(label);
    // Les valeurs de l'échantillon, dans l'ordre des libellés.
    expect(lu).toContain("Analyses enregistrées 17");
    expect(lu).toContain("Dont internes 3");
    expect(lu).toContain("Dont hors production 3");
    expect(lu).toContain("Dont environnement inconnu 5");
    expect(lu).toContain("Reste exploitable 6");
  });

  it("table vide : le bloc est là quand même, avec ses cinq zéros", async () => {
    const lu = texte(renderToStaticMarkup(await AdminAnalyses({ searchParams: Promise.resolve({}), params: Promise.resolve({}) })));
    expect(lu).toContain("Analyses enregistrées 0");
    expect(lu).toContain("Reste exploitable 0");
  });
});

describe("le compteur de l'historique", () => {
  it("zéro se dit « Aucune analyse », jamais « 0 analyse »", () => {
    expect(analysesCount(0)).toBe("Aucune analyse enregistrée pour l'instant.");
    expect(analysesCount(0)).not.toContain("0 analyse");
    // Un nombre négatif n'existe pas, mais s'il arrivait il ne doit pas
    // produire « -1 analyses ».
    expect(analysesCount(-3)).toBe(analysesCount(0));
  });

  it("un se dit au singulier, deux et plus au pluriel", () => {
    expect(analysesCount(1)).toBe("1 analyse enregistrée.");
    expect(analysesCount(2)).toBe("2 analyses enregistrées.");
    expect(analysesCount(140)).toBe("140 analyses enregistrées.");
  });

  it("aucune de ces phrases ne ramène le vocabulaire retiré en #174-#178", () => {
    const phrases = [0, 1, 2, 140].map(analysesCount).concat(analysesCountTruncated(140, 100));
    for (const phrase of phrases) {
      expect(phrase, phrase).not.toMatch(/\bscores?\b/i);
      // « noté » ne contient pas « note » (n-o-t-é) : le motif cherche le
      // mot, pas la racine.
      expect(phrase, phrase).not.toMatch(/\bnotes?(?![a-zà-ÿ])/i);
      expect(phrase, phrase).not.toMatch(/\/100/);
    }
  });

  it("liste tronquée : le compteur dit le vrai total, et dit que la liste est plus courte", () => {
    const phrase = analysesCountTruncated(140, 100);
    expect(phrase).toContain("140 analyses enregistrées.");
    expect(phrase).toContain("100 plus récentes");
  });
});

// ─── Ce que l'écran affiche vraiment ──────────────────────────────────────
function ligne(id: string) {
  return {
    id,
    created_at: "2026-10-12T15:50:00.000Z",
    score: 62,
    band: "fair",
    amount: 300,
    evaluability: "priced",
    tier: "starter",
    rateTable: "fr-2026.4",
  };
}

const texte = (html: string) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/&apos;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

describe("l'historique, à l'écran", () => {
  it("le compteur est en tête de liste, et il dit le nombre réel", () => {
    const html = renderToStaticMarkup(<HistoryView rows={[ligne("a"), ligne("b")]} total={2} />);
    expect(html).toContain("data-compteur-analyses");
    expect(texte(html)).toContain("2 analyses enregistrées.");
  });

  it("une seule analyse : singulier", () => {
    expect(texte(renderToStaticMarkup(<HistoryView rows={[ligne("a")]} total={1} />))).toContain("1 analyse enregistrée.");
  });

  it("aucune : la phrase est juste, et le lien pour commencer reste", () => {
    const html = renderToStaticMarkup(<HistoryView rows={[]} total={0} />);
    const lu = texte(html);
    expect(lu).toContain("Aucune analyse enregistrée pour l'instant.");
    expect(lu).not.toContain("0 analyse");
    // Et le fait n'est pas dit deux fois.
    expect(lu.match(/Aucune analyse/g)).toHaveLength(1);
    expect(html).toContain('href="/analyse"');
  });

  it("comptage impossible : AUCUN nombre, et l'écran vide redevient explicite", () => {
    const html = renderToStaticMarkup(<HistoryView rows={[]} total={null} />);
    expect(html).not.toContain("data-compteur-analyses");
    // Le repli n'est pas un zéro inventé : c'est la phrase d'avant.
    expect(texte(html)).toContain("Aucune analyse pour l'instant.");
  });

  it("plus de 100 analyses : le compteur dit le vrai nombre, et pourquoi la liste est plus courte", () => {
    const rows = Array.from({ length: 100 }, (_, i) => ligne(`a${i}`));
    const lu = texte(renderToStaticMarkup(<HistoryView rows={rows} total={140} />));
    expect(lu).toContain("140 analyses enregistrées.");
    expect(lu).toContain("100 plus récentes");
  });

  it("pendant le chargement : pas de chiffre avant les lignes", () => {
    expect(renderToStaticMarkup(<HistoryView rows={null} total={12} />)).not.toContain("data-compteur-analyses");
  });

  it("la page lit le total sous l'identité de la personne, pas avec la clé de service", () => {
    const page = readFileSync("app/historique/page.tsx", "utf8");
    expect(page).toContain('countRowsAsUser(token, "analyses", "select=id")');
    // Et un comptage qui échoue ne casse pas la page.
    expect(page).toContain(".catch(() => null)");
    // La clé de service n'entre pas sur cette page.
    expect(page).not.toContain("countRows(");
  });

  it("le comptage sous identité passe par une requête HEAD : aucune ligne transférée", () => {
    const source = readFileSync("lib/supabase/as-user.ts", "utf8");
    expect(source).toContain('method: "HEAD"');
    expect(source).toContain('Prefer: "count=exact"');
    // Jeton de la personne, jamais la clé de service.
    expect(source).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
  });
});
