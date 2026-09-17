import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { accountSummary } from "@/lib/account/summary";
import { getViewer } from "@/lib/auth/viewer";
import type { PlanState } from "@/lib/billing/plan-access";
import { selectRows } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Mon compte",
  robots: { index: false, follow: false },
};

const DATE = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" });

// Le compte est une adresse email : son état, ses liens, sa fin.
export default async function AccountPage() {
  const user = await getViewer();
  if (!user) redirect(`/connexion?next=${encodeURIComponent("/compte")}`);

  const [credits] = await selectRows<PlanState>(
    "credits",
    `select=plan,balance,period_end,cancelled_at&user_id=eq.${user.id}&limit=1`,
  );
  const summary = accountSummary(credits ?? null);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-8 px-4 pt-10 pb-16 sm:px-6 md:pt-16 md:pb-24">
        <h1 className="text-h1 font-extrabold">Mon compte</h1>

        <dl className="flex flex-col divide-y divide-filet border-y border-filet">
          <div className="flex justify-between gap-4 py-3">
            <dt className="text-sm text-attenue">Email</dt>
            <dd className="min-w-0 truncate text-right text-sm font-medium text-encre">{user.email ?? "—"}</dd>
          </div>
          <div className="flex justify-between gap-4 py-3">
            <dt className="text-sm text-attenue">Offre</dt>
            <dd className="text-right text-sm font-medium text-encre">{summary.planLabel}</dd>
          </div>
          <div className="flex justify-between gap-4 py-3">
            <dt className="text-sm text-attenue">Crédits d&apos;analyse</dt>
            <dd className="text-right text-sm font-medium text-encre">{summary.balance}</dd>
          </div>
          {summary.accessEndsAt ? (
            <div className="flex justify-between gap-4 py-3">
              <dt className="text-sm text-attenue">Résiliation enregistrée</dt>
              <dd className="text-right text-sm font-medium text-encre">Accès jusqu&apos;au {DATE.format(summary.accessEndsAt)}</dd>
            </div>
          ) : summary.periodEnd ? (
            <div className="flex justify-between gap-4 py-3">
              <dt className="text-sm text-attenue">Période en cours</dt>
              <dd className="text-right text-sm font-medium text-encre">Jusqu&apos;au {DATE.format(summary.periodEnd)}</dd>
            </div>
          ) : null}
        </dl>

        <div className="flex flex-col gap-2">
          <Button asChild size="lg" className="h-12 text-base">
            <Link href="/historique">Mes analyses</Link>
          </Button>
          <Link href="/offres" className="link flex min-h-11 w-fit items-center font-semibold">
            Voir les offres
          </Link>
          {summary.canCancel ? (
            <Link href="/resilier" className="link flex min-h-11 w-fit items-center text-sm">
              Résilier votre contrat
            </Link>
          ) : null}
        </div>

        <div className="flex flex-col gap-1 border-t border-filet pt-4">
          <form action="/auth/deconnexion" method="post">
            <Button type="submit" variant="link" className="text-sm">
              Se déconnecter
            </Button>
          </form>
          <Link href="/compte/supprimer" className="link flex min-h-11 w-fit items-center text-sm">
            Supprimer mon compte
          </Link>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
