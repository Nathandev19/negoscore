import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PRODUCT_EVENTS } from "@/lib/analytics/first-party";
import {
  mesure,
  nouvelEtat,
  DWELL_LABELS,
  FIRST_ACTION_VALUES,
  INPUT_TOUCHED,
  SCROLL_LABELS,
} from "@/lib/analytics/engagement";
import {
  engagementApart,
  engagementSteps,
  engagementVerdict,
  ENGAGEMENT_MIN_LISIBLE,
  type DashboardData,
  type EngagementRow,
} from "@/lib/admin/data";

// Mission #209 — LA LECTURE DU COMPORTEMENT EN PAGE.
//
// Le cockpit mesurait les ÉTAPES du funnel et rien de ce qui se passe à
// l'intérieur d'une page. Résultat : 400 visites payantes sans analyse, et
// deux explications — faux trafic, ou page qui n'appelle rien — qu'aucun
// chiffre ne pouvait séparer.
//
// CE QUI EST SURVEILLÉ ICI est ce qui rendrait la lecture FAUSSE :
//   - un entonnoir qui remonte, masqué par le bornage du taux à 100 % ;
//   - la base qui refuse le nouveau nom, ou accepte un vocabulaire ouvert ;
//   - un bloc du cockpit effacé par le « create or replace » de la fonction ;
//   - un verdict affirmé sur trop peu de données.

const MIGRATION = readFileSync("supabase/migrations/20261029000042_comportement_en_page.sql", "utf8").replace(/\r\n/g, "\n");
const SQL = MIGRATION.replace(/^\s*--.*$/gm, "");

const ligne = (patch: Partial<EngagementRow> = {}): EngagementRow => ({
  path: "/", medium: "paid_social", total: 100,
  interacted: 60, scrolled: 40, read_to_end: 10, input_touched: 3,
  under_5s: 20, idle_no_action: 5,
  ...patch,
});

describe("l'entonnoir en page est STRICTEMENT EMBOÎTÉ", () => {
  it("l'ordre vient du code de mesure : un défilement EST un geste", () => {
    // Si « a défilé » passait avant « un geste », l'entonnoir remonterait et
    // stepRate le masquerait (Math.min borne le taux à 100 %). L'ordre ici
    // n'est donc pas une préférence de lecture, c'est une contrainte.
    expect(engagementSteps(ligne()).map((s) => s.label)).toEqual([
      "Pages vues mesurées",
      "Un geste, au moins un",
      "Ont défilé",
      "Lue jusqu’au bout (90 %)",
    ]);
  });

  it("chaque étape est inférieure ou égale à la précédente, sur des lignes réalistes", () => {
    const cas: EngagementRow[] = [
      ligne(),
      ligne({ total: 353, interacted: 0, scrolled: 0, read_to_end: 0, input_touched: 0, under_5s: 353, idle_no_action: 0 }),
      ligne({ total: 40, interacted: 40, scrolled: 40, read_to_end: 40, input_touched: 0, under_5s: 0, idle_no_action: 0 }),
      ligne({ total: 0, interacted: 0, scrolled: 0, read_to_end: 0, input_touched: 0, under_5s: 0, idle_no_action: 0 }),
    ];
    for (const row of cas) {
      const valeurs = engagementSteps(row).map((s) => s.value);
      for (let i = 1; i < valeurs.length; i++) {
        expect(valeurs[i], `${JSON.stringify(row)} étape ${i}`).toBeLessThanOrEqual(valeurs[i - 1]);
      }
    }
  });

  it("CE QUI N'EST PAS EMBOÎTÉ EST RENDU À PART, jamais comme une étape", () => {
    // On peut toucher le champ sans avoir défilé : l'y glisser ferait un
    // entonnoir faux. C'est pourtant LE nombre qui tranche, donc il est écrit.
    const apart = engagementApart(ligne({ total: 100, scrolled: 10, input_touched: 30 }));
    expect(apart.map((m) => m.label)).toEqual([
      "Ont touché le champ de collage",
      "Fermées en moins de 5 s",
      "Restées ouvertes sans un geste",
    ]);
    expect(engagementSteps(ligne()).map((s) => s.label).join(" ")).not.toContain("champ");
  });

  it("chaque mesure à part porte sa part ÉCRITE, pas à déduire", () => {
    const apart = engagementApart(ligne({ total: 200, input_touched: 50, under_5s: 100, idle_no_action: 0 }));
    expect(apart[0].part).toBe("25 %");
    expect(apart[1].part).toBe("50 %");
    expect(apart[2].part).toBe("0 %");
    // Un total vide ne produit pas « 0 % de 0 ».
    expect(engagementApart(ligne({ total: 0, input_touched: 0, under_5s: 0, idle_no_action: 0 }))[0].part).toBeNull();
  });
});

describe("le verdict ne tranche pas à la place de l'éditeur", () => {
  it("TROP PEU DE DONNÉES : il le dit, il ne conclut pas", () => {
    const verdict = engagementVerdict(ligne({ total: ENGAGEMENT_MIN_LISIBLE - 1 }));
    expect(verdict).toContain("Trop peu");
    expect(verdict).toContain(String(ENGAGEMENT_MIN_LISIBLE));
    expect(verdict).not.toMatch(/faux trafic|n’appelle pas/);
  });

  it("LA SIGNATURE DU FAUX TRAFIC : fermé tout de suite, ou resté sans un geste", () => {
    const verdict = engagementVerdict(ligne({ total: 353, under_5s: 300, idle_no_action: 40, scrolled: 0, input_touched: 0 }));
    expect(verdict).toContain("aucune lecture");
    expect(verdict).toContain("d’où vient ce trafic");
  });

  it("LA SIGNATURE DE LA PAGE QUI N'APPELLE RIEN : ça défile, personne ne touche le champ", () => {
    const verdict = engagementVerdict(ligne({ total: 100, under_5s: 10, idle_no_action: 5, scrolled: 70, input_touched: 0 }));
    expect(verdict).toContain("la page n’appelle pas l’action");
  });

  it("un cas qui ne ressemble à aucun des deux ne reçoit pas de verdict inventé", () => {
    const verdict = engagementVerdict(ligne({ total: 100, under_5s: 10, idle_no_action: 5, scrolled: 70, input_touched: 25 }));
    expect(verdict).toContain("Rien de tranché");
  });
});

describe("la migration 42", () => {
  it("elle n'applique rien d'elle-même et ne détruit rien", () => {
    expect(MIGRATION).toContain("À APPLIQUER À LA MAIN");
    expect(SQL).not.toMatch(/\bdrop\s+table\b|\bdelete\s+from\b|\btruncate\b/i);
    // Elle retire des CONTRAINTES pour les redéfinir, et rien d'autre.
    for (const drop of SQL.match(/drop\s+constraint[^;]*/gi) ?? []) {
      expect(drop).toMatch(/if exists/i);
    }
  });

  it("LA BASE ADMET LE NOUVEAU NOM : sans ça, chaque relevé repart en erreur", () => {
    const blocs = [...SQL.matchAll(/check\s*\(\s*event_name\s+in\s*\(([^)]*)\)/gi)];
    expect(blocs.length).toBe(1);
    const autorises = [...blocs[0][1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    // Tous les noms du produit, pas seulement le nouveau : cette contrainte
    // REMPLACE la précédente, donc un oubli ici casserait un événement ancien.
    for (const event of PRODUCT_EVENTS) expect(autorises, event).toContain(event);
    expect(autorises).toContain("page_engagement");
  });

  it("LE VOCABULAIRE DU RELEVÉ EST FERMÉ EN BASE AUSSI, pas seulement dans la route", () => {
    const check = SQL.slice(SQL.indexOf("product_events_engagement_metadata_check"));
    for (const valeur of SCROLL_LABELS) expect(check, valeur).toContain(`'${valeur}'`);
    for (const valeur of DWELL_LABELS) expect(check, valeur).toContain(`'${valeur}'`);
    for (const valeur of FIRST_ACTION_VALUES) expect(check, valeur).toContain(`'${valeur}'`);
    for (const valeur of INPUT_TOUCHED) expect(check, valeur).toContain(`'${valeur}'`);
    // Exactement cinq clés : une clé de plus serait une catégorie que le
    // cockpit n'agrège pas, donc invisible.
    //
    // Mission #209 bis — l'écriture a changé. La première comparait un
    // `array_agg` des clés, ce que Postgres REFUSE dans un CHECK (sous-requête
    // interdite) : la migration ne s'exécutait pas du tout. L'objet est
    // maintenant reconstruit clé par clé puis comparé à lui-même.
    //
    // Cette garde-ci ne lit que du TEXTE, et c'est précisément ce qui n'a pas
    // suffi : la garantie elle-même est éprouvée sur un vrai moteur, cas par
    // cas, dans tests/migrations-moteur.test.ts.
    // Trois opérateurs, tous IMMUTABLE : le type, la présence des cinq clés,
    // et le fait qu'il n'en reste aucune autre après les avoir retirées.
    expect(check).toContain("jsonb_typeof(metadata) = 'object'");
    expect(check).toContain("metadata ?& array['dwell', 'first_action', 'input', 'scroll', 'scrolled']");
    expect(check).toContain("(metadata - array['dwell', 'first_action', 'input', 'scroll', 'scrolled']) = '{}'::jsonb");
    // Aucune sous-requête ne doit revenir ici. La garde générale porte sur les
    // quarante-deux migrations (tests/migrations-check.test.ts) ; celle-ci
    // nomme le fichier où la faute s'est produite.
    expect(check.slice(0, check.indexOf("create or replace"))).not.toMatch(/\bselect\b/i);
    // Et la contrainte ne s'applique qu'à cet événement : les autres gardent
    // un metadata libre.
    expect(check).toContain("event_name <> 'page_engagement'");
  });

  it("AUCUN BLOC DU COCKPIT N'EST PERDU par le « create or replace »", () => {
    // Leçon de la #198 bis : `create or replace` remplace la fonction ENTIÈRE.
    // Une clé oubliée ici effacerait un bloc de l'écran sans rien casser.
    const precedente = readFileSync("supabase/migrations/20261005000038_referrer_domain.sql", "utf8");
    const cles = (texte: string) => [...texte.matchAll(/^\s*'([a-z_]+)',/gm)].map((m) => m[1]);
    const avant = cles(precedente.slice(precedente.indexOf("select jsonb_build_object")));
    const apres = cles(MIGRATION.slice(MIGRATION.indexOf("select jsonb_build_object")));
    expect(avant.length).toBeGreaterThan(8);
    for (const cle of avant) expect(apres, cle).toContain(cle);
    expect(apres).toContain("engagement");
    expect(apres).toContain("engagement_scroll");
  });

  it("l'agrégat ne lit QUE du trafic de production non interne", () => {
    const agregat = SQL.slice(SQL.indexOf("), engagement as ("), SQL.indexOf("), feedback as ("));
    expect(agregat).toContain("from filtered");
    // `filtered` applique déjà environment = 'production' and not internal :
    // relire la table directement contournerait les deux filtres.
    expect(agregat).not.toContain("public.product_events");
    expect(agregat).toContain("coalesce(utm_medium, 'direct')");
  });

  it("les compteurs de l'agrégat sont exactement ceux que le cockpit lit", () => {
    const agregat = SQL.slice(SQL.indexOf("), engagement as ("), SQL.indexOf("), engagement_scroll as ("));
    const attendus: Array<keyof DashboardData["engagement"][number]> = [
      "total", "interacted", "scrolled", "read_to_end", "input_touched", "under_5s", "idle_no_action",
    ];
    for (const colonne of attendus) expect(agregat, colonne).toContain(`as ${colonne}`);
    // 90 % est la borne publiée de GA4 pour « a atteint le bas de la page ».
    expect(agregat).toContain("metadata->>'scroll' = '90-100'");
    // Les deux branches de la faible intention, au même seuil de 5 s.
    expect(agregat).toContain("metadata->>'dwell' in ('0-1s', '1-5s')");
  });
});

describe("le bloc rendu, pour de vrai", () => {
  it("IL AFFICHE LES TAUX ÉCRITS, le verdict et les mesures à part", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { InPageFunnel } = await import("@/components/admin/charts");
    const row = ligne({ total: 353, interacted: 120, scrolled: 90, read_to_end: 12, input_touched: 0, under_5s: 200, idle_no_action: 30 });
    const html = renderToStaticMarkup(<InPageFunnel row={row} />);
    const texte = html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, " ").trim();
    // Les quatre étapes, leurs valeurs, et le taux de passage ÉCRIT.
    expect(texte).toContain("Pages vues mesurées");
    expect(texte).toContain("353");
    expect(texte).toContain("120 pages vues sur 353 pages vues — 34 %");
    expect(texte).toContain("90 pages vues sur 120 pages vues — 75 %");
    expect(texte).toContain("12 pages vues sur 90 pages vues — 13 %");
    // Rien d'indéfini ni de NaN n'atteint l'écran.
    expect(texte).not.toMatch(/NaN|undefined|null/);
  });

  it("une ligne vide ne produit ni taux ni division par zéro", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { InPageFunnel } = await import("@/components/admin/charts");
    const html = renderToStaticMarkup(
      <InPageFunnel row={ligne({ total: 0, interacted: 0, scrolled: 0, read_to_end: 0, input_touched: 0, under_5s: 0, idle_no_action: 0 })} />,
    );
    expect(html).not.toMatch(/NaN|undefined/);
    expect(html).not.toContain("—");
  });
});

describe("le coût au chargement, tenu par construction", () => {
  const SONDE = readFileSync("components/analytics/page-engagement.tsx", "utf8");
  // Les commentaires de ce fichier citent `fetch` et `scrollHeight` pour
  // expliquer les choix : compter sur le texte brut compterait les
  // explications autant que le code. On compte sur CE QUI S'EXÉCUTE.
  const CODE = SONDE.replace(/^\s*\/\/.*$/gm, "");

  it("LA LECTURE DE MISE EN PAGE NE SORT PAS DU requestAnimationFrame", () => {
    // Cette garantie-là n'est pas observable par un test de comportement : la
    // batterie de mutation a montré qu'appeler `relever()` directement depuis
    // l'écouteur produit exactement la même mesure. Ce qui change est le coût,
    // et la mission l'interdit. On vérifie donc la forme, faute de pouvoir
    // vérifier l'effet.
    //
    // MDN explique pourquoi l'IntersectionObserver existe : « event handlers
    // and loops calling methods like Element.getBoundingClientRect() […] all
    // this code runs on the main thread ».
    const ecouteur = SONDE.slice(SONDE.indexOf("const auDefilement"), SONDE.indexOf("const auGeste"));
    expect(ecouteur).toContain("window.requestAnimationFrame(relever)");
    // L'écouteur ne lit RIEN de la mise en page lui-même.
    expect(ecouteur).not.toContain("scrollHeight");
    expect(ecouteur).not.toContain("relever()");
    // Et la seule lecture du module est dans la fonction d'image.
    expect(CODE.split("scrollHeight")).toHaveLength(2);
    expect(CODE).not.toContain("getBoundingClientRect");
  });

  it("aucun envoi périodique, aucun battement : un seul par page vue", () => {
    expect(CODE).not.toMatch(/setInterval|setTimeout/);
    expect(CODE.split("fetch(")).toHaveLength(2);
  });

  it("aucun stockage sur l'appareil, aucune dépendance tierce", () => {
    // La page de confidentialité promet « ne dépose rien sur ton appareil ».
    for (const interdit of ["localStorage", "sessionStorage", "document.cookie", "indexedDB"]) {
      expect(CODE, interdit).not.toContain(interdit);
    }
    const imports = CODE.slice(0, CODE.indexOf("export function"));
    expect(imports).not.toMatch(/from "(?!react|@\/)/);
  });

  it("LE CHAMP DE COLLAGE SIGNALE SON PREMIER CONTACT, et rien d'autre", () => {
    // Le crochet existait et ne menait nulle part : `startedRef` était écrit
    // et relu par personne, un reste de l'outil de mesure tiers retiré depuis.
    const form = readFileSync("components/deal-input.tsx", "utf8");
    expect(form).toContain("signalerChamp(current)");
    // L'onglet, jamais le texte : aucune des variables de contenu ne passe.
    expect(form).not.toMatch(/signalerChamp\((text|reply|value|event)/);
  });
});

describe("ce que la page de confidentialité annonce", () => {
  const PAGE = readFileSync("app/confidentialite/page.tsx", "utf8");
  // Le JSX coupe ses phrases en fin de ligne : une garde qui chercherait une
  // phrase d'un seul tenant tomberait au prochain reformatage, pour une raison
  // qui n'est pas celle qu'elle surveille. Les espaces sont donc normalisés.
  const TEXTE = PAGE.replace(/\s+/g, " ");

  it("CHACUN DES CINQ SIGNAUX EST DÉCRIT, et pas sous le mot « statistiques »", () => {
    // La page disait « statistiques d'usage anonymes » : vrai, mais personne
    // n'en déduit qu'on relève une profondeur de lecture. Si un sixième signal
    // s'ajoute un jour au relevé, cette garde doit tomber.
    expect(Object.keys(mesure(nouvelEtat(0), 0)).sort()).toEqual(
      ["dwell", "first_action", "input", "scroll", "scrolled"],
    );
    // Un morceau de phrase par signal, dans l'ordre du relevé.
    expect(TEXTE).toContain("jusqu&apos;où tu as fait défiler la page");
    expect(TEXTE).toContain("combien de temps elle est restée affichée");
    expect(TEXTE).toContain("avant ton premier geste");
    expect(TEXTE).toContain("quel onglet du formulaire a été touché en premier");
    // Les tranches sont dites, avec un exemple chiffré : « en tranches » seul
    // ne se comprend pas.
    expect(TEXTE).toContain("arrondies en tranches");
    expect(TEXTE).toContain("entre 5 et 10 secondes");
  });

  it("CE QUI N'EST PAS RELEVÉ EST DIT AUSSI, à commencer par le texte collé", () => {
    // La promesse qui compte le plus pour quelqu'un qui colle le message d'une
    // marque dans un champ.
    expect(TEXTE).toContain("le texte que tu colles dans le champ, ni même sa longueur");
    expect(TEXTE).toContain("ne dit rien de ce qui a été écrit dedans");
    for (const absent of ["mouvements de la souris", "endroit des clics", "touches frappées", "nombre de gestes"]) {
      expect(TEXTE, absent).toContain(absent);
    }
    // Mission #209 quinquies — CETTE GARDE ÉPINGLAIT UNE PHRASE FAUSSE.
    //
    // Elle exigeait « Aucun identifiant n'accompagne ces relevés », et elle
    // tenait parfaitement : le texte était bien là. Il était seulement faux —
    // une ligne page_engagement porte l'empreinte technique du jour, comme
    // toute autre ligne de statistique. Une garde sur du texte ne vaut que ce
    // que vaut le texte ; c'est tests/engagement-empreinte.test.ts qui
    // interroge maintenant la LIGNE réellement écrite.
    expect(TEXTE).toContain("ni ton compte, ni un identifiant qui durerait");
    expect(TEXTE).toContain("ni cookie, ni stockage local");
  });

  it("le tableau des données traitées ne reste pas plus vague que le texte", () => {
    // Les deux sont sur la même page : l'un ne doit pas promettre moins que
    // l'autre.
    const tableau = TEXTE.slice(TEXTE.indexOf("Données traitées et finalités"), TEXTE.indexOf("Durées de conservation"));
    expect(tableau).toContain("Comportement sur la page d'accueil");
    expect(tableau).toContain("sans jamais le contenu de ce qui est collé dans le champ");
  });

  it("et la page ne promet rien que le code ne tienne", () => {
    // Trois promesses, chacune vérifiable dans la sonde : pas de stockage, un
    // seul envoi par page vue, rien vers un tiers.
    const sonde = readFileSync("components/analytics/page-engagement.tsx", "utf8").replace(/^\s*\/\/.*$/gm, "");
    for (const interdit of ["localStorage", "sessionStorage", "document.cookie"]) {
      expect(sonde, interdit).not.toContain(interdit);
    }
    expect(sonde.split("fetch(")).toHaveLength(2);
  });
});
