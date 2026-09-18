import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SiteFooter } from "@/components/site-footer";
import { SELLER } from "@/lib/legal/identity";
import { organizationJsonLd, softwareApplicationJsonLd, webSiteJsonLd } from "@/lib/seo";

// Mission #072 — compléter la déclaration d'entité, avec une limite explicite.

const blocs = [organizationJsonLd(), webSiteJsonLd(), softwareApplicationJsonLd()];
const texte = JSON.stringify(blocs);

describe("adresse de contact", () => {
  it("l'Organization déclare l'adresse affichée en pied de page, prise à la même source", () => {
    const footer = renderToStaticMarkup(<SiteFooter />);
    const shown = footer.match(/href="mailto:([^"]+)"/)?.[1];
    expect(shown).toBe(SELLER.email);
    expect(organizationJsonLd().email).toBe(shown);
  });

  it("aucune adresse écrite en dur dans le code des données structurées", () => {
    const seo = readFileSync(path.join(process.cwd(), "lib/seo.ts"), "utf8");
    expect(seo).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
  });
});

// Choix, pas accident : ces trois informations ne sont PAS servies en format
// machine. Pour en ajouter une, il faut changer ce test, donc le décider.
describe("volontairement absents : adresse postale, fondateur, date de fondation", () => {
  it("aucune de ces propriétés, dans aucun bloc", () => {
    for (const champ of ["address", "streetAddress", "postalCode", "addressLocality", "PostalAddress", "founder", "founders", "foundingDate"]) {
      expect(texte, champ).not.toContain(`"${champ}"`);
    }
  });

  it("ni l'adresse ni le nom de l'éditeur des mentions légales, même ailleurs", () => {
    expect(texte).not.toContain(SELLER.address);
    expect(texte).not.toContain(SELLER.name);
    expect(texte).not.toContain(SELLER.siret);
  });
});
