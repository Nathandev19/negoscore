import { CreditsWaiter } from "@/components/merci/credits-waiter";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { BoneLine, LoadingAnnouncement } from "@/components/ui/skeleton";

type Credits = { plan: "free" | "pack" | "pro"; balance: number; period_end: string | null };

// Page Merci. credits undefined : squelette (app/merci/loading.tsx), à la place
// de la phrase d'attente du paiement (deux lignes de texte large), sans rien
// laisser deviner du solde.
export function ThanksView({ credits }: { credits?: Credits | null }) {
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
          <CreditsWaiter initial={credits} />
        )}
      </main>
      <SiteFooter />
    </>
  );
}
