import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

// Mission #089 bis — ce que voit quelqu'un dont l'authentification ne répond
// pas. Un seul texte, pour la page /session-indisponible (vers laquelle le
// proxy réécrit une page de compte) et pour les pages qui l'affichent
// elles-mêmes sans changer d'adresse.
//
// Ce qu'il ne dit JAMAIS : « connecte-toi », « tu n'es pas connectée »,
// « introuvable ». On ne sait rien de la session : l'affirmer serait faux une
// fois sur deux, et faux au pire moment, quand une abonnée a payé.
//
// Ce qu'il dit : ça vient de nous, ce n'est pas perdu, recharge.

export const SESSION_UNAVAILABLE_TITLE = "Ton compte est momentanément injoignable";

export function SessionUnavailable() {
  return (
    <>
      <SiteHeader />
      <main id="contenu" className="mx-auto flex w-full max-w-md flex-1 flex-col gap-8 px-4 pt-10 pb-16 sm:px-6 md:pt-16 md:pb-24">
        <div className="flex flex-col gap-3">
          <h1 className="text-h1 font-extrabold">{SESSION_UNAVAILABLE_TITLE}</h1>
          <p>
            La vérification de ta connexion ne répond pas pour le moment. Tu n&apos;as rien à refaire : recharge la page dans
            un instant.
          </p>
          <p>Rien n&apos;est perdu, et tu n&apos;as pas été déconnecté.</p>
        </div>
        <Link href="/" className="link flex min-h-11 w-fit items-center font-semibold">
          Retour à l&apos;accueil
        </Link>
      </main>
      <SiteFooter />
    </>
  );
}
