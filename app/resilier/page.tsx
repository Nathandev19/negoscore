import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { getViewer } from "@/lib/auth/viewer";
import { isCancelled, isProActive, periodEndsAt, type PlanState } from "@/lib/billing/plan-access";
import { SELLER } from "@/lib/legal/identity";
import { selectRows } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Résilier votre contrat",
  robots: { index: false, follow: false },
};

const DATE = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" });

const ERRORS: Record<string, string> = {
  introuvable: `On n'a pas retrouvé ton abonnement chez le prestataire de paiement. Écris-nous à ${SELLER.email}, on s'en occupe.`,
  whop: `La résiliation n'a pas pu être enregistrée. Réessaie dans quelques minutes, ou écris-nous à ${SELLER.email}.`,
  indisponible: `Le service de résiliation n'est pas disponible pour le moment. Réessaie plus tard, ou écris-nous à ${SELLER.email}.`,
};

export default async function CancelPage({ searchParams }: PageProps<"/resilier">) {
  const user = await getViewer();
  if (!user) redirect(`/connexion?next=${encodeURIComponent("/resilier")}`);

  const params = await searchParams;
  const error = typeof params.erreur === "string" ? ERRORS[params.erreur] : null;
  // Arrivée depuis la suppression de compte : un abonnement prélevé se résilie d'abord.
  const forDeletion = params.motif === "suppression";
  const justCancelled = params.etat === "resilie";

  const [credits] = await selectRows<PlanState>(
    "credits",
    `select=plan,balance,period_end,cancelled_at&user_id=eq.${user.id}&limit=1`,
  );
  // Nos propres données font foi : aucun appel au prestataire de paiement.
  const isPro = isProActive(credits ?? null);
  const alreadyCancelled = justCancelled || params.etat === "deja" || isCancelled(credits ?? null);
  const endsAtValue = periodEndsAt(credits ?? null);
  const endsAt = endsAtValue ? DATE.format(endsAtValue) : null;

  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-8 px-4 pt-10 pb-16 sm:px-6 md:pt-16 md:pb-24">
        <h1 className="text-h1 font-extrabold">Résilier votre contrat</h1>

        {forDeletion ? (
          <p role="status" className="border-y border-encre py-3 text-sm font-semibold text-encre">
            Ton abonnement Pro est encore actif : il continuerait d&apos;être prélevé. Résilie-le d&apos;abord, puis tu
            pourras supprimer ton compte depuis la page Mon compte.
          </p>
        ) : null}

        {error ? (
          <p role="alert" className="border-l border-encre py-1 pl-3 text-sm font-semibold text-encre">
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
              <p className="font-display text-h3 font-bold text-encre">Abonnement Pro — 12,99 € par mois</p>
              <p className="text-sm text-attenue">
                {endsAt ? `Période en cours jusqu'au ${endsAt}.` : "Période en cours."}
              </p>
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
      </main>
      <SiteFooter />
    </>
  );
}
