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
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-4 pt-6 pb-12 sm:px-6 sm:pt-12">
        <h1 className="text-3xl font-black tracking-tight">Résilier votre contrat</h1>

        {forDeletion ? (
          <p role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm font-medium text-amber-950">
            Ton abonnement Pro est encore actif : il continuerait d&apos;être prélevé. Résilie-le d&apos;abord, puis tu
            pourras supprimer ton compte depuis la page Mon compte.
          </p>
        ) : null}

        {error ? (
          <p role="alert" className="text-sm font-medium text-red-700">
            {error}
          </p>
        ) : null}

        {!isPro ? (
          <div className="flex flex-col gap-4">
            <p className="text-lg font-medium">Tu n&apos;as aucun abonnement en cours.</p>
            <p className="text-neutral-700">
              {credits && credits.balance > 0
                ? `Il te reste ${credits.balance} analyse${credits.balance > 1 ? "s" : ""} achetée${credits.balance > 1 ? "s" : ""} : elles n'expirent pas.`
                : "Rien n'est prélevé sur ton compte."}
            </p>
            <Button asChild variant="outline" className="h-11">
              <Link href="/historique">Retour à mon compte</Link>
            </Button>
          </div>
        ) : alreadyCancelled ? (
          <div className="flex flex-col gap-4">
            <p className="text-lg font-medium" role="status">
              Ta résiliation est enregistrée.
            </p>
            <p className="text-neutral-700">
              {endsAt
                ? `Ton abonnement Pro reste actif jusqu'au ${endsAt}, puis il s'arrête. Aucun nouveau paiement ne sera prélevé.`
                : "Ton abonnement Pro s'arrête à la fin de la période en cours. Aucun nouveau paiement ne sera prélevé."}
            </p>
            <p className="text-neutral-700">Les crédits d&apos;analyse achetés séparément restent acquis.</p>
            <Button asChild variant="outline" className="h-11">
              <Link href="/historique">Retour à mon compte</Link>
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1 rounded-xl border bg-white p-4">
              <p className="font-bold">Abonnement Pro — 12,99 € par mois</p>
              <p className="text-sm text-neutral-700">
                {endsAt ? `Période en cours jusqu'au ${endsAt}.` : "Période en cours."}
              </p>
            </div>
            <p className="text-neutral-700">
              La résiliation est gratuite et prend effet à la fin de la période en cours : tu gardes ton accès jusque-là.
              Les crédits d&apos;analyse achetés séparément restent acquis.
            </p>
            <form action="/api/resilier" method="post">
              <Button type="submit" size="lg" className="h-12 w-full text-base">
                Résilier mon abonnement
              </Button>
            </form>
            <Button asChild variant="outline" className="h-11">
              <Link href="/historique">Garder mon abonnement</Link>
            </Button>
          </div>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
