import { CreditsWaiter, type Bought } from "@/components/merci/credits-waiter";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { BoneLine, LoadingAnnouncement } from "@/components/ui/skeleton";

type Credits = { plan: "free" | "pack" | "pro"; balance: number; period_end: string | null };

// Page Merci. credits undefined : squelette (app/merci/loading.tsx), à la place
// de la phrase d'attente du paiement (deux lignes de texte large), sans rien
// laisser deviner du solde.
// bought : l'achat qui vient d'être payé, lu par le serveur (table purchases).
// « unknown » : pas lisible, la page n'affirme alors aucun achat.
export function ThanksView({ credits, bought = { purchase: null, duplicates: 0, analysesAdded: 0 } }: { credits?: Credits | null; bought?: Bought }) {
  const loading = credits === undefined;
  return (
    <>
      <SiteHeader />
      <main id="contenu" className="mx-auto flex w-full max-w-md flex-1 flex-col gap-8 px-4 pt-10 pb-16 sm:px-6 md:pt-16 md:pb-24">
        {loading ? <LoadingAnnouncement /> : null}
        <h1 className="text-h1 font-extrabold">Merci !</h1>
        {loading ? (
          <span aria-hidden className="flex flex-col text-lg font-semibold">
            <BoneLine />
            <BoneLine width="w-3/5" />
          </span>
        ) : (
          <CreditsWaiter initial={credits} bought={bought} />
        )}
      </main>
      <SiteFooter />
    </>
  );
}
