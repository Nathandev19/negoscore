import type { Metadata } from "next";
import { LoginForm } from "@/app/connexion/login-form";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { safeNextPath } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Connexion",
  robots: { index: false, follow: false },
};

export default async function LoginPage({ searchParams }: PageProps<"/connexion">) {
  const params = await searchParams;
  const next = safeNextPath(typeof params.next === "string" ? params.next : null);
  const linkError = params.erreur === "lien";

  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-4 pt-6 pb-12 sm:px-6 sm:pt-12">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-black tracking-tight">Connexion</h1>
          <p className="text-neutral-700">
            Entre ton email, on t&apos;envoie un lien. Pas de mot de passe.
          </p>
        </div>
        {linkError ? (
          <p role="alert" className="text-sm font-medium text-red-700">
            Ce lien a expiré ou a déjà servi. Demande un nouveau lien.
          </p>
        ) : null}
        <LoginForm next={next} />
      </main>
      <SiteFooter />
    </>
  );
}
