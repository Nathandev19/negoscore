import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DELETION_CONFIRMATION_WORD, deletionBlocker } from "@/lib/account/deletion";
import { getViewer } from "@/lib/auth/viewer";
import { isProActive, periodEndsAt, type PlanState } from "@/lib/billing/plan-access";
import { SELLER } from "@/lib/legal/identity";
import { selectRows } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Supprimer mon compte",
  robots: { index: false, follow: false },
};

const DATE = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" });

const ERRORS: Record<string, string> = {
  confirmation: `Pour confirmer, écris ${DELETION_CONFIRMATION_WORD} dans le champ.`,
  indisponible: `La suppression n'a pas pu aboutir. Rien n'a été supprimé si ton compte est toujours accessible. Réessaie plus tard, ou écris-nous à ${SELLER.email}.`,
};

export default async function DeleteAccountPage({ searchParams }: PageProps<"/compte/supprimer">) {
  const user = await getViewer();
  if (!user) redirect(`/connexion?next=${encodeURIComponent("/compte/supprimer")}`);

  const [credits] = await selectRows<PlanState>(
    "credits",
    `select=plan,balance,period_end,cancelled_at&user_id=eq.${user.id}&limit=1`,
  );
  // Un abonnement encore prélevé se résilie d'abord.
  if (deletionBlocker(credits ?? null)) redirect("/resilier?motif=suppression");

  const params = await searchParams;
  const error = typeof params.erreur === "string" ? ERRORS[params.erreur] : null;
  const balance = credits?.balance ?? 0;
  const proEndsAt = isProActive(credits ?? null) ? periodEndsAt(credits ?? null) : null;

  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-4 pt-6 pb-12 sm:px-6 sm:pt-12">
        <h1 className="text-3xl font-black tracking-tight">Supprimer mon compte</h1>
        <p className="text-lg font-medium">La suppression est définitive. Elle ne peut pas être annulée.</p>

        {error ? (
          <p role="alert" className="text-sm font-medium text-red-700">
            {error}
          </p>
        ) : null}

        <section className="flex flex-col gap-2 rounded-xl border bg-white p-4">
          <h2 className="font-bold">Ce qui sera supprimé</h2>
          <ul className="list-disc pl-5 text-sm text-neutral-800">
            <li>Ton compte et ton adresse email de connexion</li>
            <li>Les offres que tu as déposées, et leurs fichiers</li>
            <li>Tes analyses</li>
            <li>Tes crédits d&apos;analyse</li>
          </ul>
        </section>

        <section className="flex flex-col gap-2 rounded-xl border bg-white p-4">
          <h2 className="font-bold">Ce qui sera conservé</h2>
          <ul className="list-disc pl-5 text-sm text-neutral-800">
            <li>L&apos;historique de tes paiements</li>
            <li>Tes preuves de consentement au moment du paiement</li>
          </ul>
          <p className="text-sm text-neutral-600">
            Ils documentent des transactions commerciales, que la loi nous oblige à conserver.
          </p>
        </section>

        {balance > 0 || proEndsAt ? (
          <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-900">
            {balance > 0
              ? `Il te reste ${balance} crédit${balance > 1 ? "s" : ""} d'analyse non consommé${balance > 1 ? "s" : ""}. ${balance > 1 ? "Ils seront perdus et ne sont" : "Il sera perdu et n'est"} pas remboursé${balance > 1 ? "s" : ""}.`
              : null}
            {balance > 0 && proEndsAt ? " " : null}
            {proEndsAt
              ? `Ton abonnement Pro résilié reste actif jusqu'au ${DATE.format(proEndsAt)} : cet accès sera perdu, sans remboursement.`
              : null}
          </p>
        ) : (
          <p className="text-sm text-neutral-700">Les crédits d&apos;analyse non consommés sont perdus et ne sont pas remboursés.</p>
        )}

        <form action="/api/compte/supprimer" method="post" className="flex flex-col gap-3">
          <label htmlFor="confirmation" className="text-sm font-medium">
            Pour confirmer, écris {DELETION_CONFIRMATION_WORD}
          </label>
          <Input
            id="confirmation"
            name="confirmation"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            required
            className="h-11 bg-white text-base"
          />
          <Button type="submit" variant="destructive" className="h-12 w-full text-base">
            Supprimer définitivement mon compte
          </Button>
        </form>

        <Button asChild variant="outline" className="h-11">
          <Link href="/compte">Garder mon compte</Link>
        </Button>
      </main>
      <SiteFooter />
    </>
  );
}
