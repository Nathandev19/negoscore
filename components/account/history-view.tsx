import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { BoneLine, LoadingAnnouncement } from "@/components/ui/skeleton";
import { BAND_STYLE, formatEur } from "@/lib/display";
import type { NegotiationSummary } from "@/lib/negotiation/history";
import { bandFor } from "@/lib/rates/score";
import { parseTier, TIER_LABEL } from "@/lib/rates/tier";
import { cn } from "@/lib/utils";

export type HistoryRow = {
  id: string;
  created_at: string;
  score: number | null;
  amount: number | null;
  evaluability: string | null;
  // Absent des analyses d'avant le schéma 1.4 : calculées au niveau confirmé.
  tier: string | null;
  // Mission #087 : l'échange avec la marque, s'il y a eu des tours.
  negotiation?: NegotiationSummary | null;
};

// Mission #087, B — où en est l'échange : c'est là qu'elle reprend.
export function negotiationState(summary: NegotiationSummary): string {
  return summary.concluded ? `Négociation conclue au tour ${summary.turn}` : `Négociation en cours, tour ${summary.turn}`;
}

function Score({ score, evaluability }: { score: number | null; evaluability: string | null }) {
  if (score === null) return <span className="text-sm font-semibold text-encre">{NO_SCORE_LABEL[evaluability ?? ""] ?? "—"}</span>;
  return (
    <span className="flex items-center gap-2">
      <span aria-hidden className={cn("size-3 shrink-0 rounded-pill", BAND_STYLE[bandFor(score)].onCreme)} />
      <span className="figures text-2xl text-encre">
        {score}
        <span className="font-sans text-sm font-medium text-attenue">/100</span>
      </span>
    </span>
  );
}

// Mission #087, A — après des tours : le montant et le score ACTUELS (ceux
// que la page affiche en tête), avec ceux d'origine à côté, en petit. Le chiffre
// principal est l'état présent du deal ; l'origine dit d'où il vient. Table de
// l'analyse disparue du code (C) : le score d'origine seul, et c'est dit.
function amountText(amount: number | null): string {
  return typeof amount === "number" ? formatEur(amount) : "montant non précisé";
}

// Analyse sans score : on dit pourquoi plutôt que d'afficher « —/100 ».
const NO_SCORE_LABEL: Record<string, string> = {
  terms_unknown: "À préciser",
  unpriced: "À chiffrer",
  incomplete: "Incomplète",
};

const DATE = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" });

// Nombre de lignes du squelette : fixe, sans rapport avec l'historique réel (C4).
const SKELETON_ROWS = 3;

// Page Tes analyses. rows null : squelette (app/historique/loading.tsx). Chaque
// ligne fantôme a la hauteur d'une vraie ligne (date, montant, niveau) ; la
// colonne du score n'a pas d'os, pour ne pas dessiner la forme d'un score.
export function HistoryView({ rows, negotiationUnavailable = false }: { rows: HistoryRow[] | null; negotiationUnavailable?: boolean }) {
  return (
    <>
      <SiteHeader />
      <main id="contenu" className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-4 pt-10 pb-16 sm:px-6 md:pt-16 md:pb-24">
        {rows ? null : <LoadingAnnouncement />}
        <h1 className="text-h1 font-extrabold">Tes négociations</h1>
        {rows && rows.length > 0 && negotiationUnavailable ? (
          <p role="note" className="border-l-4 border-encre py-1 pl-3 text-small">
            L&apos;état de tes négociations n&apos;a pas pu être lu : chaque ligne montre l&apos;offre d&apos;origine. Ouvre une
            analyse pour voir où en est l&apos;échange.
          </p>
        ) : null}
        {rows === null ? (
          <ul aria-hidden className="flex flex-col divide-y divide-filet border-y border-filet">
            {Array.from({ length: SKELETON_ROWS }, (_, index) => (
              <li key={index} data-skeleton-row className="flex items-center justify-between gap-4 py-4">
                <span className="flex flex-col">
                  <BoneLine width="w-36" className="font-semibold" />
                  <BoneLine width="w-28" className="text-sm" />
                  <BoneLine width="w-44" className="text-sm" />
                </span>
              </li>
            ))}
          </ul>
        ) : rows.length === 0 ? (
          <p>
            Aucune analyse pour l&apos;instant. <Link href="/analyse" className="link font-semibold">Analyser un deal</Link>
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-filet border-y border-filet">
            {rows.map((row) => (
              <li key={row.id}>
                <Link href={`/analyse/resultat/${row.id}`} className="group flex items-center justify-between gap-4 py-4">
                  <span className="flex flex-col">
                    <span className="font-semibold text-encre decoration-1 underline-offset-4 group-hover:underline">{DATE.format(new Date(row.created_at))}</span>
                    {row.negotiation ? (
                      <>
                        <span className="text-sm font-semibold text-encre">{negotiationState(row.negotiation)}</span>
                        <span className="text-sm text-attenue">
                          {row.negotiation.amountNow !== row.amount
                            ? `Offre : ${amountText(row.amount)} au départ, ${amountText(row.negotiation.amountNow)} aujourd'hui`
                            : `Offre : ${amountText(row.amount)}, inchangée`}
                        </span>
                      </>
                    ) : (
                      <span className="text-sm text-attenue">
                        {typeof row.amount === "number" ? `Offre : ${formatEur(row.amount)}` : "Montant non précisé"}
                      </span>
                    )}
                    {/* Niveau avec lequel le score ci-contre a été calculé (mission #039). */}
                    <span className="text-sm text-attenue">Niveau : {TIER_LABEL[parseTier(row.tier) ?? "confirmed"].short}</span>
                  </span>
                  {row.negotiation?.now ? (
                    <span className="flex flex-col items-end gap-0.5">
                      <Score score={row.negotiation.now.score} evaluability={row.negotiation.now.evaluability} />
                      <span className="text-xs text-attenue">
                        {row.score !== null ? `${row.score}/100 au départ` : `Au départ : ${NO_SCORE_LABEL[row.evaluability ?? ""] ?? "—"}`}
                      </span>
                    </span>
                  ) : row.negotiation ? (
                    <span className="flex flex-col items-end gap-0.5">
                      <Score score={row.score} evaluability={row.evaluability} />
                      <span className="max-w-40 text-right text-xs text-attenue">Score de l&apos;offre d&apos;origine, non recalculable</span>
                    </span>
                  ) : (
                    <Score score={row.score} evaluability={row.evaluability} />
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-col gap-1">
          <Link href="/resilier" className="link flex min-h-11 w-fit items-center text-sm">
            Résilier votre contrat
          </Link>
          <form action="/auth/deconnexion" method="post">
            <Button type="submit" variant="link" className="text-sm">
              Se déconnecter
            </Button>
          </form>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
