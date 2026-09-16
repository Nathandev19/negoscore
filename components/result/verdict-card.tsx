import { CONFIDENCE_LABEL } from "@/lib/display";
import type { Analysis } from "@/lib/schema";

// Bloc de verdict quand l'offre n'est pas évaluable : pas de score, pas de
// libellé de qualité. Voir lib/analysis/evaluability.ts.

export function UnpricedCard({ confidence }: { confidence: Analysis["confidence"] }) {
  return (
    <section
      aria-label="Offre à chiffrer"
      className="flex flex-col items-center gap-2 rounded-2xl border border-sky-200 bg-sky-50 px-6 py-6 text-center"
    >
      <p className="text-3xl font-black tracking-tight text-sky-950">Offre à chiffrer</p>
      <p className="text-base text-sky-950">
        Cette offre ne précise pas de rémunération. Voici ce qu&apos;elle vaut d&apos;après nos références, à confirmer
        avec la marque.
      </p>
      <p className="mt-1 text-xs text-neutral-600">{CONFIDENCE_LABEL[confidence]}</p>
    </section>
  );
}

export function IncompleteCard({ missing }: { missing: string[] }) {
  return (
    <section
      aria-label="Informations insuffisantes"
      className="flex flex-col gap-3 rounded-2xl border border-neutral-300 bg-neutral-50 px-6 py-6"
    >
      <p className="text-center text-3xl font-black tracking-tight text-neutral-950">Informations insuffisantes</p>
      <p className="text-center text-base text-neutral-800">
        Impossible d&apos;évaluer ce deal tant que certains éléments ne sont pas précisés.
      </p>
      {missing.length > 0 ? (
        <div className="text-sm">
          <p className="font-semibold text-neutral-950">Ce qui manque :</p>
          <ul className="list-disc pl-5 text-neutral-800">
            {missing.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
