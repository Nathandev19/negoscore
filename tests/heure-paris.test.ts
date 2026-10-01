import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dateHeureParis, dateParis, FUSEAU, heureParis, MENTION_FUSEAU } from "@/lib/admin/heure";

// Mission #140 — /admin affiche l'heure de Paris.
//
// Le serveur tourne en UTC. Les journaux Vercel, les DM Instagram et tout ce à
// quoi on compare une ligne du cockpit sont en heure de Paris. Deux heures
// d'écart ont produit une conclusion fausse le 01/10 : le même événement, lu
// 18:46 dans le cockpit et 20:46 dans le journal, passait pour deux.
//
// Rien ne change en base : `occurred_at` reste un instant en UTC. Seul
// l'affichage est traduit.

// Les espaces de séparation des formats français sont insécables : on les
// ramène à l'espace ordinaire avant de comparer.
const espaces = (valeur: string) => valeur.replace(/[\s  ]+/g, " ");

describe("l'heure affichée est celle de Paris", () => {
  it("un événement enregistré à 21:58 UTC s'affiche 23:58", () => {
    // Le cas exact de la mission, en heure d'été (UTC+2).
    expect(espaces(heureParis("2026-10-01T21:58:00.000Z"))).toContain("23:58");
    expect(espaces(heureParis("2026-10-01T21:58:00.000Z"))).toContain("01/10");
  });

  it("le changement d'heure est géré, dans les deux sens", () => {
    // Été : UTC+2. Hiver : UTC+1. Un décalage écrit en dur serait faux six
    // mois par an.
    expect(espaces(heureParis("2026-07-15T12:00:00.000Z"))).toContain("14:00");
    expect(espaces(heureParis("2026-01-15T12:00:00.000Z"))).toContain("13:00");
    // La nuit du passage à l'heure d'hiver 2026 : 25 octobre à 01:00 UTC.
    expect(espaces(heureParis("2026-10-25T00:30:00.000Z"))).toContain("02:30");
    expect(espaces(heureParis("2026-10-25T01:30:00.000Z"))).toContain("02:30");
  });

  it("une heure du matin à Paris reste le bon JOUR", () => {
    // 2 octobre, 00:30 à Paris = 1er octobre, 22:30 UTC. C'est le cas qui
    // faisait ranger une partie de chaque nuit la veille.
    const affiche = espaces(dateHeureParis("2026-10-01T22:30:00.000Z"));
    expect(affiche).toContain("02/10");
    expect(affiche).toContain("00:30");
  });

  it("le 31 décembre à 23:30 heure de Paris reste au 31 décembre", () => {
    // 22:30 UTC le 31 décembre.
    const affiche = espaces(dateHeureParis("2026-12-31T22:30:00.000Z"));
    expect(affiche).toContain("31/12/2026");
    expect(affiche).toContain("23:30");
    expect(espaces(dateParis("2026-12-31T22:30:00.000Z"))).toContain("31/12/2026");
  });

  it("une valeur absente ou illisible ne rend pas « Invalid Date »", () => {
    for (const formate of [heureParis, dateHeureParis, dateParis]) {
      expect(formate(null)).toBe("—");
      expect(formate(undefined)).toBe("—");
      expect(formate("pas une date")).toBe("—");
    }
  });

  it("CHAQUE formateur porte le fuseau, sans exception", () => {
    // Cette garde-ci ne dépend pas de la machine qui exécute les tests. Sur un
    // poste déjà réglé sur Paris, un formateur qui OUBLIE le fuseau rend le bon
    // résultat — et serait faux sur Vercel, qui tourne en UTC. On lit donc le
    // code, pas sa sortie.
    const source = readFileSync("lib/admin/heure.ts", "utf8");
    const formateurs = source.match(/new Intl.DateTimeFormat/g) ?? [];
    const fuseaux = source.match(/timeZone: FUSEAU/g) ?? [];
    expect(formateurs.length).toBeGreaterThanOrEqual(3);
    expect(fuseaux).toHaveLength(formateurs.length);
  });

  it("le fuseau est nommé, jamais un décalage fixe", () => {
    expect(FUSEAU).toBe("Europe/Paris");
    const source = readFileSync("lib/admin/heure.ts", "utf8");
    expect(source).not.toMatch(/UTC\+|\+0[12]:00|GMT\+/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("toutes les pages de /admin passent par le même formateur", () => {
  function pagesAdmin(dossier: string): string[] {
    const sorties: string[] = [];
    for (const entree of readdirSync(dossier, { withFileTypes: true })) {
      const chemin = `${dossier}/${entree.name}`;
      if (entree.isDirectory()) sorties.push(...pagesAdmin(chemin));
      else if (/\.tsx$/.test(entree.name)) sorties.push(chemin);
    }
    return sorties;
  }

  const PAGES = pagesAdmin("app/admin");

  it("aucune date n'est formatée avec le fuseau du serveur", () => {
    expect(PAGES.length).toBeGreaterThanOrEqual(5);
    for (const page of PAGES) {
      const source = readFileSync(page, "utf8");
      // `toLocaleString` sans fuseau rend l'heure du serveur, c'est-à-dire
      // UTC sur Vercel. C'est exactement ce qui a produit l'erreur de lecture.
      expect(source, page).not.toContain("toLocaleString");
      expect(source, page).not.toContain("toLocaleDateString");
      expect(source, page).not.toContain("toLocaleTimeString");
      // Et aucun formateur local qui oublierait le fuseau.
      expect(source, page).not.toContain("new Intl.DateTimeFormat");
    }
  });

  it("la mention « heure de Paris » est écrite, en toutes lettres", () => {
    expect(MENTION_FUSEAU).toBe("heure de Paris");
    const evenements = readFileSync("app/admin/evenements/page.tsx", "utf8");
    expect(evenements).toContain("Date et heure ({MENTION_FUSEAU})");
    // Une fois par écran qui liste des heures, pas une fois par ligne.
    expect(evenements.match(/MENTION_FUSEAU/g) ?? []).toHaveLength(2);
    for (const page of ["app/admin/analyses/page.tsx", "app/admin/users/page.tsx", "app/admin/page.tsx"]) {
      expect(readFileSync(page, "utf8"), page).toContain("MENTION_FUSEAU");
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("le regroupement par jour de la courbe", () => {
  // Il se fait en base, dans admin_dashboard_metrics. L'étiquette, elle, ne
  // traduit rien : elle affiche la date de calendrier que la RPC a décidée.
  const migration = readFileSync("supabase/migrations/20261002000037_jour_paris.sql", "utf8");

  it("la migration regroupe par jour de Paris, pas par jour UTC", () => {
    expect(migration).toContain("date_trunc('day', occurred_at at time zone 'Europe/Paris')::date as day");
    // Et plus aucune troncature sans fuseau dans le SQL EXÉCUTÉ. On retire les
    // commentaires : l'en-tête montre volontairement l'ancienne ligne, et la
    // requête de vérification compare les deux jours côte à côte.
    const execute = migration
      .split("\n")
      .filter((ligne) => !ligne.trimStart().startsWith("--"))
      .join("\n");
    expect(execute).not.toMatch(/date_trunc\('day', occurred_at\)/);
  });

  it("l'étiquette d'un jour ne retraduit pas ce que la base a décidé", () => {
    const source = readFileSync("components/admin/charts.tsx", "utf8");
    // `day` est « 2026-10-01 », une date de calendrier. La lire en heure de
    // Paris la décalerait d'un jour la moitié de l'année.
    expect(source).toContain('timeZone: "UTC"');
    expect(source).not.toContain('timeZone: "Europe/Paris"');
  });
});
