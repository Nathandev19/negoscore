import { Suspense } from "react";
import { LinkError, LinkErrorFromUrl } from "@/app/connexion/login-from-url";
import { LoginForm } from "@/app/connexion/login-form";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

// Contenu commun de /connexion et /connexion/lien-expire (mission #074).
// Pages statiques (mission #045) : elles se préchargent, un clic les affiche
// sans rendu serveur. Une personne déjà connectée est redirigée par proxy.ts.
//
// Le formulaire est toujours au même endroit de l'arbre, hors de tout
// <Suspense> : après un envoi sans JavaScript, le serveur rend la page avec le
// résultat de l'action, et React ne le rattache au formulaire que s'il le
// retrouve à la même place.
//
// linkExpired : l'erreur de lien est écrite dans la page elle-même (lisible
// sans JavaScript), au lieu d'être déduite de ?erreur=lien dans le navigateur.
export function LoginPageContent({ linkExpired = false }: { linkExpired?: boolean }) {
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
        {linkExpired ? (
          <LinkError />
        ) : (
          <Suspense fallback={null}>
            <LinkErrorFromUrl />
          </Suspense>
        )}
        <LoginForm />
      </main>
      <SiteFooter />
    </>
  );
}
