import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { axisTicks, BarCell, Funnel, labelEvery, largeur, stepRate, TimeSeries } from "@/components/admin/charts";
import {
  appliquerRafraichissement,
  Cockpit,
  estDonnees,
  memeDonnees,
  SEUIL_INDICATEUR_MS,
} from "@/components/admin/cockpit";
import { ADMIN_PERIODS, dashboardTiles, visitCount, type AdminPeriod, type DashboardData } from "@/lib/admin/data";
import { SERIES, SERIES_COLOR } from "@/lib/admin/series";

// Mission #132 — RENDRE LE COCKPIT LISIBLE.
//
// Deux erreurs de lecture réelles, le 01/10 : une ligne de zéros prise pour
// une absence, et deux chiffres différents sous le même mot. Ce fichier tient
// la règle qui compte au-dessus de toutes les autres : C'EST UN TRAVAIL
// D'AFFICHAGE. Si une valeur bouge, c'est un bug.

const base: DashboardData = {
  counts: {},
  excluded: 0, internal: 0, paid_pro: 0, granted_pro: 0,
  feedback: { total: 0, fair: 0, not_fair: 0 },
  purchases: { purchases: 0, revenue_eur: 0, revenue_covered: 0 },
  timeseries: [], acquisition: [], guides: [], example: { total: 0, direct: 0 },
  tier_changes: [],
};

const complet: DashboardData = {
  ...base,
  counts: {
    landing_view: 80, pricing_view: 4, guide_view: 12, example_view: 4,
    analysis_started: 2, analysis_completed: 2, signup: 0, checkout_started: 0, purchase_completed: 0,
  },
  excluded: 4, internal: 16,
  feedback: { total: 3, fair: 2, not_fair: 1 },
  purchases: { purchases: 0, revenue_eur: 0, revenue_covered: 0 },
  timeseries: [
    { day: "2026-09-25", page_views: 0, analyses: 0, signups: 0, purchases: 0 },
    { day: "2026-09-26", page_views: 0, analyses: 0, signups: 0, purchases: 0 },
    { day: "2026-09-30", page_views: 8, analyses: 0, signups: 0, purchases: 0 },
    { day: "2026-10-01", page_views: 24, analyses: 2, signups: 0, purchases: 0 },
  ],
  acquisition: [
    { source: "non_attribue", campaign: "non_attribue", content: "non_attribue", visits: 12, analyses: 1, signups: 0, purchases: 0 },
    { source: "instagram", campaign: "lancement", content: "dm_prospection", visits: 1, analyses: 0, signups: 0, purchases: 0 },
    { source: "tiktok", campaign: "lancement", content: "video_1_negociation", visits: 0, analyses: 0, signups: 0, purchases: 0 },
  ],
  guides: [
    { path: "/combien-facturer", views: 3, to_example: 1 },
    { path: "/produits-offerts", views: 0, to_example: 0 },
  ],
  example: { total: 2, direct: 2 },
  tier_changes: [{ tier: "experienced", changes: 1 }],
};

const lisible = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[\s  ]+/g, " ")
    .trim();

// Les nombres et les montants portent des espaces insécables : on les ramène
// à l'espace ordinaire des deux côtés, sinon on compare deux graphies du même
// chiffre.
const espaces = (valeur: string) => valeur.replace(/[\s\u00a0\u202f]+/g, " ");

const cockpit = (data: DashboardData, period: AdminPeriod = "7d") =>
  renderToStaticMarkup(<Cockpit initial={{ [period]: data }} period={period} />);

// ───────────────────────────────────────────────────────────────────────────
describe("aucun chiffre ne change", () => {
  it("les valeurs des tuiles sont celles de dashboardTiles, sur les quatre périodes", () => {
    for (const period of ADMIN_PERIODS) {
      const html = cockpit(complet, period);
      const texte = lisible(html);
      for (const tile of dashboardTiles(complet)) {
        // Le libellé et sa valeur, tels que la fonction les décide.
        expect(texte, `${period} / ${tile.label}`).toContain(tile.label);
        expect(texte, `${period} / ${tile.label} = ${tile.value}`).toContain(espaces(tile.value));
      }
    }
  });

  it("le funnel affiche les comptes bruts, et « Visites » vaut la tuile", () => {
    const html = cockpit(complet);
    const texte = lisible(html);
    expect(texte).toContain(String(visitCount(complet)));
    for (const [label, valeur] of [
      ["Analyses lancées", 2],
      ["Analyses terminées", 2],
      ["Inscriptions", 0],
      ["Checkout", 0],
      ["Achats", 0],
    ] as const) {
      expect(texte, label).toContain(label);
      expect(texte, `${label} = ${valeur}`).toContain(String(valeur));
    }
  });

  it("les tableaux affichent les mêmes nombres qu'avant, zéros compris", () => {
    const texte = lisible(cockpit(complet));
    for (const row of complet.acquisition) {
      expect(texte, row.content).toContain(row.content);
      expect(texte, `${row.content} = ${row.visits}`).toContain(String(row.visits));
    }
    for (const row of complet.guides) expect(texte, row.path).toContain(row.path);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("la couleur ne porte jamais seule l'identité", () => {
  it("chaque série a sa couleur fixe, jamais générée ni cyclée", () => {
    expect([...SERIES]).toEqual(["visites", "analyses", "inscriptions", "achats"]);
    const couleurs = SERIES.map((s) => SERIES_COLOR[s]);
    expect(new Set(couleurs).size).toBe(SERIES.length);
    // Les valeurs vivent dans les jetons CSS : aucune n'est écrite en dur ici.
    for (const couleur of couleurs) expect(couleur).toMatch(/^var\(--color-serie-[a-z]+\)$/);
    const source = readFileSync("components/admin/charts.tsx", "utf8");
    // Aucune couleur choisie par index : une série garde la sienne même si une
    // autre disparaît du graphique.
    expect(source).not.toMatch(/\[index\s*%|COLORS\[|palette\[/);
  });

  it("la légende nomme la série à côté de sa pastille, dès deux séries", () => {
    const html = renderToStaticMarkup(<TimeSeries rows={complet.timeseries} />);
    const texte = lisible(html);
    // Deux graphiques, deux noms écrits. L'ancienne légende était une phrase
    // (« Bleu : visites, Brun : analyses ») où la couleur portait tout.
    expect(texte).toContain("Visites");
    expect(texte).toContain("Analyses");
    expect(texte).not.toContain("Bleu :");
    expect(texte).not.toContain("Brun :");
    expect(html).toContain("var(--color-serie-visites)");
    expect(html).toContain("var(--color-serie-analyses)");
  });

  it("le funnel est monochrome : une seule mesure, une seule teinte", () => {
    const html = renderToStaticMarkup(<Funnel data={complet} />);
    const teintes = new Set([...html.matchAll(/var\(--color-serie-([a-z]+)\)/g)].map((m) => m[1]));
    expect([...teintes]).toEqual(["visites"]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("le graphique tient avec 0, 1 et 2 jours", () => {
  it.each([0, 1, 2, 3, 14, 31])("%i jour(s) : rendu sans erreur, et pas de défilement", (jours) => {
    const rows = Array.from({ length: jours }, (_, i) => ({
      day: `2026-10-${String(i + 1).padStart(2, "0")}`,
      page_views: i % 3,
      analyses: 0,
      signups: 0,
      purchases: 0,
    }));
    const html = renderToStaticMarkup(<TimeSeries rows={rows} />);
    expect(html).not.toContain("overflow-x");
    expect(html).not.toMatch(/min-w-\[\d+px\]/);
    if (jours === 0) expect(lisible(html)).toContain("Aucun événement sur cette période.");
  });

  it("un zéro se lit comme un zéro : la phrase dit combien de jours sont vides", () => {
    const texte = lisible(renderToStaticMarkup(<TimeSeries rows={complet.timeseries} />));
    // Deux jours à zéro sur les quatre de la fixture.
    expect(texte).toContain("2 jours sans activité sur la période");
    expect(texte).toContain("un zéro se lit comme un zéro");
  });

  it("l'axe porte deux à quatre graduations, et jamais une échelle inventée", () => {
    expect(axisTicks(0)).toEqual([0]);
    expect(axisTicks(1)).toEqual([1, 0]);
    expect(axisTicks(2)).toEqual([2, 0]);
    expect(axisTicks(24)).toEqual([24, 12, 0]);
    expect(axisTicks(7)).toEqual([8, 4, 0]);
    for (const max of [0, 1, 2, 3, 9, 24, 100, 1234]) {
      const ticks = axisTicks(max);
      expect(ticks.length, String(max)).toBeLessThanOrEqual(4);
      expect(ticks[0], String(max)).toBeGreaterThanOrEqual(max);
      expect(ticks.at(-1)).toBe(0);
    }
  });

  it("les dates ne se chevauchent pas : une sur deux au-delà de dix jours, jamais inclinée", () => {
    expect(labelEvery(2)).toBe(1);
    expect(labelEvery(10)).toBe(1);
    expect(labelEvery(14)).toBe(2);
    expect(labelEvery(31)).toBe(4);
    const html = renderToStaticMarkup(<TimeSeries rows={complet.timeseries} />);
    expect(html).not.toMatch(/rotate|writing-mode/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("le taux de passage est écrit, pas à déduire", () => {
  const ANALYSES = ["analyse", "analyses"] as const;
  const VISITES = ["visite", "visites"] as const;
  const TERMINEES = ["terminée", "terminées"] as const;
  const LANCEES = ["lancée", "lancées"] as const;
  const INSCRIPTIONS = ["inscription", "inscriptions"] as const;

  it("il correspond au calcul, accord en nombre compris", () => {
    expect(stepRate(24, 2, ANALYSES, VISITES)).toBe("2 analyses sur 24 visites — 8 %");
    expect(stepRate(2, 2, TERMINEES, LANCEES)).toBe("2 terminées sur 2 lancées — 100 %");
    // Zéro et un prennent le singulier en français.
    expect(stepRate(2, 0, INSCRIPTIONS, ANALYSES)).toBe("0 inscription sur 2 analyses — 0 %");
    expect(stepRate(1, 1, ANALYSES, VISITES)).toBe("1 analyse sur 1 visite — 100 %");
    // Dénominateur vide : aucun taux, plutôt que « 0 % de 0 ».
    expect(stepRate(0, 0, ANALYSES, VISITES)).toBeNull();
    // Jamais plus de 100 %, même si une étape dépasse la précédente.
    expect(stepRate(2, 5, ANALYSES, VISITES)).toContain("100 %");
  });

  it("il est rendu entre deux étapes du funnel", () => {
    const texte = lisible(renderToStaticMarkup(<Funnel data={complet} />));
    expect(texte).toContain("2 analyses sur 100 visites — 2 %");
    expect(texte).toContain("2 terminées sur 2 lancées — 100 %");
    expect(texte).toContain("0 inscription sur 2 analyses — 0 %");
    expect(texte).toContain("Étapes agrégées, sans suivi individuel entre écrans");
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("les tableaux ont un poids visuel", () => {
  it("la barre est proportionnelle au maximum de la colonne", () => {
    expect(renderToStaticMarkup(<BarCell value={12} max={12} />)).toContain("width:100%");
    expect(renderToStaticMarkup(<BarCell value={6} max={12} />)).toContain("width:50%");
    // Une ligne à zéro reste une LIGNE : la piste est là, le chiffre aussi.
    const zero = renderToStaticMarkup(<BarCell value={0} max={12} />);
    expect(zero).toContain("width:0%");
    expect(lisible(zero)).toBe("0");
  });

  it("acquisition et guides portent la barre dans leur colonne principale", () => {
    const html = cockpit(complet);
    // Une barre par ligne de chaque tableau : 3 + 2.
    const barres = [...html.matchAll(/cockpit-bar h-full rounded-\[3px\]/g)];
    expect(barres).toHaveLength(complet.acquisition.length + complet.guides.length);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// ───────────────────────────────────────────────────────────────────────────
// ───────────────────────────────────────────────────────────────────────────
// ───────────────────────────────────────────────────────────────────────────
// Mission #133 — le changement de période ne traverse plus le réseau.
//
// Mesuré avant de corriger : la RPC Postgres fait la totalité du temps
// serveur (92 à 242 ms en local, mise en forme à 0,1 ms), et les quatre
// périodes pèsent 6,4 ko ensemble. Le clic lit donc la mémoire, et le réseau
// ne sert plus qu'à vérifier après coup.
describe("changer de période lit la mémoire, pas le réseau", () => {
  it("les quatre périodes sont embarquées par le premier rendu", () => {
    const page = readFileSync("app/admin/page.tsx", "utf8");
    // Les quatre d'un coup, en parallèle : quatre RPC ensemble coûtent la plus
    // lente, pas la somme des quatre.
    expect(page).toContain("loadDashboards()");
    expect(page).not.toMatch(/loadDashboard\(period\)/);
    const data = readFileSync("lib/admin/data.ts", "utf8");
    expect(data).toContain("Promise.all(ADMIN_PERIODS.map((period) => loadDashboard(period)))");
  });

  it("le clic affiche la période demandée sans aucun await avant", () => {
    const source = readFileSync("components/admin/cockpit.tsx", "utf8");
    const montrer = source.slice(source.indexOf("const montrer = useCallback("), source.indexOf("[rafraichir],"));
    // L'état change, l'adresse suit, et le rafraîchissement part SANS être
    // attendu. Un `await` ici, et on réintroduit les 2 à 3 secondes.
    expect(montrer).toContain("setPeriod(cible)");
    expect(montrer).toContain("void rafraichir(cible)");
    expect(montrer).not.toContain("await");
    // Et `fetch` n'apparaît que dans le rafraîchissement d'arrière-plan.
    const fetchs = source.match(/fetch\(/g) ?? [];
    expect(fetchs).toHaveLength(1);
    const raf = source.slice(source.indexOf("const rafraichir = useCallback("), source.indexOf("const montrer = useCallback("));
    expect(raf).toContain("fetch(");
  });

  it("les quatre périodes rendues depuis la mémoire portent chacune ses propres chiffres", () => {
    // Les quatre en mémoire d'un côté, une seule de l'autre : le même écran
    // doit sortir. C'est ce qui garantit que le composant lit la période
    // active et ne mélange pas deux périodes.
    const parPeriode = {
      "24h": { ...complet, counts: { ...complet.counts, landing_view: 11 } },
      "7d": { ...complet, counts: { ...complet.counts, landing_view: 22 } },
      "30d": { ...complet, counts: { ...complet.counts, landing_view: 33 } },
      all: { ...complet, counts: { ...complet.counts, landing_view: 44 } },
    } as const;
    for (const period of ADMIN_PERIODS) {
      const memoire = renderToStaticMarkup(<Cockpit initial={parPeriode} period={period} />);
      const seule = renderToStaticMarkup(<Cockpit initial={{ [period]: parPeriode[period] }} period={period} />);
      expect(memoire, period).toBe(seule);
      // Et le chiffre affiché est bien celui de CETTE période.
      expect(espaces(lisible(memoire)), period).toContain(
        espaces(dashboardTiles(parPeriode[period]).find((tile) => tile.label === "Visites mesurées")!.value),
      );
    }
  });

  it("une période absente de la mémoire ne montre pas les chiffres d'une autre", () => {
    const html = renderToStaticMarkup(<Cockpit initial={{ "7d": complet }} period="24h" />);
    expect(html).toContain("Les chiffres de cette période n’ont pas été chargés");
    // Et surtout : aucune tuile, donc aucun chiffre emprunté à « 7 jours ».
    expect(html).not.toContain('aria-label="Indicateurs"');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("le rafraîchissement d'arrière-plan", () => {
  it("une valeur différente remplace la période concernée, et elle seule", () => {
    const caches = { "24h": complet, "7d": complet };
    const change = { ...complet, counts: { ...complet.counts, landing_view: 4242 } };
    const apres = appliquerRafraichissement(caches, "24h", change);
    expect(apres).not.toBe(caches);
    expect(apres["24h"]).toBe(change);
    expect(apres["7d"]).toBe(complet);
    // Et le nouveau chiffre arrive bien à l'écran.
    expect(espaces(lisible(renderToStaticMarkup(<Cockpit initial={apres} period="24h" />)))).toContain(
      espaces(dashboardTiles(change).find((tile) => tile.label === "Visites mesurées")!.value),
    );
  });

  it("une valeur identique n'écrit rien : rien ne bouge pour dire que rien n'a changé", () => {
    const caches = { "24h": complet };
    // Même contenu, autre objet : c'est le cas réel d'un rafraîchissement.
    const copie = JSON.parse(JSON.stringify(complet)) as typeof complet;
    expect(memeDonnees(complet, copie)).toBe(true);
    expect(appliquerRafraichissement(caches, "24h", copie)).toBe(caches);
    // Une période encore inconnue, elle, est toujours écrite.
    expect(memeDonnees(undefined, copie)).toBe(false);
    expect(appliquerRafraichissement(caches, "7d", copie)).not.toBe(caches);
  });

  it("un corps inattendu est traité comme une panne, pas comme des chiffres", () => {
    // Trouvé en patchant la réponse à `null` dans le navigateur : sans ce
    // contrôle, l'écran se vidait.
    expect(estDonnees(null)).toBe(false);
    expect(estDonnees({})).toBe(false);
    expect(estDonnees({ counts: {} })).toBe(false);
    expect(estDonnees({ counts: null, timeseries: [] })).toBe(false);
    expect(estDonnees(complet)).toBe(true);
    const source = readFileSync("components/admin/cockpit.tsx", "utf8");
    expect(source).toContain("if (!estDonnees(recu.data)) throw new Error");
  });

  it("l'indicateur ne se montre qu'au-delà de 400 ms", () => {
    expect(SEUIL_INDICATEUR_MS).toBe(400);
    const source = readFileSync("components/admin/cockpit.tsx", "utf8");
    // Un seul minuteur, armé à ce seuil, et c'est lui seul qui allume
    // l'indicateur. Vérifié à l'écran : réponse en 150 ms, jamais vu ;
    // réponse en 700 ms, apparu entre 250 et 550 ms, reparti ensuite.
    expect(source).toContain("}, SEUIL_INDICATEUR_MS);");
    expect(source.match(/setLent\(true\)/g) ?? []).toHaveLength(1);
    expect(source).toContain("if (ticket === demande.current) setLent(true);");
    // L'affichage de l'indicateur et du retrait d'opacité ne dépend que de
    // `lent` : pas d'autre voile gris sur l'écran.
    expect(source).toContain('{lent ? "Mise à jour…" : ""}');
    expect(source).toContain('className={lent ? "cockpit-charge flex flex-col gap-10" : "flex flex-col gap-10"}');
  });
});

describe("quand le rechargement échoue", () => {
  // Exigence de la mission : « Si la requête échoue, les données PRÉCÉDENTES
  // restent affichées. » Donc le chemin d'erreur n'a pas le droit de toucher
  // aux chiffres — il n'écrit QUE le message.
  it("le chemin d'erreur n'écrit jamais dans les chiffres", () => {
    const source = readFileSync("components/admin/cockpit.tsx", "utf8");
    const apres = source.split("} catch {")[1];
    expect(apres, "aucun bloc catch").toBeDefined();
    const bloc = apres.split("\n    }")[0];
    expect(bloc).toContain("setErreur(");
    expect(bloc).not.toContain("setCaches(");
    expect(bloc).not.toContain("setPeriod(");
    // Et le message dit ce que le lecteur a sous les yeux : les chiffres de la
    // période précédente, pas ceux qu'il vient de demander.
    // Mission #133 — la formulation a changé avec le mécanisme : les chiffres
    // affichés sont désormais ceux de la période DEMANDÉE, pris en mémoire, et
    // simplement pas rafraîchis. Dire « ceux de la période précédente » serait
    // devenu faux.
    expect(bloc).toContain("Ceux affichés sont les derniers obtenus.");
  });

  it("une réponse dépassée est jetée, dans les deux chemins", () => {
    const source = readFileSync("components/admin/cockpit.tsx", "utf8");
    const garde = source.match(/ticket !== demande\.current/g) ?? [];
    // Succès ET échec : deux clics rapides ne doivent ni afficher les chiffres
    // de la période abandonnée, ni son message d'erreur.
    expect(garde).toHaveLength(2);
  });
});

describe("ce qui a été vu à l'écran, et corrigé", () => {
  // Vu sur 31 jours dans la colonne de gauche : chaque date était bornée à la
  // largeur d'une colonne (12 px) et s'affichait « 0… ». Mesuré au DOM après
  // correction : 8 étiquettes, 0 coupée, 0 chevauchement, à 1280 px comme à
  // 375 px.
  it("les dates sont posées en absolu, et la dernière est sur la grille", () => {
    const source = readFileSync("components/admin/charts.tsx", "utf8");
    expect(source).toContain("absolute top-0 -translate-x-1/2 whitespace-nowrap");
    // Espacement compté à rebours : sinon « 29/09 » et « 01/10 » se touchaient.
    expect(source).toContain("(days.length - 1 - index) % every !== 0");
    expect(source).not.toContain("truncate");
  });

  // Vu sur le funnel : 2 sur 100 donnait une barre de moins d'un pixel, qui se
  // lit comme une étape jamais atteinte.
  it("une valeur non nulle n'est jamais invisible, et zéro reste zéro", () => {
    expect(largeur(0, 100)).toBe(0);
    expect(largeur(0, 0)).toBe(0);
    expect(largeur(2, 100)).toBe(2);
    // Sous le plancher, la barre reste visible plutôt que de disparaître.
    expect(largeur(1, 1000)).toBe(1.5);
    expect(largeur(12, 12)).toBe(100);
    expect(largeur(6, 12)).toBe(50);
  });

  it("les quatre états d'aperçu existent, pour regarder ce que la base ne produit pas", async () => {
    const { COCKPIT_PREVIEWS, cockpitPreview, cockpitPreviewCaches } = await import("@/lib/fixtures/cockpit-states");
    expect([...COCKPIT_PREVIEWS]).toEqual(["lancement", "vide", "un-jour", "mois"]);
    for (const etat of COCKPIT_PREVIEWS) {
      const html = renderToStaticMarkup(<Cockpit initial={cockpitPreviewCaches(etat)} period="7d" />);
      expect(html, etat).toContain("Cockpit");
      expect(html, etat).not.toContain("NaN");
      expect(html, etat).not.toContain("undefined");
    }
    // Les jours de la fixture de lancement sont CONTIGUS : une fixture qui
    // saute des dates ne sert à rien pour juger un graphique à l'œil.
    const jours = cockpitPreview("lancement").timeseries.map((r) => r.day);
    for (let i = 1; i < jours.length; i++) {
      const ecart = (Date.parse(jours[i]) - Date.parse(jours[i - 1])) / 86400000;
      expect(ecart, `${jours[i - 1]} → ${jours[i]}`).toBe(1);
    }
  });
});

describe("le changement de période ne recharge pas la page", () => {
  it("les périodes restent des liens : sans JavaScript, elles naviguent", () => {
    const html = cockpit(complet, "30d");
    for (const p of ADMIN_PERIODS) expect(html).toContain(`href="/admin?period=${p}"`);
    // Et une seule est marquée active, celle de l'adresse.
    expect([...html.matchAll(/aria-current="page"/g)]).toHaveLength(1);
  });

  it("les graphiques ne sont pas démontés : seules leurs valeurs changent", () => {
    const source = readFileSync("components/admin/cockpit.tsx", "utf8");
    // Les données vivent dans un état, et le composant est rendu sans
    // condition : il n'est jamais retiré de l'arbre pendant un chargement.
    expect(source).toContain("useState<CockpitCaches>(initial)");
    expect(source).toContain("<TimeSeries rows={data.timeseries} />");
    expect(source).toContain("<Funnel data={data} />");
    expect(source).not.toMatch(/charge \? null :|charge \? <|if \(charge\) return/);
    // L'adresse suit, pour qu'on puisse la copier et revenir en arrière.
    expect(source).toContain("window.history.pushState");
    expect(source).toContain("popstate");
  });

  it("une erreur n'efface jamais un chiffre", () => {
    const source = readFileSync("components/admin/cockpit.tsx", "utf8");
    // Le bloc `catch` pose un message et ne touche pas aux données.
    const bloc = source.slice(source.indexOf("} catch {"), source.indexOf("function montrer"));
    expect(bloc).toContain("setErreur");
    expect(bloc).not.toContain("setCaches");
  });

  it("sous prefers-reduced-motion, aucune transition n'est appliquée", () => {
    const css = readFileSync("app/globals.css", "utf8");
    const regle = css.slice(css.indexOf(".cockpit-bar {"));
    expect(regle).toContain("transition:");
    expect(regle).toContain("240ms");
    const reduit = regle.slice(regle.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduit).toContain(".cockpit-bar");
    expect(reduit).toContain(".cockpit-valeur");
    expect(reduit).toContain("transition: none");
  });
});
