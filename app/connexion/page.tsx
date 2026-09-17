import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/app/connexion/login-form";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { safeNextPath } from "@/lib/auth/session";
import { signedInRedirectPath } from "@/lib/auth/sign-in";
import { getViewer } from "@/lib/auth/viewer";

export const metadata: Metadata = {
  title: "Connexion",
  robots: { index: false, follow: false },
};

export default async function LoginPage({ searchParams }: PageProps<"/connexion">) {
  const params = await searchParams;
  const requested = typeof params.next === "string" ? params.next : null;
  const next = safeNextPath(requested);

  // Déjà connecté (session vérifiée auprès de Supabase, jamais l'indicateur
  // d'affichage) : pas de formulaire, on va là où il voulait aller, sinon au compte.
  if (await getViewer()) {
    redirect(signedInRedirectPath(requested));
  }
  const linkError = params.erreur === "lien";

  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-8 px-4 pt-10 pb-16 sm:px-6 md:pt-16 md:pb-24">
        <div className="flex flex-col gap-2">
          <h1 className="text-h1 font-extrabold">Connexion</h1>
          <p>
            Entre ton email, on t&apos;envoie un lien. Pas de mot de passe.
          </p>
        </div>
        {linkError ? (
          <p role="alert" className="border-l border-encre py-1 pl-3 text-sm font-semibold text-encre">
            Ce lien a expiré ou a déjà servi. Demande un nouveau lien.
          </p>
        ) : null}
        <LoginForm next={next} />
      </main>
      <SiteFooter />
    </>
  );
}
