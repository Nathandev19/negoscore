import type { ReactNode } from "react";
import { Section } from "@/components/result/section";
import {
  dealRecapRows,
  formatEurRange,
  SEVERITY_BADGE,
  SEVERITY_LABEL,
  sortByPriority,
} from "@/lib/display";
import type { Analysis } from "@/lib/schema";
import { cn } from "@/lib/utils";

export function DealRecap({ deal }: { deal: Analysis["deal"] }) {
  const rows = dealRecapRows(deal);
  if (rows.length === 0) return null;
  return (
    <Section title="Le deal proposé">
      <dl className="flex flex-col divide-y divide-filet border-y border-filet">
        {rows.map((row) => (
          <div key={row.label} className="flex justify-between gap-4 py-2.5">
            <dt className="text-small text-attenue">{row.label}</dt>
            <dd className="text-right text-small font-semibold text-encre first-letter:uppercase">{row.value}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}

export function GoodPoints({ items }: { items: Analysis["good_points"] }) {
  if (items.length === 0) return null;
  return (
    <Section title="Ce qui est bon">
      <ul className="flex flex-col gap-4">
        {items.map((item) => (
          <li key={item.label} className="flex flex-col gap-0.5">
            <p className="font-semibold text-encre">{item.label}</p>
            <p className="text-small">{item.why}</p>
          </li>
        ))}
      </ul>
    </Section>
  );
}

export function NegotiateList({ items }: { items: Analysis["negotiate"] }) {
  if (items.length === 0) return null;
  return (
    <Section title="Ce qu'il faut négocier">
      <ol className="flex flex-col divide-y divide-filet">
        {sortByPriority(items).map((item, index) => {
          const impact = formatEurRange(item.eur_impact_low, item.eur_impact_high);
          return (
            <li key={item.label} className="grid grid-cols-[2.25rem_1fr] gap-x-3 py-3 first:pt-0">
              <span aria-hidden className="figures text-3xl leading-none text-attenue">
                {index + 1}
              </span>
              <div className="flex min-w-0 flex-col gap-1">
                <p className="font-semibold text-encre">{item.label}</p>
                {/* Ce que l'œil doit attraper : un cran au-dessus du titre du point. */}
                {impact ? <p className="figures text-2xl leading-tight text-encre">+ {impact}</p> : null}
                <p className="text-small">{item.why}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </Section>
  );
}

export function RedFlags({ items }: { items: Analysis["red_flags"] }) {
  if (items.length === 0) return null;
  return (
    <Section title="Red flags">
      <ul className="flex flex-col divide-y divide-filet">
        {items.map((item) => (
          <li key={item.label} className="flex flex-col gap-1.5 py-3 first:pt-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="headline text-h3 text-encre">{item.label}</p>
              <span
                className={cn(
                  "inline-flex w-fit shrink-0 rounded-pill px-2.5 py-0.5 text-xs font-bold whitespace-nowrap",
                  SEVERITY_BADGE[item.severity],
                )}
              >
                {SEVERITY_LABEL[item.severity]}
              </span>
            </div>
            <p className="text-small">{item.why}</p>
          </li>
        ))}
      </ul>
    </Section>
  );
}

export function LegalNotice({ legal }: { legal: Analysis["fr_legal"] }) {
  if (!legal.applicable) return null;
  return (
    <Section title="Bon à savoir côté loi française">
      <div className="flex flex-col gap-2 text-small">
        <p>{legal.note}</p>
        {legal.missing_mandatory_clauses.length > 0 ? (
          <div>
            <p className="font-semibold text-encre">Mentions absentes de l&apos;offre :</p>
            <ul className="list-disc pl-5">
              {legal.missing_mandatory_clauses.map((clause) => (
                <li key={clause}>{clause}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <p className="text-xs text-attenue">Information générale, pas un conseil juridique.</p>
      </div>
    </Section>
  );
}

// children : le choix du niveau, posé au-dessus de la fourchette qu'il change.
export function Estimate({ estimate, children }: { estimate: Analysis["estimate"]; children?: ReactNode }) {
  const base = formatEurRange(estimate.base_low, estimate.base_high);
  const total = formatEurRange(estimate.total_low, estimate.total_high);
  return (
    <Section title="Ce que ça vaut">
      <div className="flex flex-col gap-5">
        {children}
        {total ? (
          <div className="flex flex-col gap-1">
            <p className="text-small text-attenue">Fourchette estimée</p>
            <p className="figures text-5xl leading-none text-encre sm:text-6xl">{total}</p>
          </div>
        ) : null}

        <dl className="flex flex-col divide-y divide-filet border-y border-filet text-small">
          {base ? (
            <div className="flex justify-between gap-4 py-2">
              <dt className="text-attenue">Création (base)</dt>
              <dd className="text-right font-semibold text-encre tabular-nums">{base}</dd>
            </div>
          ) : null}
          {/* Libellé et montant en euros seulement. Les pourcentages et tarifs
              unitaires (line.low, line.high) restent dans les données pour le
              calcul et le débogage : ils n'apprennent rien à une créatrice. */}
          {estimate.lines.map((line) => (
            <div key={line.label} className="flex justify-between gap-4 py-2">
              <dt className="text-attenue">{line.label}</dt>
              <dd className="text-right font-semibold whitespace-nowrap text-encre tabular-nums">
                + {formatEurRange(line.eur_low, line.eur_high)}
              </dd>
            </div>
          ))}
          {total ? (
            <div className="flex justify-between gap-4 py-2 font-bold text-encre">
              <dt>Total</dt>
              <dd className="text-right tabular-nums">{total}</dd>
            </div>
          ) : null}
        </dl>

        {estimate.assumptions.length > 0 ? (
          <div className="text-small">
            <p className="font-semibold text-encre">Hypothèses</p>
            <ul className="list-disc pl-5">
              {estimate.assumptions.map((assumption) => (
                <li key={assumption}>{assumption}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <p className="text-xs text-attenue">
          Estimation fondée sur des benchmarks de marché, pas un tarif officiel.
          {" "}
          Table de tarifs <span className="tabular-nums">{estimate.rate_table_version}</span>.
        </p>
      </div>
    </Section>
  );
}
