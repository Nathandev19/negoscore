import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import sitemap from "@/app/sitemap";
import UsageRightsPage from "@/app/droits-utilisation/page";
import { FOOTER_COLUMNS } from "@/components/site-footer";
import { CANONICAL_ORIGIN, PUBLIC_PAGES, publicPageMetadata } from "@/lib/seo";

// Mission #052 — page /droits-utilisation. Le texte vient de l'éditeur : ce
// test protège ce qui ne doit pas bouger, en premier lieu la citation légale.

const html = renderToStaticMarkup(<UsageRightsPage />);
// Rendu lisible : entités décodées, espaces insécables ramenés à des espaces.
const texte = html
  .replaceAll("&#x27;", "'")
  .replaceAll("&quot;", '"')
  .replaceAll("&amp;", "&")
  .replaceAll(" ", " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/\s+/g, " ");

const L131_3 =
  "« La transmission des droits de l'auteur est subordonnée à la condition que chacun des droits cédés fasse l'objet d'une mention distincte dans l'acte de cession et que le domaine d'exploitation des droits cédés soit délimité quant à son étendue et à sa destination, quant au lieu et quant à la durée. »";

describe("page /droits-utilisation", () => {
  it("la page existe et répond : un composant rendu sans erreur, avec son en-tête et son pied de page", () => {
    expect(existsSync(path.join(process.cwd(), "app/droits-utilisation/page.tsx"))).toBe(true);
    expect(html).toContain("<footer");
    expect(html).toContain("<header");
    expect(html.length).toBeGreaterThan(2000);
  });

  it("un seul h1, et les titres descendent sans saut de niveau", () => {
    const niveaux = [...html.matchAll(/<h([1-6])[^>]*>/g)].map((m) => Number(m[1]));
    expect(niveaux.filter((n) => n === 1)).toHaveLength(1);
    expect(texte).toContain("Droits d'utilisation : ce que tu vends vraiment");
    let precedent = 0;
    for (const niveau of niveaux) {
      if (precedent) expect(niveau, `saut ${precedent} → ${niveau}`).toBeLessThanOrEqual(precedent + 1);
      precedent = niveau;
    }
  });

  it("la citation de l'article L131-3 est reproduite exactement, guillemets compris", () => {
    expect(texte).toContain(L131_3);
    expect(html).toContain("<blockquote");
  });

  it("le bloc « Vérifie ton offre » renvoie vers /analyse", () => {
    expect(texte).toContain("Vérifie ton offre");
    expect(html).toMatch(/href="\/analyse"[^>]*>[^<]*Analyser mon deal/);
  });

  it("elle figure dans le sitemap, avec son adresse canonique", () => {
    const urls = sitemap().map((entry) => entry.url);
    expect(urls).toContain(`${CANONICAL_ORIGIN}/droits-utilisation`);
    expect(PUBLIC_PAGES.map((page) => page.path)).toContain("/droits-utilisation");
  });

  it("titre et description sont ceux décidés", () => {
    const meta = publicPageMetadata("/droits-utilisation");
    // Mission #158 — titre réécrit pour la requête tapée, avec l'année.
    expect(meta.title).toBe("Droits d'utilisation UGC 2026 : le vrai prix");
    expect(meta.description).toBe(
      "Ta vidéo passe en pub : ce n'est plus de la création, c'est une licence. Durée, supports, territoire, et ce que chaque ligne vaut en négociation.",
    );
  });

  it("elle est liée depuis le pied de page commun", () => {
    const liens = FOOTER_COLUMNS.flatMap((colonne) => colonne.links.map((lien) => lien.href));
    expect(liens).toContain("/droits-utilisation");
  });

  it("le favicon.ico existe, et aucune autre icône n'a été retirée", () => {
    const app = path.join(process.cwd(), "app");
    expect(statSync(path.join(app, "favicon.ico")).size).toBeGreaterThan(100);
    for (const icone of ["icon.svg", "icon1.tsx", "icon2.tsx", "apple-icon.tsx", "manifest.ts"]) {
      expect(existsSync(path.join(app, icone)), icone).toBe(true);
    }
    // Format ICO : en-tête 0x00 0x00 0x01 0x00, puis une image PNG à l'offset 22.
    const ico = readFileSync(path.join(app, "favicon.ico"));
    expect([...ico.subarray(0, 4)]).toEqual([0, 0, 1, 0]);
    const width = ico[6] === 0 ? 256 : ico[6];
    const height = ico[7] === 0 ? 256 : ico[7];
    expect(width).toBe(height);
    // Google accepte 8 px, mais recommande plus de 48 px pour ses surfaces.
    expect(width).toBeGreaterThan(48);
    expect(ico.subarray(22, 26).toString("hex")).toBe("89504e47");
  });
});
