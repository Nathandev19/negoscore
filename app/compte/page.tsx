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
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-4 pt-6 pb-12 sm:px-6 sm:pt-12">
        <h1 className="text-3xl font-black tracking-tight">Mon compte</h1>

        <dl className="divide-y rounded-xl border bg-white">
          <div className="flex justify-between gap-4 px-4 py-3">
            <dt className="text-sm text-neutral-600">Email</dt>
            <dd className="min-w-0 truncate text-right text-sm font-medium">{user.email ?? "—"}</dd>
          </div>
          <div className="flex justify-between gap-4 px-4 py-3">
            <dt className="text-sm text-neutral-600">Offre</dt>
            <dd className="text-right text-sm font-medium">{summary.planLabel}</dd>
          </div>
          <div className="flex justify-between gap-4 px-4 py-3">
            <dt className="text-sm text-neutral-600">Crédits d&apos;analyse</dt>
            <dd className="text-right text-sm font-medium">{summary.balance}</dd>
          </div>
          {summary.accessEndsAt ? (
            <div className="flex justify-between gap-4 px-4 py-3">
              <dt className="text-sm text-neutral-600">Résiliation enregistrée</dt>
              <dd className="text-right text-sm font-medium">Accès jusqu&apos;au {DATE.format(summary.accessEndsAt)}</dd>
            </div>
          ) : summary.periodEnd ? (
            <div className="flex justify-between gap-4 px-4 py-3">
              <dt className="text-sm text-neutral-600">Période en cours</dt>
              <dd className="text-right text-sm font-medium">Jusqu&apos;au {DATE.format(summary.periodEnd)}</dd>
            </div>
          ) : null}
        </dl>

        <div className="flex flex-col gap-3">
          <Button asChild className="h-11">
            <Link href="/historique">Mes analyses</Link>
          </Button>
          <Button asChild variant="outline" className="h-11">
            <Link href="/offres">Voir les offres</Link>
          </Button>
          {summary.canCancel ? (
            <Link href="/resilier" className="text-center text-sm text-neutral-600 underline">
              Résilier votre contrat
            </Link>
          ) : null}
        </div>

        <form action="/auth/deconnexion" method="post">
          <Button type="submit" variant="outline" className="h-11 w-full">
            Se déconnecter
          </Button>
        </form>

        <Link href="/compte/supprimer" className="text-center text-sm text-red-700 underline">
          Supprimer mon compte
        </Link>
      </main>
      <SiteFooter />
    </>
  );
}
