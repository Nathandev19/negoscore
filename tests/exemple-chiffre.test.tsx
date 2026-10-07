import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import sampleExtraction from "@/lib/fixtures/sample-extraction.json";
import { SAMPLE_OFFER, SAMPLE_OFFER_SOURCE, SAMPLE_OFFER_TEXT } from "@/lib/fixtures/sample-offer";
import { FULL_EXAMPLE } from "@/lib/content/vocabulaire";
import { navItems } from "@/components/header-nav";
import { SampleOfferQuote, SEUIL_REPLI_PX } from "@/components/result/sample-offer-quote";
import type { Analysis } from "@/lib/schema";

// Mission #119, partie B — /analyse/demo cesse d'être orpheline.
//
// Constat du 28/09 : la page est indexée par Google et c'est la plus
// convaincante du site pour un inconnu — exemple chiffré complet, mention
// honnête que l'offre est inventée, appel à l'action. Elle n'était atteignable
// que depuis l'accueil ; les TROIS GUIDES, qui sont les pages d'arrivée depuis
// la recherche, n'y menaient pas.

vi.mock("@/components/deal-input", () => ({ DealInput: ({ note }: { note?: string }) => <form aria-label="saisie">{note}</form> }));
vi.mock("@/components/analytics/first-party-view", () => ({ FirstPartyView: () => null, currentAttribution: () => ({}) }));

const GUIDES = ["/combien-facturer", "/produits-offerts", "/droits-utilisation"] as const;
const FICHIER: Record<string, string> = {
  "/combien-facturer": "app/combien-facturer/page.tsx",
  "/produits-offerts": "app/produits-offerts/page.tsx",
  "/droits-utilisation": "app/droits-utilisation/page.tsx",
  "/": "app/page.tsx",
};

function anchors(html: string): Array<{ href: string; text: string }> {
  return [...html.matchAll(/<a ([^>]*)>([\s\S]*?)<\/a>/g)].map((match) => ({
    href: match[1].match(/href="([^"]*)"/)?.[1] ?? "",
    text: match[2].replace(/<[^>]+>/g, "").replace(/&#x27;|&apos;/g, "'").replace(/\s+/g, " ").trim(),
  }));
}

async function render(path: string): Promise<string> {
  const loaded = await import(`@/${FICHIER[path].replace(/\.tsx$/, "")}`);
  const Page = loaded.default as () => React.ReactElement;
  return renderToStaticMarkup(Page());
}

describe("le lien vers l'exemple chiffré", () => {
  // Mission #152 — le pied de page porte lui aussi un lien vers l'exemple.
  // On regarde donc le CORPS seul : le lien du guide doit y être, unique, avec
  // son origine à lui. Le pied de page est vérifié juste après, pour lui-même.
  const corps = (html: string) => html.replace(/<footer[\s\S]*?<\/footer>/g, "");

  it("les trois guides y mènent, avec le libellé du vocabulaire", async () => {
    for (const guide of GUIDES) {
      const found = anchors(corps(await render(guide))).filter((a) => a.href.startsWith(FULL_EXAMPLE.href));
      expect(found, guide).toHaveLength(1);
      expect(found[0].text, guide).toBe(FULL_EXAMPLE.label);
      // Mission #120 — et chacun dit d'où l'on vient.
      expect(found[0].href, guide).toBe(`${FULL_EXAMPLE.href}?de=${guide.slice(1)}`);
    }
  });

  it("le pied de page y mène aussi, avec le même libellé et sa propre origine", async () => {
    const pied = /<footer[\s\S]*?<\/footer>/.exec(await render("/"));
    expect(pied, "pied de page introuvable").not.toBeNull();
    const found = anchors((pied as RegExpExecArray)[0]).filter((a) => a.href.startsWith(FULL_EXAMPLE.href));
    expect(found).toHaveLength(1);
    expect(found[0].text).toBe(FULL_EXAMPLE.label);
    expect(found[0].href).toBe(`${FULL_EXAMPLE.href}?de=pied-de-page`);
  });

  it("l'accueil aussi, et avec le MÊME libellé : une page, une formule", async () => {
    // Mission #152 — l'accueil en porte DEUX : celui de la section Exemple,
    // qui existait, et celui posé sous l'action principale, pour qui n'a pas
    // d'offre sous la main et repartirait sans rien avoir vu. Même formule et
    // même origine pour les deux : une page, une formule.
    const found = anchors(corps(await render("/"))).filter((a) => a.href.startsWith(FULL_EXAMPLE.href));
    expect(found).toHaveLength(2);
    for (const lien of found) {
      expect(lien.text).toBe(FULL_EXAMPLE.label);
      expect(lien.href).toBe(`${FULL_EXAMPLE.href}?de=accueil`);
    }
  });

  it("le libellé dit ce qu'on y trouve, jamais « démo »", () => {
    expect(FULL_EXAMPLE.label.toLowerCase()).not.toContain("démo");
    expect(FULL_EXAMPLE.label.toLowerCase()).not.toContain("demo");
    // Il annonce une analyse, et qu'elle est chiffrée : les deux raisons d'y aller.
    expect(FULL_EXAMPLE.label).toMatch(/analyse/i);
    expect(FULL_EXAMPLE.label).toMatch(/chiffr/i);
  });

  it("le libellé n'est écrit qu'une fois, dans le vocabulaire", () => {
    for (const fichier of Object.values(FICHIER)) {
      const source = readFileSync(fichier, "utf8");
      expect(source, fichier).toContain("FULL_EXAMPLE");
      // Aucune page ne réécrit le texte à la main.
      expect(source, fichier).not.toContain(FULL_EXAMPLE.label);
    }
  });

  it("ce sont des liens, pas des composants : la page tient sans JavaScript", () => {
    for (const fichier of Object.values(FICHIER)) {
      const source = readFileSync(fichier, "utf8");
      expect(source, fichier).not.toMatch(/^\s*["']use client["']/m);
    }
    // Rendu côté serveur, sans la moindre hydratation : l'ancre est dans le HTML.
    expect(FULL_EXAMPLE.href).toBe("/analyse/demo");
  });

  it("la page visée existe, et dit toujours que l'offre est inventée", async () => {
    const source = readFileSync("app/analyse/demo/page.tsx", "utf8");
    expect(source).toContain("Exemple, pas une vraie analyse");
    expect(source).toContain("l&apos;offre est inventée");
  });
});

// Mission #125 — LE MESSAGE QUI A PRODUIT LE VERDICT.
//
// La page affichait « 300 € proposés, ces droits en valent 430 à 900 » sans
// jamais montrer ce qu'elle avait lu. La promesse du produit est « je lis
// l'offre et je la chiffre » : sans l'offre à l'écran, le chiffre est une
// affirmation, pas une démonstration.
describe("l'offre source est visible sur la page d'exemple", () => {
  // La page d'exemple est rendue à part : elle ne porte pas le lien du
  // vocabulaire, et le test de #119 balaie FICHIER en l'exigeant.
  const renderDemo = async () => {
    const { default: Page } = await import("@/app/analyse/demo/page");
    return renderToStaticMarkup(Page());
  };
  // Le HTML échappe les apostrophes : les positions se comparent sur le texte
  // lisible, celui qu'on lit à l'écran.
  const lisible = (html: string) =>
    html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&#x2019;/g, "’").replace(/\s+/g, " ");

  it("le message reçu est affiché, en entier, au-dessus du score", async () => {
    const html = await renderDemo();
    const texte = lisible(html);
    expect(texte).toContain(SAMPLE_OFFER.body);
    // Au-DESSUS du score : dans l'ordre de lecture, avant le bandeau de verdict.
    expect(texte.indexOf(SAMPLE_OFFER.body)).toBeLessThan(texte.indexOf("/100"));
    // Présenté comme un message reçu, pas comme un paragraphe de page web.
    expect(html).toMatch(/<blockquote[^>]*>[^<]*Bonjour/);
    expect(texte).toContain("Le message reçu");
  });

  it("ce message n'est pas réécrit : c'est la fixture d'évaluation d'origine", () => {
    const source = readFileSync(SAMPLE_OFFER_SOURCE, "utf8").trimEnd();
    expect(SAMPLE_OFFER_TEXT).toBe(source);
    // Et tous ses termes se retrouvent dans le deal extrait qui produit le
    // verdict : ce n'est pas un texte d'illustration posé à côté.
    const deal = sampleExtraction.deal;
    expect(SAMPLE_OFFER.body).toContain(`${deal.payment.amount_eur}€`);
    expect(SAMPLE_OFFER.body).toContain(`${deal.deliverables[0].quantity} vidéos`);
    expect(SAMPLE_OFFER.body).toContain(`${deal.usage.duration_months} mois`);
    expect(SAMPLE_OFFER.body).toContain(`${deal.payment.terms_days} jours`);
  });

  it("la mention « offre inventée » reste, et au premier contact", async () => {
    const texte = lisible(await renderDemo());
    // Deux fois : à côté du message, et dans le paragraphe complet plus bas.
    expect(texte).toContain("Exemple — offre inventée");
    expect(texte).toContain("Exemple, pas une vraie analyse : l'offre est inventée");
    // La première arrive AVANT le message : personne ne lit l'offre sans savoir.
    expect(texte.indexOf("offre inventée")).toBeLessThan(texte.indexOf(SAMPLE_OFFER.body));
  });

  it("le résultat n'est pas repoussé : le score suit immédiatement le message", async () => {
    const html = await renderDemo();
    const texte = lisible(html);
    // Rien d'autre entre le message et le score que la phrase de verdict.
    const entre = texte.slice(texte.indexOf(SAMPLE_OFFER.body) + SAMPLE_OFFER.body.length, texte.indexOf("/100"));
    expect(entre.trim().length, entre).toBeLessThan(120);
    // La signature n'est pas affichée : elle nomme la marque autrement que
    // « Le deal proposé » (voir lib/fixtures/sample-offer.ts). Comparé sur le
    // TEXTE LISIBLE : le HTML échappe l'apostrophe, et la chercher dans le
    // balisage brut ne prouverait rien.
    expect(texte).not.toContain(SAMPLE_OFFER.signature);
    expect(texte).not.toContain("Aubépine");
    // Et le nom que la page affiche vraiment est celui de l'extraction.
    expect(texte).toContain("Marque Exemple");
  });
});

// Mission #126 — LA PAGE D'EXEMPLE DOIT MENER QUELQUE PART.
//
// Constat de #125 : les trois seuls liens vers /analyse étaient ceux de la
// barre de navigation et du pied de page. Le seul appel à l'action du corps
// menait à /connexion. Depuis #125, cette page est la porte d'entrée envoyée
// en DM : elle ne peut pas être un cul-de-sac.
describe("la page d'exemple mène à l'analyse", () => {
  const renderDemo = async () => {
    const { default: Page } = await import("@/app/analyse/demo/page");
    return renderToStaticMarkup(Page());
  };

  it("le corps de la page porte un lien vers /analyse, hors navigation et pied de page", async () => {
    const html = await renderDemo();
    // La navigation et le pied de page sont retirés : ce qui reste est le corps.
    const corps = html
      .replace(/<header[\s\S]*?<\/header>/g, "")
      .replace(/<footer[\s\S]*?<\/footer>/g, "");
    const liens = [...corps.matchAll(/<a [^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => ({
      href: m[1],
      texte: m[2].replace(/<[^>]+>/g, "").replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, " ").trim(),
    }));
    const versAnalyse = liens.filter((lien) => lien.href === "/analyse");
    expect(versAnalyse.length, JSON.stringify(liens)).toBeGreaterThanOrEqual(2);
    // Un appel à l'action, formulé comme une invitation à coller son offre.
    // Mission #148 — les trois sorties portent le même libellé.
    expect(versAnalyse.map((lien) => lien.texte)).toContain("Analyser mon offre");
  });

  it("« Analyser un deal » est un lien dans le paragraphe d'avertissement", async () => {
    const html = await renderDemo();
    // Le texte ne change pas : c'est le balisage autour qui change.
    const lisible = html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, " ");
    expect(lisible).toContain("Pour chiffrer ton offre, colle-la sur la page Analyser un deal .");
    expect(html).toMatch(/<a [^>]*href="\/analyse"[^>]*>\s*Analyser un deal\s*<\/a>/);
  });

  // Mission #126 — VU PAR QUELQU'UN QUI N'A PAS DONNÉ SON EMAIL.
  //
  // tests/page-structure.test.tsx vérifie l'ordre sur une analyse DÉBLOQUÉE :
  // les deux blocs y sont remplis, et les versions verrouillées ne s'y rendent
  // jamais. C'est pourtant l'état verrouillé qui posait problème — le mur
  // arrivait au milieu de la page et laissait croire que la suite l'était
  // aussi. La page d'exemple est le seul endroit où on peut le vérifier.
  it("le mur d'email arrive après TOUT ce qui est gratuit", async () => {
    const html = await renderDemo();
    const mur = ["Ta contre-offre chiffrée", "Ton message prêt à envoyer", "Débloquer — ton email suffit"];
    const gratuit = ["Ce qu&#x27;il faut négocier", "Le deal proposé", "Red flags", "Ce qui est bon", "Bon à savoir côté loi française"];
    for (const bloc of gratuit) {
      const position = html.indexOf(bloc);
      expect(position, bloc).toBeGreaterThan(-1);
      for (const verrou of mur) expect(position, `${bloc} avant ${verrou}`).toBeLessThan(html.indexOf(verrou));
    }
    // Et le bouton reste là, avec sa destination : on ne l'a pas perdu en
    // déplaçant le bloc.
    expect(html).toMatch(/href="\/connexion\?next=%2Fanalyse"/);
    for (const verrou of mur) expect(html.indexOf(verrou), verrou).toBeGreaterThan(-1);
  });

  // Mission #127 — L'APPEL À L'ACTION PASSE DEVANT LE MUR.
  //
  // #126 l'avait mis tout à la fin, après le bouton « Débloquer ». Or le but
  // du produit n'est pas de collecter des adresses : c'est qu'une vraie offre
  // soit collée. Zéro analyse réelle depuis le lancement. L'appel à l'action
  // était donc placé derrière l'obstacle qui le concurrence.
  it("l'appel à l'action arrive après tout le gratuit, et AVANT le mur", async () => {
    const html = await renderDemo();
    const cta = html.indexOf('aria-label="Analyser ton offre"');
    expect(cta).toBeGreaterThan(-1);
    // Après tout ce qu'on donne : la démonstration est faite avant d'inviter.
    for (const gratuit of ["Ce qu&#x27;il faut négocier", "Le deal proposé", "Red flags", "Ce qui est bon", "Bon à savoir côté loi française"]) {
      expect(html.indexOf(gratuit), gratuit).toBeLessThan(cta);
    }
    // Et avant le premier bloc verrouillé, en état verrouillé.
    for (const verrou of ["Ta contre-offre chiffrée", "Ton message prêt à envoyer", "Débloquer — ton email suffit"]) {
      expect(cta, verrou).toBeLessThan(html.indexOf(verrou));
    }
  });

  // Mission #147 — LA PAGE N'AVAIT PAS DE PORTE DE SORTIE.
  //
  // Constat du 04/10 : une créatrice à qui le lien venait d'être envoyé en DM
  // a ouvert la page, l'a lue, et s'est arrêtée. Une ligne dans le cockpit,
  // rien d'autre. L'appel à l'action de #126/#127 existe — mais il est PLUS
  // BAS que la contre-offre verrouillée, donc très loin sous la ligne de
  // flottaison. Au-dessus, il n'y avait qu'un lien en toutes lettres au milieu
  // du paragraphe d'avertissement.
  const SORTIE = /<a [^>]*href="\/analyse"[^>]*>\s*Analyser mon offre\s*<\/a>/g;

  it("un bouton vers l'analyse est rendu AVANT la contre-offre", async () => {
    const html = await renderDemo();
    const premier = html.search(SORTIE);
    expect(premier, "aucun bouton « Analyser mon offre » dans la page").toBeGreaterThan(-1);
    // Le bloc de contre-offre, verrouillé sur cette page.
    const contreOffre = html.indexOf("Ta contre-offre chiffrée");
    expect(contreOffre).toBeGreaterThan(-1);
    expect(premier, "le bouton doit précéder la contre-offre").toBeLessThan(contreOffre);
  });

  it("ce bouton est dans le bandeau bleu, au-dessus du paragraphe d'avertissement", async () => {
    const html = await renderDemo();
    // Le bandeau est la section « Verdict » : le bouton doit être dedans, pas
    // juste « quelque part avant ». C'est la seule place visible sans défiler.
    const bandeau = /<section [^>]*aria-label="Verdict"[\s\S]*?<\/section>/.exec(html);
    expect(bandeau, "section Verdict introuvable").not.toBeNull();
    expect((bandeau as RegExpExecArray)[0]).toMatch(SORTIE);
    // Et il arrive avant la mise en garde, qui est sous le bandeau.
    expect(html.search(SORTIE)).toBeLessThan(html.indexOf("Exemple, pas une vraie analyse"));
  });

  it("il y en a un second en bas de page, et les deux mènent au même endroit que le menu", async () => {
    const html = await renderDemo();
    // Mission #148 — trois : bandeau, bloc « Et la tienne… », bas de page.
    expect(html.match(SORTIE) ?? [], "trois boutons attendus").toHaveLength(3);
    // Le second est après la contre-offre ET après le mur : c'est la sortie de
    // qui a tout lu.
    const dernier = html.lastIndexOf("Analyser mon offre");
    expect(dernier).toBeGreaterThan(html.indexOf("Ta contre-offre chiffrée"));
    expect(dernier).toBeGreaterThan(html.indexOf("Débloquer — ton email suffit"));
    // Pas une nouvelle route : la destination est celle du menu.
    expect(navItems(false).cta.href).toBe("/analyse");
    for (const lien of html.match(SORTIE) ?? []) expect(lien).toContain(`href="${navItems(false).cta.href}"`);
  });

  it("le paragraphe d'avertissement est intact : on ajoute une sortie, on ne retire pas une mise en garde", async () => {
    const html = await renderDemo();
    const lisible = html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, " ");
    expect(lisible).toContain(
      "Exemple, pas une vraie analyse : l'offre est inventée, mais la fourchette, le score et la contre-offre sont calculés par le moteur actuel, comme pour ton offre. Pour chiffrer ton offre, colle-la sur la page Analyser un deal .",
    );
  });

  // Mission #148 — LES TROIS SORTIES DISENT LA MÊME CHOSE.
  //
  // La page portait « Analyser mon offre » en haut et en bas, et « Analyser
  // mon deal » au milieu : deux formules pour un seul geste.
  it("les trois appels vers /analyse portent le même libellé", async () => {
    const html = await renderDemo();
    const corps = html.replace(/<header[\s\S]*?<\/header>/g, "").replace(/<footer[\s\S]*?<\/footer>/g, "");
    const libelles = [...corps.matchAll(/<a [^>]*href="\/analyse"[^>]*>([\s\S]*?)<\/a>/g)].map((m) =>
      m[1].replace(/<[^>]+>/g, "").replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, " ").trim(),
    );
    // Trois sorties : le bandeau, le bloc « Et la tienne… », le bas de page.
    // Plus le lien en toutes lettres du paragraphe d'avertissement, qui n'est
    // pas un bouton et garde sa formulation de phrase.
    const boutons = libelles.filter((texte) => texte !== "Analyser un deal");
    expect(boutons, JSON.stringify(libelles)).toHaveLength(3);
    expect(new Set(boutons).size, `libellés divergents : ${JSON.stringify(boutons)}`).toBe(1);
    expect(boutons[0]).toBe("Analyser mon offre");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Mission #148 — SOUS 400 px, LE MESSAGE REÇU SE REPLIE.
//
// Les créatrices arrivent du navigateur intégré d'Instagram, qui retire 120 à
// 150 px de hauteur utile. Le bloc entier repoussait le bouton sous la ligne
// de flottaison. On le replie à trois lignes — on ne le coupe pas.
describe("le message reçu se replie sur les petits écrans", () => {
  const rendu = () => renderToStaticMarkup(<SampleOfferQuote />);
  const CSS = readFileSync("app/globals.css", "utf8");
  const SOURCE = readFileSync("components/result/sample-offer-quote.tsx", "utf8");

  it("le texte n'est ni raccourci ni réécrit : il est entier dans le balisage", () => {
    const html = rendu();
    const citation = /<blockquote[^>]*>([\s\S]*?)<\/blockquote>/.exec(html);
    expect(citation).not.toBeNull();
    const texte = (citation as RegExpExecArray)[1]
      .replace(/<[^>]+>/g, "")
      .replace(/&#x27;|&#39;/g, "'")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"');
    // Le corps de l'offre, au mot près, d'un seul tenant. Replier n'est pas
    // couper : aucun « … » n'est écrit dans le balisage, c'est le CSS qui
    // tronque l'affichage.
    expect(texte).toBe(SAMPLE_OFFER.body);
  });

  it("replié à trois lignes sous 400 px, entier au-dessus", () => {
    const html = rendu();
    const classes = /<blockquote[^>]*class="([^"]*)"/.exec(html)?.[1] ?? "";
    expect(classes).toContain("line-clamp-3");
    expect(classes).toContain(`min-[${SEUIL_REPLI_PX}px]:line-clamp-none`);
    // Le seuil n'est écrit qu'une fois comme valeur : la constante et les
    // variantes Tailwind ne peuvent pas diverger.
    expect(SEUIL_REPLI_PX).toBe(400);
    for (const variante of [...SOURCE.matchAll(/min-\[(\d+)px\]:/g)]) {
      expect(Number(variante[1]), variante[0]).toBe(SEUIL_REPLI_PX);
    }
  });

  it("la taille du texte de la citation n'a pas changé", () => {
    // tailwind-merge ne connaît pas l'utilitaire maison `text-small` et le
    // prend pour une couleur : passer ces classes par cn() faisait disparaître
    // la taille. Le piège a été vu une fois, il reste fermé.
    expect(/<blockquote[^>]*class="([^"]*)"/.exec(rendu())?.[1] ?? "").toContain("text-small");
  });

  it("le contrôle annonce son état et désigne la citation", () => {
    const html = rendu();
    const bouton = /<button([^>]*)>([\s\S]*?)<\/button>/.exec(html);
    expect(bouton, "aucun contrôle de repli").not.toBeNull();
    const [, attributs, libelle] = bouton as RegExpExecArray;
    expect(attributs).toContain('type="button"');
    expect(attributs).toContain('aria-expanded="false"');
    expect(libelle.trim()).toBe("Voir le message complet");
    // aria-controls pointe sur la citation elle-même.
    const cible = /aria-controls="([^"]*)"/.exec(attributs)?.[1];
    expect(cible).toBeTruthy();
    expect(html).toContain(`<blockquote id="${cible}"`);
    // Au-dessus du seuil, il disparaît — display:none, donc hors du parcours
    // clavier : au-dessus de 400 px, rien ne change.
    expect(attributs).toContain(`min-[${SEUIL_REPLI_PX}px]:hidden`);
  });

  it("sans JavaScript, le contrôle est masqué ET le repli annulé", () => {
    const html = rendu();
    // Le contrôle ne pourrait rien déplier : il est masqué par la règle
    // existante de globals.css (mission #076).
    expect(/<button[^>]*data-avec-js/.test(html)).toBe(true);
    // Et la citation est rendue en entier, sinon le message serait tronqué
    // sans aucun moyen de le lire.
    expect(html).toMatch(/<blockquote[^>]*data-replie/);
    expect(CSS).toContain("html:not([data-js]) [data-replie]");
    const regle = /html:not\(\[data-js\]\) \[data-replie\] \{([\s\S]*?)\}/.exec(CSS)?.[1] ?? "";
    expect(regle).toContain("-webkit-line-clamp: unset !important");
    expect(regle).toContain("display: block !important");
  });

  it("la mention « offre inventée » et le titre du bloc restent", () => {
    const html = rendu();
    expect(html).toContain("Le message reçu");
    expect(html).toContain("Exemple — offre inventée");
  });
});

describe("la page d'exemple mène à l'analyse (suite)", () => {
  // Mission #127 — les éléments passés en propriété portent une clé.
  // La vraie page de résultat le fait déjà pour `afterMessage` ; la page
  // d'exemple ne le faisait pour aucun des siens, et React le signalait à
  // chaque chargement en développement.
  it("chaque élément passé à AnalysisResult porte une clé explicite", () => {
    const source = readFileSync("app/analyse/demo/page.tsx", "utf8");
    for (const [prop, cle] of [
      ["above", 'key="offre-source"'],
      ["before", 'key="avertissement"'],
      ["beforeUnlock", 'key="analyser-la-tienne"'],
    ]) {
      expect(source, prop).toContain(cle);
    }
    // Aucun élément passé sans clé : les trois propriétés en ont une.
    expect(source).toContain("above={<SampleOfferQuote key=");
  });
});

describe("rien d'autre n'a bougé", () => {
  it("les guides gardent leur appel à l'action principal", async () => {
    for (const guide of GUIDES) {
      const hrefs = anchors(await render(guide)).map((a) => a.href);
      expect(hrefs, guide).toContain("/analyse");
    }
  });

  it("aucun moteur de chiffrage touché par cette mission", () => {
    // Les deux fichiers qui décident des fourchettes ne mentionnent ni le
    // lien, ni les chemins courts : la partie A et la partie B sont
    // strictement de la copie et de l'aiguillage.
    for (const fichier of ["lib/rates/engine.ts", "lib/rates/fr-2026.4.json", "lib/rates/score.ts"]) {
      const source = readFileSync(fichier, "utf8");
      for (const ajout of ["FULL_EXAMPLE", "analyse/demo", "SHORT_PATHS", "ACQUISITION_UTM"]) {
        expect(source, `${fichier} / ${ajout}`).not.toContain(ajout);
      }
    }
    // (« instagram » n'est pas dans cette liste : c'est une PLATEFORME de la
    // table de tarifs, et elle y était bien avant cette mission.)
  });

  // Le contrôle de référence vit dans tests/arrondi-fourchette.test.ts. Il est
  // refait ICI pour qu'une régression causée par cette mission fasse tomber un
  // test DE CETTE MISSION, et pas seulement un test d'une autre.
  it("les quatre fourchettes des vidéos déjà tournées sont inchangées", async () => {
    const { computeEstimate } = await import("@/lib/rates/engine");
    const { analysisSchema } = await import("@/lib/schema");
    const sample = (await import("@/lib/fixtures/sample-extraction.json")).default;
    type Deal = Analysis["deal"];
    const BASE = analysisSchema.shape.deal.parse((sample as { deal: unknown }).deal);
    const NO_RIGHTS = {
      usage: { organic: true, paid_ads: false, whitelisting: false, spark_ads: false, perpetual: false, duration_months: null, territory: null },
      exclusivity: { present: false, duration_months: null, category: null },
      raw_footage: false,
      ip_transfer: "none" as const,
      ai_training_rights: "absent" as const,
    };
    const deal = (patch: Partial<Deal>): Deal => ({ ...BASE, ...NO_RIGHTS, ...patch });
    const video = (quantity: number) => ({ type: "video" as const, platform: "tiktok" as const, quantity, format: null });
    const story = (quantity: number) => ({ type: "story" as const, platform: "instagram" as const, quantity, format: null });
    const photo = (quantity: number) => ({ type: "photo" as const, platform: "instagram" as const, quantity, format: null });
    const range = (subject: Deal, tier: "starter" | "experienced") => {
      const estimate = computeEstimate(subject, { tier });
      return [estimate.total_low, estimate.total_high];
    };

    expect(range(deal({ deliverables: [video(2)] }), "experienced")).toEqual([1000, 1600]);

    const lot = deal({
      deliverables: [video(1), story(3), photo(3)],
      usage: { organic: true, paid_ads: false, whitelisting: true, spark_ads: false, perpetual: false, duration_months: 3, territory: "monde entier" },
    });
    expect(range(lot, "starter")).toEqual([540, 1190]);
    expect(range(lot, "experienced")).toEqual([2700, 5280]);

    const gros = deal({
      deliverables: [video(4), story(6), photo(1)],
      usage: { organic: true, paid_ads: false, whitelisting: true, spark_ads: false, perpetual: false, duration_months: 3, territory: null },
      exclusivity: { present: true, duration_months: 1, category: "x" },
    });
    expect(range(gros, "starter")).toEqual([970, 2210]);
  });
});
