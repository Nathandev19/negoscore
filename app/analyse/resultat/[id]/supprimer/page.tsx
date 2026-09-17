import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { loadResultForViewer } from "@/lib/analysis/load";
import { getViewer } from "@/lib/auth/viewer";
import { ANON_COOKIE } from "@/lib/security/request";

export const metadata: Metadata = {
  title: "Supprimer cette analyse",
  robots: { index: false, follow: false },
};

// Confirmation explicite avant une suppression sans retour. Même contrôle
// d'accès que la page de résultat : un visiteur qui n'en est pas l'auteur
// obtient une page introuvable.
export default async function DeleteAnalysisPage({ params, searchParams }: PageProps<"/analyse/resultat/[id]/supprimer">) {
  const { id } = await params;
  const query = await searchParams;
  const anonToken = (await cookies()).get(ANON_COOKIE)?.value ?? null;
  const user = await getViewer();
  const result = await loadResultForViewer(id, { user, anonToken });
  if (!result) notFound();

  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-4 pt-6 pb-12 sm:px-6 sm:pt-12">
        <h1 className="text-h1 font-extrabold tracking-tight">Supprimer cette analyse</h1>
        {query.erreur === "indisponible" ? (
          <p role="alert" className="text-small font-medium text-band-bad-text">
            La suppression n&apos;a pas pu aboutir. Réessaie dans quelques minutes.
          </p>
        ) : null}
        <p className="text-body">
          La suppression est immédiate et définitive. Sont supprimés : l&apos;analyse, le texte de l&apos;offre et le
          fichier que tu as déposé, s&apos;il y en a un.
        </p>
        <form action={`/api/analyses/${id}/supprimer`} method="post" className="flex flex-col gap-3">
          <input type="hidden" name="confirmation" value="oui" />
          <Button type="submit" variant="destructive" className="h-12 w-full text-base">
            Supprimer définitivement
          </Button>
        </form>
        <Button asChild variant="outline" className="h-11">
          <Link href={`/analyse/resultat/${id}`}>Garder cette analyse</Link>
        </Button>
      </main>
      <SiteFooter />
    </>
  );
}
