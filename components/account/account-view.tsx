import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { BoneLine, LoadingAnnouncement } from "@/components/ui/skeleton";
import type { AccountSummary } from "@/lib/account/summary";
import { SOLDE_EPUISE, SOLDE_ILLIMITE, negotiations, soldeTexte, soldeTon } from "@/lib/content/labels";

const DATE = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" });

// Page Mon compte. data null : squelette (app/compte/loading.tsx), même
// structure et mêmes hauteurs, sans aucune donnée. Le squelette montre les trois
// lignes communes à tous les comptes, jamais celles d'un abonnement (C4).
//
// Mission #183 — LA LIGNE « NÉGOCIATION GRATUITE » A ÉTÉ RETIRÉE.
//
// Elle venait de la #067, à une époque où cette page affichait
// « Négociations restantes : credits.balance » — la réserve ACHETÉE, donc 0
// pour un compte gratuit, sans dire si la gratuité était encore là. La #182 a
// remplacé ce nombre par le solde réel : il vaut 1 quand la gratuité est
// disponible et 0 quand elle est prise. Les deux lignes disaient alors le même
// fait, l'une avec un nombre et l'autre avec une phrase.

export function AccountView({
  data,
}: {
  data: {
    email: string | null;
    summary: AccountSummary;
    // Mission #182 — ce qu'il reste VRAIMENT (lib/billing/entitlement.ts), et
    // plus credits.balance. Dans « restantes », trois valeurs distinctes qu'il
    // ne faut pas confondre : un nombre, null pour AUCUN PLAFOND, et
    // « illisible » quand la lecture a échoué. Un plafond absent se dit
    // « illimité » ; une lecture ratée ne se dit pas en nombre.
    //
    // Mission #184 — la DATE DE RECHARGE entre avec le solde : sans elle, le
    // zéro ne peut pas dire ce qui se passe ensuite.
    solde?: { restantes: number | null; rechargeLe: Date | null; intact: boolean } | "illisible";
  } | null;
}) {
  const summary = data?.summary ?? null;
  // Le champ ABSENT veut dire qu'on n'a rien lu. À l'intérieur, restantes vaut
  // null pour « aucun plafond », et c'est une valeur légitime.
  const solde = data === null || data.solde === undefined ? "illisible" : data.solde;
  const restantes = solde === "illisible" ? "illisible" : solde.restantes;
  // La phrase entière, affichée sous la liste quand le ton n'est plus discret
  // — c'est-à-dire, sur cet écran, quand il ne reste rien. Elle vient du même
  // endroit que celle de l'en-tête et de l'écran de saisie.
  const phrase =
    solde === "illisible" || soldeTon(solde.restantes, solde.intact) === "discret"
      ? null
      : soldeTexte(solde.restantes, solde.rechargeLe, solde.intact);
  return (
    <>
      <SiteHeader />
      <main id="contenu" className="mx-auto flex w-full max-w-md flex-1 flex-col gap-8 px-4 pt-10 pb-16 sm:px-6 md:pt-16 md:pb-24">
        {data ? null : <LoadingAnnouncement />}
        <h1 className="text-h1 font-extrabold">Mon compte</h1>

        <dl className="flex flex-col divide-y divide-filet border-y border-filet">
          <div className="flex justify-between gap-4 py-3">
            <dt className="text-sm text-attenue">Email</dt>
            <dd className="min-w-0 truncate text-right text-sm font-medium text-encre">
              {data ? (data.email ?? "—") : <BoneLine width="w-40" className="justify-end" />}
            </dd>
          </div>
          <div className="flex justify-between gap-4 py-3">
            <dt className="text-sm text-attenue">Formule</dt>
            <dd className="text-right text-sm font-medium text-encre">
              {summary ? summary.planLabel : <BoneLine width="w-20" className="justify-end" />}
            </dd>
          </div>
          <div className="flex justify-between gap-4 py-3">
            <dt className="text-sm text-attenue">Négociations restantes</dt>
            <dd data-restantes className="text-right text-sm font-medium text-encre">
              {data === null ? (
                <BoneLine width="w-8" className="justify-end" />
              ) : restantes === "illisible" ? (
                // Lecture impossible : on ne remplace pas par un zéro.
                "—"
              ) : restantes === null ? (
                SOLDE_ILLIMITE
              ) : restantes <= 0 ? (
                // Mission #184 — jamais « 0 négociation ». La valeur courte de
                // la #182, et la phrase qui dit la suite est sous la liste.
                SOLDE_EPUISE
              ) : (
                // « 1 négociation », pas « 1 négociation restante » : le
                // libellé de gauche le dit déjà.
                negotiations(restantes)
              )}
            </dd>
          </div>
          {summary?.accessEndsAt ? (
            <div className="flex justify-between gap-4 py-3">
              <dt className="text-sm text-attenue">Résiliation enregistrée</dt>
              <dd className="text-right text-sm font-medium text-encre">Accès jusqu&apos;au {DATE.format(summary.accessEndsAt)}</dd>
            </div>
          ) : summary?.periodEnd ? (
            <div className="flex justify-between gap-4 py-3">
              <dt className="text-sm text-attenue">Période en cours</dt>
              <dd className="text-right text-sm font-medium text-encre">Jusqu&apos;au {DATE.format(summary.periodEnd)}</dd>
            </div>
          ) : null}
        </dl>

        {/* Mission #184 — ce qui se passe ENSUITE : la date de recharge si le
            quota se recharge, sinon par où en obtenir d'autres. En pleine
            largeur, parce qu'une phrase ne tient pas dans la colonne des
            valeurs. Le lien vers les tarifs est déjà sous ce bloc. */}
        {phrase ? (
          <p data-solde-suite role="status" className="border-l-4 border-encre py-1 pl-3 text-small font-semibold text-encre">
            {phrase}
          </p>
        ) : null}

        <div className="flex flex-col gap-2">
          <Button asChild size="lg" className="h-12 text-base">
            <Link href="/historique">Mes négociations</Link>
          </Button>
          <Link href="/tarifs" className="link flex min-h-11 w-fit items-center font-semibold">
            Voir les tarifs
          </Link>
          {summary?.canCancel ? (
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
