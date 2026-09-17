import Link from "next/link";
import { BRAND } from "@/lib/brand";

// En-tête sans état : la page serveur dit seulement si une session est présente.
// Les pages protégées vérifient elles-mêmes l'utilisateur auprès de Supabase.
export function HeaderNav({ signedIn, email }: { signedIn: boolean; email?: string | null }) {
  const initial = email?.trim().charAt(0).toUpperCase() || "?";
  return (
    <header className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
      <Link href="/" className="text-sm font-semibold tracking-tight">
        {BRAND.name}
      </Link>
      {signedIn ? (
        <nav aria-label="Compte" className="flex items-center gap-4 text-sm">
          <Link href="/historique" className="font-medium underline-offset-4 hover:underline">
            Mes analyses
          </Link>
          <Link
            href="/compte"
            aria-label="Mon compte, connecté"
            className="flex items-center gap-2 rounded-full border border-neutral-300 bg-white py-1 pr-3 pl-1 font-medium"
          >
            <span
              aria-hidden
              className="flex size-6 items-center justify-center rounded-full bg-neutral-900 text-xs font-bold text-white"
            >
              {initial}
            </span>
            Compte
          </Link>
        </nav>
      ) : (
        <nav aria-label="Compte" className="text-sm">
          <Link href="/connexion" className="font-medium underline underline-offset-4">
            Se connecter
          </Link>
        </nav>
      )}
    </header>
  );
}
