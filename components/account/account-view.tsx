import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { BoneLine, LoadingAnnouncement } from "@/components/ui/skeleton";
import type { AccountSummary } from "@/lib/account/summary";
import { SOLDE_ILLIMITE, negotiations } from "@/lib/content/labels";

const DATE = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" });

// Page Mon compte. data null : squelette (app/compte/loading.tsx), même
// structure et mêmes hauteurs, sans aucune donnée. Le squelette montre les trois
// lignes communes à tous les comptes, jamais celles d'un abonnement (C4).
// freeAnalysis : compte gratuit seulement, l'état réel de son analyse gratuite
// (mission #067). null ou absent : ligne non affichée.
export const FREE_ANALYSIS_LABEL = { available: "Encore disponible", used: "Déjà utilisée" } as const;

export function AccountView({
  data,
}: {
  data: {
    email: string | null;
    summary: AccountSummary;
    freeAnalysis?: keyof typeof FREE_ANALYSIS_LABEL | null;
    // Mission #182 — ce qu'il reste VRAIMENT (lib/billing/entitlement.ts), et
    // plus credits.balance. Trois valeurs distinctes, et il ne faut pas les
    // confondre : un nombre, null pour AUCUN PLAFOND, et « illisible » quand
    // la lecture a échoué. Un plafond absent se dit « illimité » ; une lecture
    // ratée ne se dit pas en nombre.
    restantes?: number | null | "illisible";
  } | null;
}) {
  const summary = data?.summary ?? null;
  // ?? ne convient PAS ici : null est une valeur LÉGITIME (aucun plafond),
  // et un ?? l'écraserait en « illisible ». Seul le champ ABSENT veut dire
  // qu'on n'a rien lu.
  const restantes = data === null || data.restantes === undefined ? "illisible" : data.restantes;
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
          {data?.freeAnalysis ? (
            <div className="flex justify-between gap-4 py-3">
              <dt className="text-sm text-attenue">Négociation gratuite</dt>
              <dd data-free-analysis={data.freeAnalysis} className="text-right text-sm font-medium text-encre">
                {FREE_ANALYSIS_LABEL[data.freeAnalysis]}
              </dd>
            </div>
          ) : null}
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
              ) : (
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
