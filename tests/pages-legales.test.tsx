import { createHash } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Mission #209 quater — UNE PAGE LÉGALE DONT LA DATE MENT.
//
// La #209 ter a ajouté deux paragraphes à la politique de confidentialité en
// laissant « Dernière mise à jour : 17 septembre 2026 » : quelqu'un qui se fie
// à la date croit avoir déjà tout lu. Le défaut n'est pas la ligne, c'est
// qu'il n'y avait RIEN pour l'empêcher de revenir — la date et le contenu
// vivaient dans le même fichier sans aucun lien entre eux.
//
// CE QUI A ÉTÉ ÉCARTÉ, et pourquoi :
//   - dériver la date de l'horodatage du fichier : un clone neuf ne conserve
//     pas les dates de modification, donc Vercel les remet au moment du
//     déploiement. La page annoncerait une mise à jour À CHAQUE déploiement,
//     même sans un mot changé. C'est un mensonge de plus, pas de moins ;
//   - dériver la date du dernier commit touchant le fichier : l'historique
//     git n'est pas dans le paquet déployé, et `VERCEL_GIT_COMMIT_SHA` ne dit
//     rien par fichier.
//
// CE QUI EST FAIT ICI : chaque page légale a son EMPREINTE, prise sur le
// contenu RENDU — donc insensible aux commentaires et à la mise en forme du
// code — et rangée à côté de la date qu'elle avait ce jour-là. Changer un mot
// sans toucher à la date fait échouer ce test, qui dit exactement quoi faire.
//
// La ligne « Dernière mise à jour » est retirée avant l'empreinte : sinon
// changer la date changerait l'empreinte, et les deux se poursuivraient sans
// jamais se rattraper.

vi.mock("@/components/site-header", () => ({ SiteHeader: () => null }));
vi.mock("@/components/site-footer", () => ({ SiteFooter: () => null }));

// Chaque page légale, sa date affichée, et l'empreinte du reste.
//
// POUR METTRE À JOUR UNE PAGE LÉGALE : change le texte, mets la date du jour
// où ça part en production dans la page, puis recopie ici l'empreinte que ce
// test affiche quand il échoue. Les trois vont ensemble, et c'est le but.
const PAGES = [
  {
    chemin: "@/app/confidentialite/page",
    titre: "Politique de confidentialité",
    date: "30 octobre 2026",
    empreinte: "386057a4c6360f69",
  },
  {
    chemin: "@/app/cgv/page",
    titre: "Conditions générales de vente",
    date: "16 septembre 2026",
    empreinte: "7b2a8c98cc0e6c1b",
  },
  {
    chemin: "@/app/mentions-legales/page",
    titre: "Mentions légales",
    date: "16 septembre 2026",
    empreinte: "fad4ab50e6a02b34",
  },
] as const;

const DATE_AFFICHEE = /Dernière mise à jour :\s*([^<]+)</;

// Le contenu tel qu'il atteint l'écran, sans la ligne de date, normalisé.
function contenu(html: string): string {
  return html
    .replace(DATE_AFFICHEE, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function empreinteDe(html: string): string {
  return createHash("sha256").update(contenu(html)).digest("hex").slice(0, 16);
}

describe("la date d'une page légale ne peut plus mentir en silence", () => {
  for (const page of PAGES) {
    it(`${page.titre} : le contenu n'a pas bougé sans sa date`, async () => {
      const Page = (await import(page.chemin)).default;
      const html = renderToStaticMarkup(<Page />);

      // La date affichée est bien celle qu'on a notée ici.
      expect(html.match(DATE_AFFICHEE)?.[1].trim(), page.titre).toBe(page.date);

      const vue = empreinteDe(html);
      expect(
        vue,
        `Le contenu de « ${page.titre} » a changé.\n` +
          `  1. mets dans la page la date du jour où ça part en production ;\n` +
          `  2. recopie cette empreinte dans tests/pages-legales.test.tsx : ${vue}\n` +
          `  (date notée ici : ${page.date})`,
      ).toBe(page.empreinte);
    });
  }

  it("l'empreinte IGNORE les commentaires et la mise en forme du code", () => {
    // Sinon la garde crierait au loup à chaque reformatage, et on finirait par
    // recopier l'empreinte sans lire ce qui a changé.
    const avant = "<main> <p>Dernière mise à jour : 1 janvier 2026</p> <p>Un texte.</p> </main>";
    const apres = "<main>\n  <p>Dernière mise à jour : 1 janvier 2026</p>\n\n  <p>Un  texte.</p>\n</main>";
    expect(empreinteDe(avant)).toBe(empreinteDe(apres));
  });

  it("l'empreinte IGNORE la date, pour que les deux ne se poursuivent pas", () => {
    const septembre = "<main><p>Dernière mise à jour : 17 septembre 2026</p><p>Un texte.</p></main>";
    const octobre = "<main><p>Dernière mise à jour : 29 octobre 2026</p><p>Un texte.</p></main>";
    expect(empreinteDe(septembre)).toBe(empreinteDe(octobre));
  });

  it("mais elle VOIT un mot changé", () => {
    const avant = "<main><p>Dernière mise à jour : 29 octobre 2026</p><p>Un texte.</p></main>";
    const apres = "<main><p>Dernière mise à jour : 29 octobre 2026</p><p>Un autre texte.</p></main>";
    expect(empreinteDe(avant)).not.toBe(empreinteDe(apres));
  });
});
