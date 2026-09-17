import { Estimate, NegotiateList } from "@/components/result/analysis-blocks";
import { evalAnalyses } from "@/lib/fixtures/eval-analyses";

// DÉVELOPPEMENT UNIQUEMENT (extension .dev.tsx) : le détail du chiffrage et les
// points à négocier de toutes les fixtures, pour vérifier à 320 px qu'aucun
// libellé ne passe sur deux lignes. /dev/libelles
export default function LabelsPreviewPage() {
  return (
    <main id="contenu" className="mx-auto flex w-full max-w-2xl flex-col gap-12 px-4 py-8 sm:px-6">
      {evalAnalyses().map(({ name, analysis }) => (
        <section key={name} data-fixture={name} className="flex flex-col gap-6">
          <p className="text-xs font-bold text-attenue uppercase">{name}</p>
          {analysis.evaluability === "incomplete" ? null : <Estimate estimate={analysis.estimate} />}
          <NegotiateList items={analysis.negotiate} />
        </section>
      ))}
    </main>
  );
}
