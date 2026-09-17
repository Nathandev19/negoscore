import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { HeaderNav } from "@/components/header-nav";
import { FOOTER_COLUMNS, SiteFooter } from "@/components/site-footer";
import { PLANS } from "@/lib/billing/plans";
import { FAQ } from "@/lib/content/home";
import { SELLER } from "@/lib/legal/identity";

vi.mock("@/components/deal-input", () => ({ DealInput: () => <form aria-label="saisie" /> }));
vi.mock("@/components/analytics/track-view", () => ({ TrackView: () => null }));

function links(html: string): Array<{ href: string; text: string; current: boolean }> {
  return [...html.matchAll(/<a ([^>]*)>([\s\S]*?)<\/a>/g)].map((match) => ({
    href: match[1].match(/href="([^"]*)"/)?.[1] ?? "",
    text: match[2].replace(/<[^>]+>/g, "").trim(),
    current: /aria-current="page"/.test(match[1]),
  }));
}

describe("en-tête", () => {
  it("déconnecté : logo, Comment ça marche, Tarifs, Se connecter, Analyser un deal — rien de protégé", () => {
    const html = renderToStaticMarkup(<HeaderNav signedIn={false} pathname="/" />);
    const hrefs = links(html).map((l) => l.href);
    for (const href of ["/", "/#methode", "/offres", "/connexion", "/analyse"]) expect(hrefs).toContain(href);
    for (const href of ["/historique", "/compte"]) expect(hrefs).not.toContain(href);
    expect(html).toContain("Se connecter");
    expect(html).toContain("Analyser un deal");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toMatch(/<header class="sticky top-0/);
  });

  it("connecté : Mes analyses et Mon compte, plus de Se connecter", () => {
    const html = renderToStaticMarkup(<HeaderNav signedIn pathname="/offres" />);
    const all = links(html);
    const hrefs = all.map((l) => l.href);
    for (const href of ["/#methode", "/offres", "/historique", "/compte", "/analyse"]) expect(hrefs).toContain(href);
    expect(hrefs).not.toContain("/connexion");
    expect(html).toContain("Mes analyses");
    expect(html).toContain("Mon compte");
    // Page courante signalée, dans la navigation principale comme dans le menu mobile.
    expect(all.filter((l) => l.href === "/offres").every((l) => l.current)).toBe(true);
    expect(all.filter((l) => l.href !== "/offres").some((l) => l.current)).toBe(false);
  });

  it("menu mobile : bouton relié au panneau, panneau fermé au rendu, cibles de 44 px", () => {
    const html = renderToStaticMarkup(<HeaderNav signedIn={false} />);
    const controls = html.match(/aria-controls="([^"]+)"/)?.[1];
    expect(controls).toBeTruthy();
    expect(html).toContain(`id="${controls}" hidden=""`);
    expect(html).toMatch(/<button[^>]*class="[^"]*h-11[^"]*min-w-11/);
    expect(html).toMatch(/Navigation mobile[\s\S]*min-h-11/);
  });
});

describe("pied de page", () => {
  it("trois colonnes, tous les liens présents et non vides", () => {
    const html = renderToStaticMarkup(<SiteFooter />);
    const all = links(html);
    for (const link of all) {
      expect(link.href.length, JSON.stringify(link)).toBeGreaterThan(0);
      expect(link.text.length, JSON.stringify(link)).toBeGreaterThan(0);
    }
    const hrefs = all.map((l) => l.href);
    for (const column of FOOTER_COLUMNS) for (const link of column.links) expect(hrefs).toContain(link.href);
    for (const href of ["/#methode", "/offres", "/analyse", "/mentions-legales", "/confidentialite", "/cgv", `mailto:${SELLER.email}`]) {
      expect(hrefs).toContain(href);
    }
    // Section Médiation des CGV encore à compléter : pas de lien vers un emplacement vide.
    expect(hrefs).not.toContain("/cgv#mediation");
    expect(html).toContain("est édité par un auto-entrepreneur immatriculé en France.");
    expect(html).toContain("Analyse éducative fondée sur des benchmarks de marché. Ce n&#x27;est pas un conseil juridique.");
    // Aucune année figée à la construction du site.
    expect(html).not.toMatch(/©|\b20\d\d\b/);
    expect(html).not.toContain(SELLER.siret);
    expect(html.match(/<h2/g)).toHaveLength(3);
  });
});

describe("page d'accueil", () => {
  it("FAQ : six questions en <details>/<summary>, réponses non vides, rien d'inventé à compléter", async () => {
    const { default: HomePage } = await import("@/app/page");
    const html = renderToStaticMarkup(<HomePage />);
    expect(FAQ).toHaveLength(6);
    expect(html.match(/<details/g)).toHaveLength(6);
    expect(html.match(/<summary/g)).toHaveLength(6);
    expect(FAQ.map((f) => f.question)).toEqual([
      "D'où viennent les prix ?",
      "Ça marche pour quel type d'offre ?",
      "Et si l'offre ne donne pas de montant ?",
      "Qu'est-ce que vous faites de mes documents ?",
      "C'est un conseil juridique ?",
      "Combien ça coûte ?",
    ]);
    for (const item of FAQ) expect(item.answer.length).toBeGreaterThan(40);
    expect(html).not.toContain("À COMPLÉTER");
  });

  it("un seul h1, hiérarchie sans saut, prix de plans.ts et ancre #methode", async () => {
    const { default: HomePage } = await import("@/app/page");
    const html = renderToStaticMarkup(<HomePage />);
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain("Cette marque te propose combien ?");
    expect(html).toContain('id="methode"');
    const levels = [...html.matchAll(/<h([1-6])/g)].map((m) => Number(m[1]));
    for (let i = 1; i < levels.length; i++) expect(levels[i] - levels[i - 1], `h${levels[i - 1]} → h${levels[i]}`).toBeLessThanOrEqual(1);
    for (const plan of PLANS) expect(html).toContain(plan.price);
    expect(html).toContain("Ta première analyse est gratuite");
    expect(html).toContain("On ne lit que ce qui est écrit dans l&#x27;offre.");
    expect(html).toContain("Gratuit · sans compte · 30");
    // Aucun témoignage, avis ou compteur inventé.
    expect(html).not.toMatch(/témoign|avis client|★|créateurs nous font|\d[\d\s]* créateurs/i);
  });
});
