import Link from "next/link";
import { BRAND } from "@/lib/brand";

const LEGAL_LINKS = [
  { href: "/mentions-legales", label: "Mentions légales" },
  { href: "/confidentialite", label: "Confidentialité" },
  { href: "/cgv", label: "CGV" },
] as const;

export function SiteFooter() {
  return (
    <footer className="border-t bg-neutral-50">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-8 text-sm text-neutral-600 sm:px-6">
        <p>
          Analyse éducative fondée sur des benchmarks de marché. Ce n&apos;est pas un conseil
          juridique.
        </p>
        <nav className="flex flex-wrap gap-x-5 gap-y-2">
          {LEGAL_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="underline underline-offset-4">
              {link.label}
            </Link>
          ))}
        </nav>
        <p className="text-neutral-500">{BRAND.name}</p>
      </div>
    </footer>
  );
}
