import Link from "next/link";
import { BRAND } from "@/lib/brand";

// En-tête sans état. signedIn vaut null tant que le navigateur n'a pas lu
// l'indicateur de session (page statique, avant hydratation) : la zone des
// liens garde sa hauteur mais reste invisible, pour ne montrer ni un état faux
// ni un saut de mise en page quand le bon état apparaît.
export function HeaderNav({ signedIn }: { signedIn: boolean | null }) {
  return (
    <header className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-3 px-4 sm:px-6">
      <Link href="/" className="text-sm font-semibold tracking-tight">
        {BRAND.name}
      </Link>
      {signedIn === null ? (
        <div aria-hidden className="h-8" />
      ) : signedIn ? (
        <nav aria-label="Compte" className="flex h-8 items-center gap-4 text-sm">
          <Link href="/historique" className="font-medium underline-offset-4 hover:underline">
            Mes analyses
          </Link>
          <Link
            href="/compte"
            className="flex h-8 items-center rounded-full border border-neutral-300 bg-white px-3 font-medium"
          >
            Compte
          </Link>
        </nav>
      ) : (
        <nav aria-label="Compte" className="flex h-8 items-center text-sm">
          <Link href="/connexion" className="font-medium underline underline-offset-4">
            Se connecter
          </Link>
        </nav>
      )}
    </header>
  );
}
