import { existsSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import GiftedProductsPage from "@/app/produits-offerts/page";
import sitemap from "@/app/sitemap";
import { FOOTER_COLUMNS } from "@/components/site-footer";
import { CANONICAL_ORIGIN, PUBLIC_PAGES, publicPageMetadata } from "@/lib/seo";

// Mission #055 — page /produits-offerts. Texte fourni par l'éditeur : ce test
// protège ce qui ne doit pas bouger et le maillage entre les guides.

const html = renderToStaticMarkup(<GiftedProductsPage />);
const texte = html
  .replaceAll("&#x27;", "'")
  .replaceAll("&amp;", "&")
  .replaceAll(" ", " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/\s+/g, " ")
  // Une balise retirée laisse un espace ; devant une virgule ou un point,
  // cet espace n'existe pas dans la page. Sans ça, poser un lien au milieu
  // d'une phrase ferait échouer un test sans qu'aucun texte ait changé.
  .replace(/\s+([,.])/g, "$1");

const corps = (motif: RegExp) => [...html.matchAll(motif)].filter((m) => html.indexOf("<footer") > (m.index ?? 0));

describe("page /produits-offerts", () => {
  it("la page existe, avec son en-tête et son pied de page", () => {
    expect(existsSync(path.join(process.cwd(), "app/produits-offerts/page.tsx"))).toBe(true);
    expect(html).toContain("<header");
    expect(html).toContain("<footer");
  });

  it("un seul h1, et les titres descendent sans saut de niveau", () => {
    const niveaux = [...html.matchAll(/<h([1-6])[^>]*>/g)].map((m) => Number(m[1]));
    expect(niveaux.filter((n) => n === 1)).toHaveLength(1);
    expect(texte).toContain("Une marque te propose des produits gratuits");
    let precedent = 0;
    for (const niveau of niveaux) {
      if (precedent) expect(niveau, `saut ${precedent} → ${niveau}`).toBeLessThanOrEqual(precedent + 1);
      precedent = niveau;
    }
  });

  it("le message de la marque et la réponse type sont présentés comme des citations, au mot près", () => {
    expect([...html.matchAll(/<blockquote/g)]).toHaveLength(2);
    expect(texte).toContain(
      "« On adore ton profil ! On t'envoie notre routine complète, d'une valeur de 120 €, en échange de deux vidéos. »",
    );
    expect(texte).toContain(
      "« Merci beaucoup ! Le produit m'intéresse. Pour ce format-là, je travaille avec une rémunération, et je peux inclure les produits dans l'accord. Tu peux me dire si les vidéos restent sur mon compte ou si vous comptez les passer en pub, et sur quelle durée ? Je te fais une proposition juste après. »",
    );
  });

  it("les deux listes de critères sont complètes", () => {
    for (const critere of [
      "Le produit est cher, et tu l'aurais acheté de toute façon.",
      "Il n'y a qu'un seul livrable, ou deux.",
      "La vidéo reste sur ton compte, en organique.",
      "La marque ne demande ni droits publicitaires, ni exclusivité.",
      "Il n'y a pas de brief de trois pages ni de date de rendu serrée.",
      "Elle demande une exclusivité, même courte.",
      "La visibilité n'est pas une monnaie.",
    ]) {
      expect(texte, critere).toContain(critere);
    }
  });

  it("la mention de la loi du 9 juin 2023 et le renvoi au comptable sont conservés", () => {
    expect(texte).toContain(
      // Énoncé aligné sur lib/legal/fr.ts (mission #062, C1) : « HT », « année
      // civile », « avantages en nature inclus ». Le guide et l'analyse ne
      // peuvent pas énoncer deux règles différentes.
      "La loi du 9 juin 2023 sur l'influence commerciale encadre ces partenariats, et impose un contrat écrit dès que la collaboration dépasse 1 000 € HT cumulés sur l'année civile entre une même marque et un même créateur, avantages en nature inclus.",
    );
    expect(texte).toContain("parles-en à un comptable");
  });

  // Mission #158 — les quatre guides se citent dans leur texte, et chaque lien
  // interne porte son origine. Ce qui est vérifié ici : un seul lien par guide
  // cité, l'origine présente sur chacun, et aucun paramètre utm.
  it("le bloc final renvoie vers /analyse, et un lien part vers chacun des trois autres guides", () => {
    expect(html).toMatch(/href="\/analyse"[^>]*>[^<]*Analyser mon deal/);
    for (const guide of ["/combien-facturer", "/droits-utilisation", "/droits-pub-6-mois"]) {
      expect(corps(new RegExp(`href="${guide}[?]de=produits-offerts"`, "g")), guide).toHaveLength(1);
      expect(corps(new RegExp(`href="${guide}"`, "g")), guide).toHaveLength(0);
    }
    expect(corps(/utm_/g)).toHaveLength(0);
  });

  it("elle est publique : métadonnées, sitemap, colonne Guides, exemple compris", () => {
    const meta = publicPageMetadata("/produits-offerts");
    // Mission #158 — titre réécrit pour la requête tapée, avec l'année.
    expect(meta.title).toBe("Collab produits offerts 2026 : ça vaut quoi ?");
    expect(meta.description).toBe(
      "Un paiement en produits offerts : ce que la contrepartie vaut, quand c'est acceptable, quand ça ne l'est jamais, et par quoi ouvrir la négociation.",
    );
    expect(sitemap().map((entry) => entry.url)).toContain(`${CANONICAL_ORIGIN}/produits-offerts`);
    const guides = FOOTER_COLUMNS.find((colonne) => colonne.title === "Guides");
    // Mission #152 — l'exemple chiffré rejoint la colonne : même usage que
    // les guides, montrer avant de demander, et c'est le seul chemin vers lui
    // depuis une page qui n'est pas l'accueil.
    expect(guides?.links.map((lien) => lien.href)).toEqual([
      // Mission #161 — les quatre guides portent leur origine, comme
      // l'exemple depuis #152 : un clic depuis le pied de page s'enregistrait
      // sans origine, donc « depuis ? » dans /admin/evenements.
      "/combien-facturer?de=pied-de-page",
      "/droits-utilisation?de=pied-de-page",
      "/produits-offerts?de=pied-de-page",
      "/droits-pub-6-mois?de=pied-de-page",
      // Mission #171 — cinquième guide.
      "/exclusivite-ugc?de=pied-de-page",
      "/analyse/demo?de=pied-de-page",
    ]);
  });

  it("les douze pages publiques gardent des titres et des descriptions uniques", () => {
    expect(PUBLIC_PAGES).toHaveLength(12);
    expect(new Set(PUBLIC_PAGES.map((page) => page.title)).size).toBe(12);
    expect(new Set(PUBLIC_PAGES.map((page) => page.description)).size).toBe(12);
  });

  it("l'accueil vise une autre intention que le guide des tarifs", () => {
    const accueil = PUBLIC_PAGES.find((page) => page.path === "/");
    expect(accueil?.title).toBe("Cette collab vaut combien ? Négocie ton deal — Negoscore");
    expect(accueil?.title).not.toContain("Combien facturer");
  });
});
