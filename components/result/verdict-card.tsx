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

// Position du montant proposé par rapport à la fourchette : une comparaison,
// pas un jugement sur le deal.
function offerPosition(amount: number, low: number | null, high: number | null): string | null {
  if (low === null || high === null) return null;
  if (amount < low) return "en dessous de notre fourchette";
  if (amount > high) return "au-dessus de notre fourchette";
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
  const range = formatEurRange(estimate.total_low, estimate.total_high);
  const position = amount !== null ? offerPosition(amount, estimate.total_low, estimate.total_high) : null;
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
        ) : deal.in_kind_value_eur !== null ? (
          <div className="flex justify-between gap-4">
            <dt className="text-neutral-600">Produits offerts</dt>
            <dd className="text-right font-semibold">{formatEur(deal.in_kind_value_eur)}</dd>
          </div>
        ) : null}
        {range ? (
          <div className="flex justify-between gap-4">
            <dt className="text-neutral-600">Ce que valent les contenus</dt>
            <dd className="text-right font-semibold">{range}</dd>
          </div>
        ) : null}
        {position ? <p className="pt-1 text-neutral-800">Le montant proposé est {position}.</p> : null}
      </dl>
    </MissingInfoCard>
  );
}
