import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginFromUrl } from "@/app/connexion/login-from-url";
import { LoginForm } from "@/app/connexion/login-form";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { safeNextPath } from "@/lib/auth/next-path";

export const metadata: Metadata = {
  title: "Connexion",
  robots: { index: false, follow: false },
};

// Page statique (mission #045) : elle se précharge, un clic l'affiche sans
// rendu serveur. Ce qui dépend de la requête a été sorti de la page :
//   - une personne déjà connectée est redirigée par proxy.ts, après
//     vérification de sa session auprès de Supabase ;
//   - ?next= et ?erreur=lien sont lus dans le navigateur (LoginFromUrl).
// Avant l'hydratation, le formulaire s'affiche à sa taille finale, avec le
// retour par défaut : rien ne bouge quand les paramètres sont lus.
export default function LoginPage() {
  return (
    <>
      <SiteHeader />
      <main id="contenu" className="mx-auto flex w-full max-w-md flex-1 flex-col gap-8 px-4 pt-10 pb-16 sm:px-6 md:pt-16 md:pb-24">
        <div className="flex flex-col gap-2">
          <h1 className="text-h1 font-extrabold">Connexion</h1>
          <p>
            Entre ton email, on t&apos;envoie un lien. Pas de mot de passe.
          </p>
        </div>
        <Suspense fallback={<LoginForm next={safeNextPath(null)} />}>
          <LoginFromUrl />
        </Suspense>
      </main>
      <SiteFooter />
    </>
  );
}
