import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Mission #209 bis — LA MÊME FAUTE, CHERCHÉE DANS TOUTES LES MIGRATIONS.
//
// La migration 42 portait une sous-requête dans une contrainte CHECK, ce que
// Postgres refuse à l'exécution. tests/migrations-moteur.test.ts exécute
// vraiment le SQL et l'aurait attrapée — mais il ne peut monter que les
// migrations dont les tables tiennent sans Supabase, et son échec se produit
// dans un `beforeAll`, ce qui FAIT SAUTER tout ce qui suit dans son fichier.
//
// Cette garde-ci est donc dans un fichier à part, exprès : elle relit les
// quarante-deux migrations, elle nomme le fichier fautif, et elle tourne même
// quand le moteur n'a pas démarré.

const DOSSIER = "supabase/migrations";

describe("aucune autre migration ne cache la même faute", () => {
  const fichiers = readdirSync(DOSSIER).filter((nom) => nom.endsWith(".sql")).sort();

  it("il y a bien des migrations à relire", () => {
    expect(fichiers.length).toBeGreaterThan(40);
  });

  // Les expressions `check (…)` d'une CONTRAINTE DE TABLE, et elles seules.
  // Une politique RLS s'écrit `with check (…)` et a parfaitement le droit de
  // contenir une sous-requête — six migrations en contiennent, et elles sont
  // correctes. Les confondre produirait six faux positifs et une garde qu'on
  // finirait par désactiver.
  function contraintesDeTable(sql: string): string[] {
    const sansCommentaires = sql.replace(/^\s*--.*$/gm, "");
    const trouvees: string[] = [];
    const motif = /(^|[^h])\bcheck\s*\(/gi;
    for (const occurrence of sansCommentaires.matchAll(motif)) {
      const avant = sansCommentaires.slice(Math.max(0, occurrence.index - 12), occurrence.index + 1);
      if (/with\s*$/i.test(avant)) continue;
      // Parenthèses équilibrées depuis l'ouvrante.
      let profondeur = 0;
      const depart = occurrence.index + occurrence[0].length - 1;
      for (let i = depart; i < sansCommentaires.length; i++) {
        if (sansCommentaires[i] === "(") profondeur++;
        else if (sansCommentaires[i] === ")") {
          profondeur--;
          if (profondeur === 0) {
            trouvees.push(sansCommentaires.slice(depart, i + 1));
            break;
          }
        }
      }
    }
    return trouvees;
  }

  it("la garde sait distinguer une contrainte d'une politique RLS", () => {
    // Éprouvée sur les deux formes, sinon elle ne prouverait rien.
    expect(contraintesDeTable("alter table t add constraint c check (a in ('x'));")).toEqual(["(a in ('x'))"]);
    expect(contraintesDeTable("create policy p on t for insert with check (id = (select auth.uid()));")).toEqual([]);
    expect(contraintesDeTable("-- check (select 1)\nselect 1;")).toEqual([]);
  });

  it("AUCUNE SOUS-REQUÊTE NI FONCTION À RETOUR D'ENSEMBLE dans un CHECK de table", () => {
    // Les deux sont refusées à l'exécution, et aucune relecture du fichier ne
    // le dit. C'est la faute exacte de la migration 42.
    const interdits = /\bselect\b|\bjsonb_object_keys\b|\bjson_object_keys\b|\bunnest\b|\bgenerate_series\b|\bjsonb_array_elements\b|\bjsonb_each\b/i;
    for (const nom of fichiers) {
      for (const expression of contraintesDeTable(readFileSync(`${DOSSIER}/${nom}`, "utf8"))) {
        expect(interdits.test(expression), `${nom} : ${expression.slice(0, 120)}`).toBe(false);
      }
    }
  });

  it("UN CHECK QUI LIT UN jsonb SE PROTÈGE DU NULL", () => {
    // Une contrainte dont l'expression vaut NULL est SATISFAITE : sans
    // enveloppe, une valeur absente ou JSON `null` fait passer la ligne.
    for (const nom of fichiers) {
      for (const expression of contraintesDeTable(readFileSync(`${DOSSIER}/${nom}`, "utf8"))) {
        if (!expression.includes("->>")) continue;
        expect(
          /coalesce|is not null|is distinct from/i.test(expression),
          `${nom} : un CHECK lit du jsonb sans se protéger du NULL`,
        ).toBe(true);
      }
    }
  });
});
