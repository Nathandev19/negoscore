import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FeedbackReportView } from "@/components/admin/feedback-report-view";
import { SiteHeader } from "@/components/site-header";
import { buildReport, loadFeedbackRows } from "@/lib/admin/feedback-report";
import { isOwner } from "@/lib/admin/owner";
import { getViewer } from "@/lib/auth/viewer";

// Mission #077 — retours « Cette estimation te paraît juste ? ».
//
// SEULE page de app/dev qui existe en production (les autres sont en .dev.tsx,
// voir next.config.ts). Réservée à l'adresse OWNER_EMAIL (lib/admin/owner.ts) :
// le proxy répond comme à une adresse inexistante à toute autre personne, et la
// page refait le contrôle avant la moindre lecture en base.
export const metadata: Metadata = {
  title: "Retours sur l'estimation",
  robots: { index: false, follow: false },
};

export default async function FeedbackPage() {
  if (!isOwner(await getViewer())) notFound();
  const rows = await loadFeedbackRows();

  return (
    <>
      <SiteHeader />
      <main id="contenu" className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-4 pt-10 pb-16 sm:px-6 md:pt-16 md:pb-24">
        <div className="flex flex-col gap-2">
          <h1 className="text-h1 font-extrabold">Retours sur l&apos;estimation</h1>
          <p>
            Réponses à « Cette estimation te paraît juste ? ». Aucune adresse email ni aucun identifiant de compte
            n&apos;est lu pour cette page.
          </p>
        </div>
        {rows === "missing" ? (
          <p role="alert" className="alert-bad text-small">
            La table des retours n&apos;est pas lisible : les migrations 20260917000016 et 20260917000017 ne sont pas
            appliquées.
          </p>
        ) : rows.length === 0 ? (
          <p className="border-l-4 border-encre py-1 pl-3 font-semibold text-encre">
            Aucun retour pour l&apos;instant. Le premier apparaîtra ici dès qu&apos;une personne aura répondu sous une
            estimation.
          </p>
        ) : (
          <FeedbackReportView report={buildReport(rows)} />
        )}
      </main>
    </>
  );
}
