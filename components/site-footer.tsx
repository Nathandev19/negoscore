import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { BRAND } from "@/lib/brand";
import { SELLER } from "@/lib/legal/identity";

type FooterLink = { href: string; label: string };

export const FOOTER_COLUMNS: Array<{ title: string; links: FooterLink[] }> = [
  {
    title: "Produit",
    links: [
      { href: "/#methode", label: "Comment ça marche" },
      { href: "/offres", label: "Tarifs" },
      { href: "/analyse", label: "Analyser un deal" },
    ],
  },
  {
    title: "Légal",
    links: [
      { href: "/mentions-legales", label: "Mentions légales" },
      { href: "/confidentialite", label: "Politique de confidentialité" },
      { href: "/cgv", label: "CGV" },
      { href: "/cgv#mediation", label: "Médiateur" },
    ],
  },
];

const LINK = "rounded-sm text-copy underline-offset-4 transition-colors duration-150 hover:text-brand-strong hover:underline";

// Rendu statique : l'année est celle de la construction du site.
export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-surface-soft">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 py-12 text-small sm:px-6">
        <div className="grid gap-8 sm:grid-cols-3">
          {FOOTER_COLUMNS.map((column) => (
            <div key={column.title} className="flex flex-col gap-3">
              <h2 className="font-display text-h3 font-bold">{column.title}</h2>
              <ul className="flex flex-col gap-2">
                {column.links.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className={LINK}>
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <div className="flex flex-col gap-3">
            <h2 className="font-display text-h3 font-bold">{BRAND.name}</h2>
            <p>
              <a href={`mailto:${SELLER.email}`} className={LINK}>
                {SELLER.email}
              </a>
            </p>
            <p className="measure">
              {BRAND.name} est édité par un auto-entrepreneur immatriculé en France.{" "}
              <Link href="/mentions-legales" className={`${LINK} underline`}>
                Voir les mentions légales
              </Link>
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-3 border-t border-line pt-6 text-subtle sm:flex-row sm:items-center sm:justify-between">
          <p className="measure">Analyse éducative fondée sur des benchmarks de marché. Ce n&apos;est pas un conseil juridique.</p>
          <p className="flex items-center gap-2">
            <Logo variant="mark" size={18} />
            <span>© {new Date().getFullYear()}</span>
          </p>
        </div>
      </div>
    </footer>
  );
}
