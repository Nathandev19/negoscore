import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { MobileAnalyzeBar } from "@/components/mobile-analyze-bar";
import { NavPending } from "@/components/nav-pending";
import { exampleHrefFrom } from "@/lib/analytics/views";
import { BRAND } from "@/lib/brand";
import { FULL_EXAMPLE } from "@/lib/content/vocabulaire";
import { SELLER } from "@/lib/legal/identity";

type FooterLink = { href: string; label: string };

export const FOOTER_COLUMNS: Array<{ title: string; links: FooterLink[] }> = [
  {
    title: "Produit",
    links: [
      { href: "/#methode", label: "Comment ça marche" },
      { href: "/tarifs", label: "Tarifs" },
      { href: "/analyse", label: "Analyser un deal" },
    ],
  },
  {
    // Pages de contenu (mission #054) : elles sortent de la colonne Produit
    // dès qu'il y en a deux.
    title: "Guides",
    links: [
      { href: "/combien-facturer", label: "Combien facturer" },
      { href: "/droits-utilisation", label: "Droits d'utilisation" },
      { href: "/produits-offerts", label: "Produits offerts" },
      // Mission #158 — quatrième guide. Le pied de page est un EMPLACEMENT :
      // on ne sait pas depuis quelle page on a cliqué, donc pas d'origine ici
      // non plus (même raison que pour l'exemple, #152).
      { href: "/droits-pub-6-mois", label: "Droits pub 6 mois" },
      // Mission #152 — l'exemple chiffré, à côté des guides : c'est la même
      // chose qu'eux, une page qui montre avant de demander. Le pied de page
      // est sur toutes les pages, donc ce lien est le seul chemin vers
      // l'exemple depuis /tarifs, /analyse ou un guide.
      // `?de=` et pas d'utm : voir le commentaire de app/page.tsx.
      { href: exampleHrefFrom("pied-de-page"), label: FULL_EXAMPLE.label },
    ],
  },
  {
    title: "Légal",
    links: [
      { href: "/mentions-legales", label: "Mentions légales" },
      { href: "/confidentialite", label: "Politique de confidentialité" },
      { href: "/cgv", label: "CGV" },
      // « Médiateur » (/cgv#mediation) reviendra quand l'adhésion à un médiateur
      // sera effective et ses coordonnées publiées. La section existe déjà dans
      // les CGV et dit où en est l'adhésion (mission #061).
    ],
  },
];

const LINK = "text-encre-douce decoration-1 underline-offset-4 transition-colors duration-150 hover:text-encre hover:underline";

export function SiteFooter() {
  return (
    <footer className="border-t border-encre">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-12 px-4 pt-10 pb-8 text-small sm:px-6">
        {/* Quatre blocs depuis la colonne « Guides » (#054) : deux par ligne
            dès 640 px, tous alignés à partir de 1024 px. */}
        <div className="grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_2fr]">
          {FOOTER_COLUMNS.map((column) => (
            <div key={column.title} className="flex flex-col gap-2">
              <h2 className="font-sans text-xs font-semibold tracking-wide text-attenue uppercase">{column.title}</h2>
              <ul className="flex flex-col gap-2">
                {column.links.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className={`${LINK} relative`}>
                      {link.label}
                      <NavPending />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <div className="flex flex-col gap-2">
            <h2 className="font-sans text-xs font-semibold tracking-wide text-attenue uppercase">{BRAND.name}</h2>
            <p>
              <a href={`mailto:${SELLER.email}`} className={LINK}>
                {SELLER.email}
              </a>
            </p>
            <p className="measure">
              {BRAND.name} est édité par un auto-entrepreneur immatriculé en France.{" "}
              <Link href="/mentions-legales" className="link">
                Voir les mentions légales
              </Link>
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-3 border-t border-filet pt-5 text-attenue sm:flex-row sm:items-center sm:justify-between">
          <p className="measure">Analyse éducative fondée sur des benchmarks de marché. Ce n&apos;est pas un conseil juridique.</p>
          <p className="flex items-center gap-2">
            <Logo variant="marque" withName={false} size={18} />
            <span>{BRAND.name}</span>
          </p>
        </div>
      </div>
      <MobileAnalyzeBar />
    </footer>
  );
}
