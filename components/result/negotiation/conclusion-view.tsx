import { EditableMessage } from "@/components/result/negotiation/editable-message";
import type { Conclusion } from "@/lib/negotiation/types";
import { CONCLUSION_ANCHOR } from "@/lib/ui/reveal";

// Mission #080, C — la conclusion de l'échange. Récapitulatif (C1), points
// flous (C2), message de confirmation écrite (C3), rappel de la loi française
// (C4). Aucune recommandation : la décision a été prise par la personne, ou
// par la marque qui accepte (C5).
export function ConclusionView({ conclusion, turn }: { conclusion: Conclusion; turn?: number }) {
  return (
    <section aria-labelledby={CONCLUSION_ANCHOR} className="flex flex-col gap-5 border-2 border-encre p-4 sm:p-6">
      <div className="flex flex-col gap-1">
        {/* Mission #096 : amené en vue et annoncé quand la conclusion arrive. */}
        <h3 id={CONCLUSION_ANCHOR} tabIndex={-1} className="scroll-mt-24 text-h3">
          Conclusion de l&apos;échange
        </h3>
        <p className="text-small">
          {conclusion.source === "brand_accepted"
            ? "La marque a accepté. Voici ce qui a été convenu, tel que l'outil l'a lu dans l'échange."
            : "Tu as décidé d'accepter les termes en l'état. Voici ce qui a été convenu, tel que l'outil l'a lu dans l'échange."}
        </p>
      </div>

      <dl className="flex flex-col divide-y divide-filet border-y border-filet text-small">
        {conclusion.recap.map((row) => (
          <div key={row.label} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:justify-between sm:gap-4">
            <dt className="text-attenue">{row.label}</dt>
            <dd className="font-semibold text-encre sm:text-right">{row.value}</dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-col gap-2">
        <h4 className="font-bold text-encre">Ce qui reste flou</h4>
        {conclusion.unclear.length > 0 ? (
          <>
            <p className="text-small">C&apos;est le dernier moment pour le faire préciser, avant de commencer.</p>
            <ul className="flex list-disc flex-col gap-1 pl-5 text-small">
              {conclusion.unclear.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-small">
            L&apos;outil n&apos;a relevé aucun point flou dans les termes lus. Relis-les quand même avant de confirmer.
          </p>
        )}
      </div>

      <EditableMessage text={conclusion.message} label="Message de confirmation à envoyer" turn={turn} />

      <p className="border-l-4 border-encre py-1 pl-3 text-small">{conclusion.legal_note}</p>
    </section>
  );
}
