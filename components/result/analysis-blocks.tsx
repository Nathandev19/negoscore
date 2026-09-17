import { CheckIcon, InfoIcon } from "lucide-react";
import { Section } from "@/components/result/section";
import { Badge } from "@/components/ui/badge";
import {
  dealRecapRows,
  formatEur,
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
      <dl className="divide-y rounded-xl border bg-white">
        {rows.map((row) => (
          <div key={row.label} className="flex justify-between gap-4 px-4 py-3">
            <dt className="text-sm text-neutral-600">{row.label}</dt>
            <dd className="text-right text-sm font-medium first-letter:uppercase">{row.value}</dd>
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
      <ul className="flex flex-col gap-3">
        {items.map((item) => (
          <li key={item.label} className="flex gap-3">
            <CheckIcon className="mt-0.5 size-5 shrink-0 text-green-700" />
            <div>
              <p className="font-semibold">{item.label}</p>
              <p className="text-sm text-neutral-600">{item.why}</p>
            </div>
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
      <ol className="flex flex-col gap-3">
        {sortByPriority(items).map((item, index) => {
          const impact = formatEurRange(item.eur_impact_low, item.eur_impact_high);
          return (
            <li key={item.label} className="flex gap-3 rounded-xl border bg-white p-4">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-sm font-bold text-white">
                {index + 1}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <p className="font-semibold">{item.label}</p>
                {impact ? (
                  <p className="figures text-base font-bold text-band-good-text">+ {impact}</p>
                ) : null}
                <p className="text-sm text-neutral-600">{item.why}</p>
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
      <ul className="flex flex-col gap-3">
        {items.map((item) => (
          <li key={item.label} className="flex flex-col gap-2 rounded-xl border bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xl leading-tight font-bold text-neutral-950">{item.label}</p>
              <Badge className={cn("border-transparent", SEVERITY_BADGE[item.severity])}>
                {SEVERITY_LABEL[item.severity]}
              </Badge>
            </div>
            <p className="text-sm text-neutral-600">{item.why}</p>
          </li>
        ))}
      </ul>
    </Section>
  );
}

export function LegalNotice({ legal }: { legal: Analysis["fr_legal"] }) {
  if (!legal.applicable) return null;
  return (
    <section className="flex gap-3 rounded-xl border border-sky-200 bg-sky-50 p-4">
      <InfoIcon className="mt-0.5 size-5 shrink-0 text-sky-800" />
      <div className="flex flex-col gap-2 text-sm text-sky-950">
        <h2 className="text-base font-semibold">Bon à savoir côté loi française</h2>
        <p>{legal.note}</p>
        {legal.missing_mandatory_clauses.length > 0 ? (
          <div>
            <p className="font-medium">Mentions absentes de l&apos;offre :</p>
            <ul className="list-disc pl-5">
              {legal.missing_mandatory_clauses.map((clause) => (
                <li key={clause}>{clause}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <p className="text-xs text-sky-900/80">Information générale, pas un conseil juridique.</p>
      </div>
    </section>
  );
}

export function Estimate({ estimate }: { estimate: Analysis["estimate"] }) {
  const base = formatEurRange(estimate.base_low, estimate.base_high);
  const total = formatEurRange(estimate.total_low, estimate.total_high);
  return (
    <Section title="Ce que ça vaut">
      <div className="flex flex-col gap-4 rounded-xl border bg-white p-4">
        {total ? (
          <div>
            <p className="text-sm text-neutral-600">Fourchette estimée</p>
            <p className="figures text-4xl leading-tight font-extrabold tracking-tight text-ink">
              {total}
            </p>
          </div>
        ) : null}

        <dl className="flex flex-col gap-2 border-t pt-4 text-sm">
          {base ? (
            <div className="flex justify-between gap-4">
              <dt className="text-neutral-600">Création (base)</dt>
              <dd className="text-right font-medium tabular-nums">{base}</dd>
            </div>
          ) : null}
          {estimate.lines.map((line) => (
            <div key={line.label} className="flex justify-between gap-4">
              <dt className="text-neutral-600">
                {line.label}
                <span className="text-neutral-500">
                  {" "}
                  ({line.type === "percent" ? `+${line.low} à ${line.high} %` : `+${formatEur(line.low)} à ${formatEur(line.high)}`})
                </span>
              </dt>
              <dd className="text-right font-medium whitespace-nowrap tabular-nums">
                + {formatEurRange(line.eur_low, line.eur_high)}
              </dd>
            </div>
          ))}
          {total ? (
            <div className="flex justify-between gap-4 border-t pt-2 font-bold">
              <dt>Total</dt>
              <dd className="text-right tabular-nums">{total}</dd>
            </div>
          ) : null}
        </dl>

        {estimate.assumptions.length > 0 ? (
          <div className="text-sm">
            <p className="font-medium">Hypothèses</p>
            <ul className="list-disc pl-5 text-neutral-600">
              {estimate.assumptions.map((assumption) => (
                <li key={assumption}>{assumption}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <p className="text-xs text-neutral-500">
          Estimation fondée sur des benchmarks de marché, pas un tarif officiel. Table de tarifs{" "}
          <span className="tabular-nums">{estimate.rate_table_version}</span>.
        </p>
      </div>
    </Section>
  );
}
