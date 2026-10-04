import { readFileSync, readdirSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dateHeureParis, dateParis, FUSEAU, heureParis, instantDepuisParis, MENTION_FUSEAU } from "@/lib/admin/heure";

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
    // Mission #146 — on retire les commentaires avant de chercher. Ils citent
    // volontairement « UTC+2 » et « UTC+1 » pour expliquer POURQUOI ces
    // décalages ne sont écrits nulle part ; la règle porte sur le code exécuté,
    // comme pour le SQL de la migration plus bas.
    const execute = readFileSync("lib/admin/heure.ts", "utf8")
      .split("\n")
      .filter((ligne) => !ligne.trimStart().startsWith("//"))
      .join("\n");
    expect(execute).not.toMatch(/UTC\+|\+0[12]:00|GMT\+/);
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

// ───────────────────────────────────────────────────────────────────────────
// Mission #146 — le chemin INVERSE : une heure murale de Paris vers l'instant.
//
// Le champ « date de fin » d'un accès Pro offert est un datetime-local : il
// envoie « 2026-11-01T23:59 », sans fuseau. Le serveur le lisait avec
// Date.parse(), donc dans SON fuseau — UTC sur Vercel. Une échéance saisie
// 23:59 en pensant Paris était enregistrée une à deux heures trop tard.
describe("une heure saisie est lue comme une heure de Paris", () => {
  const iso = (valeur: string) => instantDepuisParis(valeur)?.toISOString() ?? null;

  // LE CŒUR DE LA MISSION : les deux dates ne tombent pas sur le même
  // décalage. Paris passe de UTC+2 à UTC+1 le 25 octobre 2026, en plein
  // milieu de la période du grant en cours.
  it("avant le 25 octobre : UTC+2", () => {
    expect(iso("2026-10-20T23:59")).toBe("2026-10-20T21:59:00.000Z");
  });

  it("après le 25 octobre : UTC+1", () => {
    expect(iso("2026-11-01T23:59")).toBe("2026-11-01T22:59:00.000Z");
  });

  it("lu en UTC, le même champ donnerait deux résultats faux, de deux ampleurs différentes", () => {
    // C'est l'ancien comportement : la valeur partait telle quelle, et la base
    // la castait en UTC. L'écart n'est pas constant, donc un « -1 h » ou un
    // « -2 h » écrit en dur aurait été faux la moitié de l'année.
    const ecart = (valeur: string) => (Date.parse(`${valeur}Z`) - (instantDepuisParis(valeur) as Date).getTime()) / 3_600_000;
    expect(ecart("2026-10-20T23:59")).toBe(2);
    expect(ecart("2026-11-01T23:59")).toBe(1);
  });

  it("le basculement lui-même, heure par heure", () => {
    // 25/10/2026, 03:00 d'été devient 02:00 d'hiver.
    expect(iso("2026-10-25T01:59")).toBe("2026-10-24T23:59:00.000Z");
    expect(iso("2026-10-25T03:30")).toBe("2026-10-25T02:30:00.000Z");
    // Une heure qui existe DEUX fois : on retient la première, celle d'été,
    // et elle se relit bien 02:30 à Paris.
    expect(iso("2026-10-25T02:30")).toBe("2026-10-25T01:30:00.000Z");
    expect(espaces(dateHeureParis(instantDepuisParis("2026-10-25T02:30")))).toContain("02:30");
  });

  it("une heure qui n'existe pas tombe juste après le saut, elle ne se perd pas", () => {
    // 29/03/2026 : 02:00 saute à 03:00. 02:30 n'existe pas à Paris ce jour-là.
    expect(iso("2026-03-29T02:30")).toBe("2026-03-29T01:30:00.000Z");
    expect(espaces(dateHeureParis(instantDepuisParis("2026-03-29T02:30")))).toContain("03:30");
  });

  it("ce qui n'est pas une heure murale valide ne devient jamais une date", () => {
    // Refusé, jamais deviné : l'appelant doit pouvoir distinguer « pas
    // d'échéance » de « échéance illisible ».
    for (const mauvais of ["", "   ", "n'importe quoi", "2026-10-20", "2026-13-01T10:00", "2026-10-20T25:00", "2026-02-31T10:00", null, undefined]) {
      expect(instantDepuisParis(mauvais), JSON.stringify(mauvais)).toBeNull();
    }
  });

  it("aller-retour : ce qui est saisi est ce qui se relit, été comme hiver", () => {
    for (const saisie of ["2026-01-15T12:00", "2026-07-15T12:00", "2026-10-20T23:59", "2026-11-01T23:59", "2026-12-31T23:59"]) {
      const relu = espaces(dateHeureParis(instantDepuisParis(saisie)));
      expect(relu, saisie).toContain(saisie.slice(11, 16));
      expect(relu, saisie).toContain(`${saisie.slice(8, 10)}/${saisie.slice(5, 7)}/${saisie.slice(0, 4)}`);
    }
  });

  it("aucun décalage écrit en dur : c'est la zone nommée qui répond", () => {
    const source = readFileSync("lib/admin/heure.ts", "utf8");
    const execute = source
      .split("\n")
      .filter((ligne) => !ligne.trimStart().startsWith("//"))
      .join("\n");
    expect(execute).toContain("timeZone: FUSEAU");
    // Ni « +01:00 », ni « +02:00 », ni une arithmétique d'heures en dur.
    expect(execute).not.toMatch(/\+0?[12]:00|3_?600_?000\s*\*\s*[12]\b/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Mission #151 — AUCUNE SURFACE D'ADMIN NE FORMATE UNE HEURE SANS FUSEAU.
//
// La #140 a mis /admin à l'heure de Paris, mais rien n'empêchait un nouvel
// écran d'y ramener un formateur muet : il prendrait alors le fuseau du
// serveur, UTC sur Vercel, et afficherait deux heures d'écart sans le dire.
// La règle porte sur TOUT le cockpit, pas sur un fichier.
describe("tout ce que le cockpit affiche porte un fuseau nommé", () => {
  const SURFACES = [
    ...readdirSync("components/admin").map((f) => `components/admin/${f}`),
    ...readdirSync("app/admin", { recursive: true, encoding: "utf8" }).map((f) => `app/admin/${f}`),
  ].filter((f) => /\.tsx?$/.test(f) && statSync(f).isFile());

  it("la liste des surfaces examinées n'est pas vide", () => {
    expect(SURFACES.length).toBeGreaterThan(5);
    expect(SURFACES).toContain("components/admin/feedback-report-view.tsx");
  });

  it.each(SURFACES)("%s : aucun formateur de date sans fuseau", (fichier) => {
    const source = readFileSync(fichier, "utf8");
    // Un Intl.DateTimeFormat doit déclarer son fuseau dans ses options.
    for (const bloc of source.match(/new Intl\.DateTimeFormat\([\s\S]*?\)/g) ?? []) {
      expect(bloc, `${fichier} : Intl.DateTimeFormat sans timeZone`).toContain("timeZone");
    }
    // Et les raccourcis du navigateur, qui prennent le fuseau de la machine,
    // n'ont rien à faire ici : ils rendraient l'heure du serveur.
    expect(source, `${fichier} : toLocale…String sans fuseau`).not.toMatch(
      /\.toLocale(?:Date|Time)?String\(/,
    );
  });

  it("le rapport de retours passe par le formateur commun, pas par le sien", () => {
    const source = readFileSync("components/admin/feedback-report-view.tsx", "utf8");
    expect(source).toContain("dateHeureParis");
    // Plus de formateur local : le fuseau n'est plus déclaré à deux endroits.
    expect(source).not.toContain("new Intl.DateTimeFormat");
  });
});
