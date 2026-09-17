import type { ReactNode } from "react";
import { Section } from "@/components/result/section";
import { POSITION_LABEL, rangePosition } from "@/lib/analysis/anchoring";
import { CONFIDENCE_LABEL, formatEur, formatEurRange } from "@/lib/display";
import type { Analysis } from "@/lib/schema";

// Détail du verdict quand l'offre n'a pas de score. Le libellé (« Offre à
// chiffrer »…) est la pastille du bandeau bleu ; ici, l'explication et ce qui
// manque. Voir lib/analysis/evaluability.ts.

export function UnpricedCard({ confidence }: { confidence: Analysis["confidence"] }) {
  return (
    <section aria-label="Offre à chiffrer" className="flex flex-col gap-2">
      <p className="measure text-lg text-encre">
        Cette offre ne précise pas de rémunération. Voici ce qu&apos;elle vaut d&apos;après nos références, à confirmer
        avec la marque.
      </p>
      <p className="text-small text-attenue">{CONFIDENCE_LABEL[confidence]}</p>
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
    <section aria-label={title} className="flex flex-col gap-4">
      <p className="measure text-lg text-encre">{text}</p>
      {children}
      {missing.length > 0 ? (
        <Section title="Ce qui manque">
          <ul className="flex flex-col divide-y divide-filet border-y border-filet">
            {missing.map((item) => (
              <li key={item} className="py-2.5 font-semibold text-encre">
                {item}
              </li>
            ))}
          </ul>
        </Section>
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

// Position d'une valeur dans la fourchette : une comparaison, pas un jugement
// sur le deal.
function position(value: number, low: number | null, high: number | null): string | null {
  if (low === null || high === null) return null;
  return POSITION_LABEL[rangePosition(value, low, high)];
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
      <dl className="flex flex-col divide-y divide-filet border-y border-filet text-small">
        {amount !== null ? (
          <div className="flex justify-between gap-4 py-2">
            <dt className="text-attenue">Montant proposé</dt>
            <dd className="figures text-right text-encre">{formatEur(amount)}</dd>
          </div>
        ) : null}
        {inKind !== null ? (
          <div className="flex justify-between gap-4 py-2">
            <dt className="text-attenue">Produits offerts (valeur, pas de l&apos;argent)</dt>
            <dd className="figures text-right text-encre">{formatEur(inKind)}</dd>
          </div>
        ) : null}
        {range ? (
          <div className="flex justify-between gap-4 py-2">
            <dt className="text-attenue">Ce que valent les contenus</dt>
            <dd className="figures text-right text-encre">{range}</dd>
          </div>
        ) : null}
        {comparison ? <p className="py-2 font-semibold text-encre">{comparison}</p> : null}
      </dl>
    </MissingInfoCard>
  );
}
