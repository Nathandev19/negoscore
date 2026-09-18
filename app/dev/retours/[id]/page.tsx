import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EntryItem } from "@/components/admin/feedback-report-view";
import { DealRecap, Estimate } from "@/components/result/analysis-blocks";
import { SiteHeader } from "@/components/site-header";
import { loadFeedbackDetail } from "@/lib/admin/feedback-report";
import { isOwner } from "@/lib/admin/owner";
import { recomputeForTier } from "@/lib/analysis/recompute";
import { getViewer } from "@/lib/auth/viewer";

// Mission #077 — l'analyse d'un retour, pour comprendre la réponse : le deal
// tel qu'il a été lu et le détail de la fourchette. Réservée au propriétaire,
// comme /dev/retours. La page de résultat publique ne lui est pas ouverte :
// elle n'appartient qu'à la personne qui a analysé l'offre.
export const metadata: Metadata = {
  title: "Retour sur l'estimation",
  robots: { index: false, follow: false },
};

export default async function FeedbackDetailPage({ params }: PageProps<"/dev/retours/[id]">) {
  if (!isOwner(await getViewer())) notFound();
  const { id } = await params;
  const detail = await loadFeedbackDetail(id);
  if (!detail) notFound();
  const { feedback, analysis } = detail;

  // Le détail au niveau de la réponse, comme la personne l'a vu. Recalcul
  // impossible (autre version de la table, offre incomplète) : le niveau de
  // l'analyse reste, et on le dit si les chiffres diffèrent de ceux jugés.
  const shown = feedback.tier ? recomputeForTier(analysis, feedback.tier) : analysis;
  const sameFigures = shown.estimate.total_low === feedback.rangeLow && shown.estimate.total_high === feedback.rangeHigh;

  return (
    <>
      <SiteHeader />
      <main id="contenu" className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-4 pt-10 pb-16 sm:px-6 md:pt-16 md:pb-24">
        <div className="flex flex-col gap-2">
          <p className="text-small">
            <Link href="/dev/retours" className="link">
              Tous les retours
            </Link>
          </p>
          <h1 className="text-h1 font-extrabold">Retour sur l&apos;estimation</h1>
        </div>
        <ul>
          <EntryItem entry={feedback} link={false} />
        </ul>
        <DealRecap deal={analysis.deal} />
        {sameFigures ? null : (
          <p role="note" className="border-l-4 border-encre py-1 pl-3 text-small font-semibold text-encre">
            Le détail ci-dessous ne correspond pas à la fourchette jugée : cette analyse ne peut pas être recalculée
            au niveau de la réponse. La fourchette jugée est celle du retour, au-dessus.
          </p>
        )}
        <Estimate estimate={shown.estimate} />
      </main>
    </>
  );
}
