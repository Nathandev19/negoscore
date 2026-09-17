import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { NavPending } from "@/components/nav-pending";
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
      // « Médiateur » (/cgv#mediation) revient quand la section des CGV sera remplie :
      // elle est encore en [[À COMPLÉTER]], le lien mènerait à un emplacement vide.
    ],
  },
];

const LINK = "text-encre-douce decoration-1 underline-offset-4 transition-colors duration-150 hover:text-encre hover:underline";

export function SiteFooter() {
  return (
    <footer className="border-t border-encre">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-12 px-4 pt-10 pb-8 text-small sm:px-6">
        <div className="grid gap-x-8 gap-y-10 sm:grid-cols-[1fr_1fr_2fr]">
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
    </footer>
  );
}
