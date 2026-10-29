import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EVENT_PURGE_MAX_PER_RUN, EVENT_RETENTION_MONTHS, purgeCutoffs } from "@/lib/privacy/purge";

// Mission #209 quater — LES RELEVÉS D'AUDIENCE SONT ENFIN SUPPRIMÉS.
//
// Avant cette mission, aucune ligne de product_events ne l'était jamais : la
// purge n'y effaçait que trois colonnes de diagnostic. Les visites et, depuis
// la #209, les relevés de comportement en page étaient gardés indéfiniment, et
// la politique de confidentialité n'annonçait aucune durée.
//
// CE QUI EST VÉRIFIÉ ICI est ce qu'une purge peut casser de pire :
//   - supprimer une ligne qui n'est PAS échue ;
//   - supprimer autre chose que ce qu'elle annonce ;
//   - partir sans borne sur une table en retard ;
//   - annoncer une durée dans la page et en appliquer une autre.
//
// La base est un faux magasin qui HONORE LE FILTRE : un DELETE qui oublierait
// sa condition emporterait tout, et le test le verrait.

type Ligne = { id: string; occurred_at: string; table: string };

const db = vi.hoisted(() => ({
  lignes: [] as Ligne[],
  supprimes: [] as string[],
  // Toutes les requêtes vues, pour éprouver la FORME de l'opération.
  selects: [] as Array<{ table: string; query: string }>,
  deletes: [] as Array<{ table: string; filter: string }>,
}));

vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/server")>();
  return {
    ...actual,
    removeDocuments: async (paths: string[]) => paths,
    updateRows: async () => [],
    selectRows: async (table: string, query: string) => {
      db.selects.push({ table, query });
      if (table !== "product_events") return [];
      const cutoff = decodeURIComponent(query.match(/occurred_at=lt\.([^&]+)/)?.[1] ?? "");
      const limite = Number(query.match(/limit=(\d+)/)?.[1] ?? "0");
      // Sans limite de date, le faux magasin ne rend rien : c'est la façon de
      // s'assurer que le test ne valide pas une requête sans filtre.
      if (!cutoff) return [];
      // LE FAUX MAGASIN HONORE LE TRI DEMANDÉ. Écrit d'abord en triant
      // toujours du plus vieux au plus récent, il rendait la garde « les plus
      // vieilles partent d'abord » inobservable : passer la requête en
      // `desc` ne changeait rien, et la batterie de mutation l'a montré.
      const descendant = /order=occurred_at\.desc/.test(query);
      return db.lignes
        .filter((l) => l.table === "product_events" && l.occurred_at < cutoff)
        .sort((a, b) =>
          descendant ? b.occurred_at.localeCompare(a.occurred_at) : a.occurred_at.localeCompare(b.occurred_at),
        )
        .slice(0, limite)
        .map((l) => ({ id: l.id }));
    },
    deleteRowsReturning: async (table: string, filter: string) => {
      db.deletes.push({ table, filter });
      if (table !== "product_events") return [];
      const ids = filter.match(/id=in\.\(([^)]*)\)/)?.[1]?.split(",").filter(Boolean) ?? [];
      // L'ORDRE ENREGISTRÉ EST CELUI DE LA LECTURE, pas celui d'insertion.
      // Écrit d'abord en filtrant db.lignes, le double rendait la garde « les
      // plus vieilles partent d'abord » inobservable : l'ordre de la requête
      // n'atteignait jamais db.supprimes. La batterie de mutation l'a montré
      // deux fois de suite.
      const partis = ids
        .map((id) => db.lignes.find((l) => l.table === "product_events" && l.id === id))
        .filter((l): l is Ligne => l !== undefined);
      db.lignes = db.lignes.filter((l) => !partis.includes(l));
      db.supprimes.push(...partis.map((l) => l.id));
      return partis.map((l) => ({ id: l.id }));
    },
  };
});

vi.mock("@/lib/auth/login-claims", () => ({ purgeLoginClaims: async () => [] }));

const { runPurge } = await import("@/lib/privacy/purge");

const MAINTENANT = new Date("2026-10-29T03:00:00.000Z");
const moisAvant = (mois: number) => {
  const d = new Date(MAINTENANT);
  d.setUTCMonth(d.getUTCMonth() - mois);
  return d.toISOString();
};

beforeEach(() => {
  db.lignes = [];
  db.supprimes = [];
  db.selects = [];
  db.deletes = [];
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("la durée retenue", () => {
  it("13 MOIS, et la limite coupe un jour plus tôt", () => {
    expect(EVENT_RETENTION_MONTHS).toBe(13);
    // 29/10/2026 moins 13 mois = 29/09/2025 ; la limite est un jour PLUS
    // RÉCENTE, soit le 30/09/2025. Le sens est contre-intuitif : on supprime
    // ce qui est plus vieux que la limite, donc une limite plus ANCIENNE
    // ferait vivre les lignes plus longtemps. La première écriture reculait la
    // limite d'un jour et faisait donc exactement l'inverse de son intention.
    expect(purgeCutoffs(MAINTENANT).productEvents).toBe("2025-09-30T03:00:00.000Z");
    // Et une ligne pile à 13 mois est bien emportée : la durée est un plafond,
    // pas une cible à dépasser d'un jour ou deux.
    const pile = new Date(MAINTENANT);
    pile.setUTCMonth(pile.getUTCMonth() - EVENT_RETENTION_MONTHS);
    expect(pile.toISOString() < purgeCutoffs(MAINTENANT).productEvents).toBe(true);
  });

  it("la durée annoncée dans la page et celle appliquée sont la MÊME", () => {
    // Le défaut qu'on ne voit jamais : une page qui promet treize mois et un
    // code qui en garde vingt-cinq.
    const page = readFileSync("app/confidentialite/page.tsx", "utf8").replace(/\s+/g, " ");
    expect(page).toContain(`${EVENT_RETENTION_MONTHS} mois, puis les lignes sont supprimées`);
    expect(page).toContain("Statistiques d'usage, y compris les relevés de comportement sur la page d'accueil");
  });

  it("et d'où sort le chiffre est écrit dans le code", () => {
    // Un chiffre sans sa raison se fait changer par la première personne qui
    // le trouve arbitraire.
    const source = readFileSync("lib/privacy/purge.ts", "utf8");
    // Et il est écrit AVEC LE STATUT EXACT de chaque durée : 25 mois est un
    // maximum, 13 mois l'illustration d'un critère qualitatif. La première
    // écriture présentait les deux comme un « plafond CNIL », ce que la source
    // ne dit pas — un chiffre juste avec une raison fausse se fait changer
    // pour une mauvaise raison.
    expect(source).toContain("est un MAXIMUM");
    expect(source).toContain("n'est PAS un plafond");
    expect(source).toContain("ILLUSTRATION d'un critère");
    // Et ce que la source ne couvre pas est dit comme tel.
    expect(source).toContain("ne traite pas le cas où AUCUN traceur n'est déposé");
  });
});

describe("ce que la purge supprime, et ce qu'elle ne touche pas", () => {
  it("SEULES LES LIGNES ÉCHUES PARTENT, les autres restent intactes", async () => {
    db.lignes = [
      { id: "vieux-14-mois", occurred_at: moisAvant(14), table: "product_events" },
      // Exactement 13 mois : la durée annoncée est atteinte, la ligne part.
      { id: "pile-13-mois", occurred_at: moisAvant(13), table: "product_events" },
      { id: "recent-12-mois", occurred_at: moisAvant(12), table: "product_events" },
      { id: "hier", occurred_at: new Date(MAINTENANT.getTime() - 86_400_000).toISOString(), table: "product_events" },
    ];
    const rapport = await runPurge(MAINTENANT);
    expect(db.supprimes.sort()).toEqual(["pile-13-mois", "vieux-14-mois"]);
    expect(db.lignes.map((l) => l.id).sort()).toEqual(["hier", "recent-12-mois"]);
    expect(rapport.product_events).toBe(2);
    expect(rapport.product_events_plafonne).toBe(false);
  });

  it("une ligne juste SOUS la limite reste, une ligne juste AU-DESSUS part", async () => {
    const limite = new Date(purgeCutoffs(MAINTENANT).productEvents).getTime();
    db.lignes = [
      { id: "une-seconde-trop-vieille", occurred_at: new Date(limite - 1_000).toISOString(), table: "product_events" },
      { id: "une-seconde-trop-jeune", occurred_at: new Date(limite + 1_000).toISOString(), table: "product_events" },
    ];
    await runPurge(MAINTENANT);
    expect(db.supprimes).toEqual(["une-seconde-trop-vieille"]);
    expect(db.lignes.map((l) => l.id)).toEqual(["une-seconde-trop-jeune"]);
  });

  it("AUCUN DELETE NE PORTE UNE CONDITION DE DATE : il ne porte que des id", async () => {
    // C'est la forme qui protège, pas un contrôle. Un DELETE conditionnel dont
    // le filtre serait mal écrit emporterait la table ; une liste d'id ne peut
    // emporter que ce qui a été lu comme échu.
    db.lignes = [{ id: "a", occurred_at: moisAvant(20), table: "product_events" }];
    await runPurge(MAINTENANT);
    const surLesEvenements = db.deletes.filter((d) => d.table === "product_events");
    expect(surLesEvenements.length).toBeGreaterThan(0);
    for (const requete of surLesEvenements) {
      expect(requete.filter, requete.filter).toMatch(/^id=in\.\(/);
      expect(requete.filter, requete.filter).not.toContain("occurred_at");
    }
  });

  it("LA LECTURE, ELLE, PORTE TOUJOURS LA LIMITE DE DATE", async () => {
    db.lignes = [{ id: "a", occurred_at: moisAvant(20), table: "product_events" }];
    await runPurge(MAINTENANT);
    const lectures = db.selects.filter((s) => s.table === "product_events");
    expect(lectures.length).toBeGreaterThan(0);
    for (const requete of lectures) {
      expect(requete.query, requete.query).toContain("occurred_at=lt.");
      expect(requete.query, requete.query).toContain("limit=");
    }
  });

  it("elle ne touche à AUCUNE AUTRE TABLE que celles qu'elle annonce", async () => {
    db.lignes = [{ id: "a", occurred_at: moisAvant(20), table: "product_events" }];
    await runPurge(MAINTENANT);
    const annoncees = ["deal_documents", "deals", "usage_guard", "whop_events", "checkout_consents", "telemetry_salts", "negotiation_turns", "product_events"];
    for (const requete of db.deletes) expect(annoncees, requete.table).toContain(requete.table);
  });

  it("IDEMPOTENTE : un second passage ne trouve plus rien", async () => {
    db.lignes = [{ id: "a", occurred_at: moisAvant(20), table: "product_events" }];
    expect((await runPurge(MAINTENANT)).product_events).toBe(1);
    db.supprimes = [];
    expect((await runPurge(MAINTENANT)).product_events).toBe(0);
    expect(db.supprimes).toEqual([]);
  });

  it("une table vide ne produit ni erreur ni suppression", async () => {
    const rapport = await runPurge(MAINTENANT);
    expect(rapport.product_events).toBe(0);
    expect(db.deletes.filter((d) => d.table === "product_events")).toEqual([]);
  });
});

describe("le plafond par passage", () => {
  it("UNE TABLE EN RETARD SE RATTRAPE EN PLUSIEURS NUITS, pas en une rafale", async () => {
    // product_events n'a jamais été purgée : le premier passage après cette
    // mission est le seul qui puisse trouver beaucoup de lignes d'un coup.
    db.lignes = Array.from({ length: EVENT_PURGE_MAX_PER_RUN + 350 }, (_, i) => ({
      id: `l${i}`,
      occurred_at: moisAvant(20),
      table: "product_events",
    }));
    const rapport = await runPurge(MAINTENANT);
    expect(rapport.product_events).toBe(EVENT_PURGE_MAX_PER_RUN);
    expect(rapport.product_events_plafonne).toBe(true);
    expect(db.lignes).toHaveLength(350);
  });

  it("le passage suivant termine le travail, et ne se dit plus plafonné", async () => {
    db.lignes = Array.from({ length: EVENT_PURGE_MAX_PER_RUN + 350 }, (_, i) => ({
      id: `l${i}`,
      occurred_at: moisAvant(20),
      table: "product_events",
    }));
    await runPurge(MAINTENANT);
    const second = await runPurge(MAINTENANT);
    expect(second.product_events).toBe(350);
    expect(second.product_events_plafonne).toBe(false);
    expect(db.lignes).toEqual([]);
  });

  it("le rapport DIT qu'il reste du travail : sans ça, personne ne le saurait", async () => {
    db.lignes = Array.from({ length: EVENT_PURGE_MAX_PER_RUN + 1 }, (_, i) => ({
      id: `l${i}`,
      occurred_at: moisAvant(20),
      table: "product_events",
    }));
    expect((await runPurge(MAINTENANT)).product_events_plafonne).toBe(true);
  });

  it("les plus VIEILLES partent d'abord", async () => {
    // Si le plafond est atteint, ce qui reste doit être ce qui a le moins
    // dépassé la durée.
    db.lignes = [
      { id: "tres-vieux", occurred_at: moisAvant(30), table: "product_events" },
      { id: "vieux", occurred_at: moisAvant(20), table: "product_events" },
      { id: "juste-echu", occurred_at: moisAvant(14), table: "product_events" },
    ];
    await runPurge(MAINTENANT);
    expect(db.supprimes).toEqual(["tres-vieux", "vieux", "juste-echu"]);
  });
});

describe("la portée explicite", () => {
  it("une portée vide n'autorise AUCUNE suppression", async () => {
    // Les tests d'intégration tournent sur la base de production : une
    // catégorie absente de la portée ne doit pas être purgée du tout.
    db.lignes = [{ id: "a", occurred_at: moisAvant(20), table: "product_events" }];
    const rapport = await runPurge(MAINTENANT, {});
    expect(rapport.product_events).toBe(0);
    expect(db.supprimes).toEqual([]);
  });

  it("une portée nommée restreint la lecture à ces id", async () => {
    db.lignes = [{ id: "a", occurred_at: moisAvant(20), table: "product_events" }];
    await runPurge(MAINTENANT, { productEventIds: ["a"] });
    const lectures = db.selects.filter((s) => s.table === "product_events");
    expect(lectures.length).toBeGreaterThan(0);
    for (const requete of lectures) expect(requete.query).toContain("id=in.");
  });
});

describe("une boucle qui ne peut plus avancer s'arrête", () => {
  it("UN LOT LU MAIS NON SUPPRIMÉ NE FAIT PAS TOURNER LA PURGE SANS FIN", async () => {
    // Trouvé par la batterie de mutation : en cassant le filtre de
    // suppression, la lecture rendait les mêmes lignes à chaque tour et la
    // boucle ne s'arrêtait jamais. En production, ça n'aurait rien supprimé de
    // trop — ça aurait fait tourner le cron jusqu'à ce que l'hébergeur le
    // coupe, sans rapport et sans trace.
    db.lignes = Array.from({ length: 500 }, (_, i) => ({
      id: `l${i}`,
      occurred_at: moisAvant(20),
      table: "product_events",
    }));
    // Une suppression qui ne retire rien, sans rien casser d'autre.
    const serveur = await import("@/lib/supabase/server");
    const vrai = serveur.deleteRowsReturning;
    const muet = vi.spyOn(serveur, "deleteRowsReturning").mockImplementation(async (table, filter, select) => {
      if (table === "product_events") return [];
      return vrai(table, filter, select);
    });
    try {
      const rapport = await runPurge(MAINTENANT);
      expect(rapport.product_events).toBe(0);
      expect(rapport.product_events_plafonne).toBe(false);
      // Et la purge le DIT, au lieu de s'arrêter en silence.
      expect(console.warn).toHaveBeenCalled();
      const dit = (console.warn as unknown as { mock: { calls: unknown[][] } }).mock.calls.flat().join(" ");
      expect(dit).toContain("purge_product_events_sans_progres");
    } finally {
      muet.mockRestore();
    }
  }, 20_000);
});
