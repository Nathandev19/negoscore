import type { ReactNode } from "react";
import { CONFIDENCE_LABEL, formatEur, formatEurRange } from "@/lib/display";
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

// Verdict suspendu faute d'information, suivi de la liste de ce qui manque.
function MissingInfoCard({
  title,
  text,
  missing,
  children,
}: {
  title: string;
  text: string;
  missing: string[];
  children?: ReactNode;
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-3 rounded-2xl border border-neutral-300 bg-neutral-50 px-6 py-6">
      <p className="text-center text-3xl font-black tracking-tight text-neutral-950">{title}</p>
      <p className="text-center text-base text-neutral-800">{text}</p>
      {children}
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

export function IncompleteCard({ missing }: { missing: string[] }) {
  return (
    <MissingInfoCard
      title="Informations insuffisantes"
      text="Impossible d'évaluer ce deal tant que certains éléments ne sont pas précisés."
      missing={missing}
    />
  );
}

// Position d'une valeur par rapport à la fourchette : une comparaison, pas un
// jugement sur le deal.
function position(value: number, low: number | null, high: number | null): string | null {
  if (low === null || high === null) return null;
  if (value < low) return "en dessous de notre fourchette";
  if (value > high) return "au-dessus de notre fourchette";
  return "dans notre fourchette";
}

export function TermsUnknownCard({
  deal,
  estimate,
  missing,
}: {
  deal: Analysis["deal"];
  estimate: Analysis["estimate"];
  missing: string[];
}) {
  const amount = deal.payment.amount_eur;
  const inKind = deal.in_kind_value_eur;
  const range = formatEurRange(estimate.total_low, estimate.total_high);
  // L'argent est comparé en priorité ; une offre payée en produits est
  // comparée sur la valeur des produits, en le disant.
  const compared = amount ?? inKind;
  const where = compared !== null ? position(compared, estimate.total_low, estimate.total_high) : null;
  const comparison =
    where === null
      ? null
      : amount !== null
        ? `Le montant proposé est ${where}.`
        : `La valeur des produits offerts est ${where}. Ce sont des produits, pas de l'argent.`;
  return (
    <MissingInfoCard
      title="Offre à préciser"
      text="On peut chiffrer ce que ça vaut, pas si le deal est bon : la marque ne dit rien de ses conditions."
      missing={missing}
    >
      <dl className="flex flex-col gap-1 rounded-xl border bg-white px-4 py-3 text-sm">
        {amount !== null ? (
          <div className="flex justify-between gap-4">
            <dt className="text-neutral-600">Montant proposé</dt>
            <dd className="text-right font-semibold">{formatEur(amount)}</dd>
          </div>
        ) : null}
        {inKind !== null ? (
          <div className="flex justify-between gap-4">
            <dt className="text-neutral-600">Produits offerts (valeur, pas de l&apos;argent)</dt>
            <dd className="text-right font-semibold">{formatEur(inKind)}</dd>
          </div>
        ) : null}
        {range ? (
          <div className="flex justify-between gap-4">
            <dt className="text-neutral-600">Ce que valent les contenus</dt>
            <dd className="text-right font-semibold">{range}</dd>
          </div>
        ) : null}
        {comparison ? <p className="pt-1 text-neutral-800">{comparison}</p> : null}
      </dl>
    </MissingInfoCard>
  );
}
