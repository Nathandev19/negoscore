import type { ReactNode } from "react";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

// Gabarit commun aux pages légales, et marqueur visible à l'écran pour tout
// ce qui reste à fournir. Aucun texte juridique n'est rédigé ici.

export function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-10 px-4 pt-10 pb-16 sm:px-6 md:pt-16 md:pb-24">
        <div className="flex flex-col gap-2">
          <h1 className="text-h1 font-extrabold">{title}</h1>
          <p className="text-small text-attenue">Dernière mise à jour : {updated}</p>
        </div>
        <div className="flex flex-col gap-10">{children}</div>
      </main>
      <SiteFooter />
    </>
  );
}

export function LegalSection({ id, title, children }: { id?: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="measure flex flex-col gap-3 border-t border-filet pt-5">
      <h2 className="text-h2 font-bold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

export function ToFill({ children }: { children: ReactNode }) {
  return (
    <p className="border-y border-dashed border-encre py-3 text-sm font-semibold text-encre">
      [[À COMPLÉTER : {children}]]
    </p>
  );
}

export function Facts({ items }: { items: ReactNode[] }) {
  return (
    <ul className="flex list-disc flex-col gap-2 pl-5">
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}
