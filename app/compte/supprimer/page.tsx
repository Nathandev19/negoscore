import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DELETION_CONFIRMATION_WORD, deletionBlocker } from "@/lib/account/deletion";
import { negotiations } from "@/lib/content/vocabulaire";
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
  // Mission #099, point 7 (audit B8) — un échec TECHNIQUE (une migration qui
  // n'est pas appliquée côté base) n'est pas la même chose qu'un refus métier.
  // Il ne se dit pas « réessaie plus tard » : rien ne changera sans nous.
  migration: `La suppression est momentanément impossible pour une raison technique de notre côté, et non à cause de ton compte. Rien n'a été supprimé. Écris-nous à ${SELLER.email} : on la fait manuellement, et on te confirme par écrit.`,
};

export default async function DeleteAccountPage({ searchParams }: PageProps<"/compte/supprimer">) {
  const user = await getViewer();
  if (!user) redirect(`/connexion?next=${encodeURIComponent("/compte/supprimer")}`);

  const [credits] = await selectRows<PlanState>(
    "credits",
    `select=plan,balance,period_end,cancelled_at&user_id=eq.${user.id}&limit=1`,
  );
  // Mission #099, point 7 (audit B7) — un abonnement encore prélevé se
  // résilie d'abord. Avant, la page redirigeait vers /resilier sans un mot :
  // on ne savait ni pourquoi on avait changé de page, ni quoi faire.
  const blocked = deletionBlocker(credits ?? null) !== null;

  const params = await searchParams;
  const error = typeof params.erreur === "string" ? ERRORS[params.erreur] : null;
  const balance = credits?.balance ?? 0;
  const proEndsAt = isProActive(credits ?? null) ? periodEndsAt(credits ?? null) : null;

  return (
    <>
      <SiteHeader />
      <main id="contenu" className="mx-auto flex w-full max-w-md flex-1 flex-col gap-8 px-4 pt-10 pb-16 sm:px-6 md:pt-16 md:pb-24">
        <h1 className="text-h1 font-extrabold">Supprimer mon compte</h1>
        <p className="text-lg font-semibold text-encre">La suppression est définitive. Elle ne peut pas être annulée.</p>

        {blocked ? (
          <section role="note" className="flex flex-col gap-3 border-l-4 border-encre py-1 pl-4">
            <h2 className="text-h3 font-bold">Ton abonnement Pro est encore actif</h2>
            <p className="text-sm">
              Supprimer ton compte maintenant ne l&apos;arrêterait pas : il continuerait à être prélevé chez Whop, qui
              encaisse les paiements, sans que tu aies un compte pour le voir. On ne supprime donc pas un compte qui porte
              un abonnement en cours.
            </p>
            <p className="text-sm">
              Résilie-le d&apos;abord, gratuitement et en ligne. La résiliation prend effet à la fin de la période déjà
              payée{proEndsAt ? ` (le ${DATE.format(proEndsAt)})` : ""} ; tu peux revenir supprimer ton compte dès qu&apos;elle
              est enregistrée, sans attendre cette date.
            </p>
            <p className="text-sm">
              <Link href="/resilier?motif=suppression" className="link font-semibold">
                Résilier mon abonnement
              </Link>
            </p>
          </section>
        ) : null}

        {error ? (
          <p role="alert" className="alert-bad py-1 text-sm">
            {error}
          </p>
        ) : null}

        {blocked ? null : (
        <>
        <section className="flex flex-col gap-2 border-t border-filet pt-4">
          <h2 className="text-h3 font-bold">Ce qui sera supprimé</h2>
          <ul className="list-disc pl-5 text-sm">
            <li>Ton compte et ton adresse email de connexion</li>
            <li>Les offres que tu as déposées, et leurs fichiers</li>
            <li>Tes analyses</li>
            <li>Tes négociations restantes</li>
          </ul>
        </section>

        <section className="flex flex-col gap-2 border-t border-filet pt-4">
          <h2 className="text-h3 font-bold">Ce qui sera conservé</h2>
          <ul className="list-disc pl-5 text-sm">
            <li>L&apos;historique de tes paiements</li>
            <li>Tes preuves de consentement au moment du paiement</li>
          </ul>
          <p className="text-sm text-attenue">
            Ils documentent des transactions commerciales, que la loi nous oblige à conserver.
          </p>
        </section>

        {balance > 0 || proEndsAt ? (
          <p className="alert-bad py-1 text-sm">
            {balance > 0
              ? `Il te reste ${negotiations(balance)} non ${balance > 1 ? "utilisées" : "utilisée"}. ${balance > 1 ? "Elles seront perdues et ne sont" : "Elle sera perdue et n'est"} pas ${balance > 1 ? "remboursées" : "remboursée"}.`
              : null}
            {balance > 0 && proEndsAt ? " " : null}
            {proEndsAt
              ? `Ton abonnement Pro résilié reste actif jusqu'au ${DATE.format(proEndsAt)} : cet accès sera perdu, sans remboursement.`
              : null}
          </p>
        ) : (
          <p className="text-sm">Les négociations non utilisées sont perdues et ne sont pas remboursées.</p>
        )}

        <form action="/api/compte/supprimer" method="post" className="flex flex-col gap-3">
          <label htmlFor="confirmation" className="text-sm font-semibold text-encre">
            Pour confirmer, écris {DELETION_CONFIRMATION_WORD}
          </label>
          <Input
            id="confirmation"
            name="confirmation"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            required
            className="h-11"
          />
          <Button type="submit" variant="destructive" size="lg" className="h-12 w-full text-base">
            Supprimer définitivement mon compte
          </Button>
        </form>
        </>
        )}

        <Link href="/compte" className="link flex min-h-11 w-fit items-center font-semibold">
          Garder mon compte
        </Link>
      </main>
      <SiteFooter />
    </>
  );
}
