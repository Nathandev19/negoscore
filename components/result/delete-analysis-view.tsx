import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Bone, BoneLine, LoadingAnnouncement } from "@/components/ui/skeleton";

// Confirmation avant de supprimer une analyse. data null : squelette
// (loading.tsx) ; le texte est le même pour toutes les analyses, seuls le bouton
// et le lien, qui portent l'identifiant, sont remplacés par des os.
export function DeleteAnalysisView({ data }: { data: { id: string; unavailable: boolean } | null }) {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-8 px-4 pt-10 pb-16 sm:px-6 md:pt-16 md:pb-24">
        {data ? null : <LoadingAnnouncement />}
        <h1 className="text-h1 font-extrabold">Supprimer cette analyse</h1>
        {data?.unavailable ? (
          <p role="alert" className="alert-bad py-1 text-small">
            La suppression n&apos;a pas pu aboutir. Réessaie dans quelques minutes.
          </p>
        ) : null}
        <p className="text-body">
          La suppression est immédiate et définitive. Sont supprimés : l&apos;analyse, le texte de l&apos;offre et le
          fichier que tu as déposé, s&apos;il y en a un.
        </p>
        {data ? (
          <form action={`/api/analyses/${data.id}/supprimer`} method="post" className="flex flex-col gap-3">
            <input type="hidden" name="confirmation" value="oui" />
            <Button type="submit" variant="destructive" size="lg" className="h-12 w-full text-base">
              Supprimer définitivement
            </Button>
          </form>
        ) : (
          <div aria-hidden className="flex flex-col gap-3">
            <Bone className="h-12 w-full rounded-control" />
          </div>
        )}
        {data ? (
          <Link href={`/analyse/resultat/${data.id}`} className="link flex min-h-11 w-fit items-center font-semibold">
            Garder cette analyse
          </Link>
        ) : (
          <span aria-hidden className="flex min-h-11 items-center">
            <BoneLine width="w-44" />
          </span>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
