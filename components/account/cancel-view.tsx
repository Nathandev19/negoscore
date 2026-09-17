import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { BoneLine, LoadingAnnouncement } from "@/components/ui/skeleton";
import { isCancelled, isProActive, periodEndsAt, type PlanState } from "@/lib/billing/plan-access";
import { PRICE, PRO_PERIOD } from "@/lib/billing/plans";

const DATE = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" });

export type CancelViewData = {
  credits: PlanState | null;
  error: string | null;
  // Arrivée depuis la suppression de compte : un abonnement prélevé se résilie d'abord.
  forDeletion: boolean;
  // Retour de /api/resilier : « resilie » ou « deja ».
  etat: string | null;
};

// Page Résilier votre contrat. data null : squelette (app/resilier/loading.tsx).
// Le squelette ne sait pas si un abonnement est en cours et ne le laisse pas
// deviner (C4) : il réserve un bloc neutre de trois lignes.
export function CancelView({ data }: { data: CancelViewData | null }) {
  return (
    <>
      <SiteHeader />
      <main id="contenu" className="mx-auto flex w-full max-w-md flex-1 flex-col gap-8 px-4 pt-10 pb-16 sm:px-6 md:pt-16 md:pb-24">
        {data ? null : <LoadingAnnouncement />}
        <h1 className="text-h1 font-extrabold">Résilier votre contrat</h1>
        {data ? <CancelContent data={data} /> : <CancelSkeleton />}
      </main>
      <SiteFooter />
    </>
  );
}

function CancelSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-4">
      <BoneLine width="w-4/5" className="text-lg" />
      <span className="flex flex-col">
        <BoneLine />
        {/* Le paragraphe tient sur une ligne dès 640 px. */}
        <BoneLine width="w-3/5" className="sm:hidden" />
      </span>
      <span className="flex min-h-11 items-center">
        <BoneLine width="w-40" />
      </span>
    </div>
  );
}

function CancelContent({ data }: { data: CancelViewData }) {
  const { credits, error, forDeletion, etat } = data;
  const justCancelled = etat === "resilie";
  // Nos propres données font foi : aucun appel au prestataire de paiement.
  const isPro = isProActive(credits);
  const alreadyCancelled = justCancelled || etat === "deja" || isCancelled(credits);
  const endsAtValue = periodEndsAt(credits);
  const endsAt = endsAtValue ? DATE.format(endsAtValue) : null;

  return (
    <>
      {forDeletion ? (
        <p role="status" className="border-l-4 border-encre py-1 pl-3 text-sm font-semibold text-encre">
          Ton abonnement Pro est encore actif : il continuerait d&apos;être prélevé. Résilie-le d&apos;abord, puis tu
          pourras supprimer ton compte depuis la page Mon compte.
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="alert-bad py-1 text-sm">
          {error}
        </p>
      ) : null}

      {!isPro ? (
        <div className="flex flex-col gap-4">
          <p className="text-lg font-semibold text-encre">Tu n&apos;as aucun abonnement en cours.</p>
          <p>
            {credits && credits.balance > 0
              ? `Il te reste ${credits.balance} analyse${credits.balance > 1 ? "s" : ""} achetée${credits.balance > 1 ? "s" : ""} : elles n'expirent pas.`
              : "Rien n'est prélevé sur ton compte."}
          </p>
          <Link href="/historique" className="link flex min-h-11 w-fit items-center font-semibold">
            Retour à mon compte
          </Link>
        </div>
      ) : alreadyCancelled ? (
        <div className="flex flex-col gap-4">
          <p className="text-lg font-semibold text-encre" role="status">
            Ta résiliation est enregistrée.
          </p>
          <p>
            {endsAt
              ? `Ton abonnement Pro reste actif jusqu'au ${endsAt}, puis il s'arrête. Aucun nouveau paiement ne sera prélevé.`
              : "Ton abonnement Pro s'arrête à la fin de la période en cours. Aucun nouveau paiement ne sera prélevé."}
          </p>
          <p>Les crédits d&apos;analyse achetés séparément restent acquis.</p>
          <Link href="/historique" className="link flex min-h-11 w-fit items-center font-semibold">
            Retour à mon compte
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1 border-y border-filet py-4">
            {/* Prix repris de la source unique : la page de résiliation ne peut pas annoncer un autre tarif que celui vendu. */}
            <p className="font-display text-h3 font-bold text-encre">
              Abonnement Pro — {PRICE.pro} {PRO_PERIOD}
            </p>
            <p className="text-sm text-attenue">{endsAt ? `Période en cours jusqu'au ${endsAt}.` : "Période en cours."}</p>
          </div>
          <p>
            La résiliation est gratuite et prend effet à la fin de la période en cours : tu gardes ton accès jusque-là.
            Les crédits d&apos;analyse achetés séparément restent acquis.
          </p>
          <form action="/api/resilier" method="post">
            <Button type="submit" size="lg" className="h-12 w-full text-base">
              Résilier mon abonnement
            </Button>
          </form>
          <Link href="/historique" className="link flex min-h-11 w-fit items-center font-semibold">
            Garder mon abonnement
          </Link>
        </div>
      )}
    </>
  );
}
