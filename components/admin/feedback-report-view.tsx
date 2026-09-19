import Link from "next/link";
import type { Distribution, FeedbackEntry, FeedbackReport, Group } from "@/lib/admin/feedback-report";
import { TIER_GROUP_LABEL } from "@/lib/admin/feedback-report";
import { FEEDBACK_LABEL, FEEDBACK_RATINGS } from "@/lib/analysis/feedback-options";
import { formatEur, formatEurRange, formatNumber } from "@/lib/display";

// Mission #077 — rendu des retours sur l'estimation (page /dev/retours,
// réservée au propriétaire). Des nombres et des parts, jamais l'un sans
// l'autre : à trois retours, « 67 % » seul ferait croire à une tendance.

const DATE = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Paris",
});

// Part arrondie à l'unité, sans décimale trompeuse sur de petits effectifs.
export function share(count: number, total: number): string {
  return `${formatNumber(Math.round((count / total) * 100), 0)} %`;
}

function Cell({ count, total }: { count: number; total: number }) {
  return (
    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
      <span className="font-semibold text-encre">{formatNumber(count, 0)}</span>{" "}
      <span className="text-attenue">({share(count, total)})</span>
    </td>
  );
}

function DistributionRow({ label, detail, distribution }: { label: string; detail?: string; distribution: Distribution }) {
  return (
    <tr className="border-t border-filet align-top">
      <th scope="row" className="px-3 py-2 text-left font-semibold text-encre">
        {label}
        {detail ? <span className="block text-xs font-normal text-attenue">{detail}</span> : null}
      </th>
      <td className="px-3 py-2 text-right tabular-nums">{formatNumber(distribution.total, 0)}</td>
      {distribution.total === 0 ? (
        <td colSpan={FEEDBACK_RATINGS.length} className="px-3 py-2 text-attenue">
          Aucun retour
        </td>
      ) : (
        FEEDBACK_RATINGS.map((rating) => <Cell key={rating} count={distribution.counts[rating]} total={distribution.total} />)
      )}
    </tr>
  );
}

function DistributionTable({ caption, rows }: { caption: string; rows: Array<Pick<Group, "key" | "label" | "detail" | "distribution">> }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[34rem] border-y-2 border-encre text-small">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className="px-3 py-2 text-left text-attenue">
              <span className="sr-only">Groupe</span>
            </th>
            <th scope="col" className="px-3 py-2 text-right text-attenue">
              Retours
            </th>
            {FEEDBACK_RATINGS.map((rating) => (
              <th key={rating} scope="col" className="px-3 py-2 text-right text-attenue">
                {FEEDBACK_LABEL[rating]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <DistributionRow key={row.key} label={row.label} detail={row.detail} distribution={row.distribution} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function offeredText(entry: FeedbackEntry): string {
  if (!entry.offered) return "Aucun montant écrit";
  return entry.offered.kind === "money" ? formatEur(entry.offered.value) : `${formatEur(entry.offered.value)} en produits`;
}

// Mission #086, C et E — sur quoi porte l'avis, en tête de chaque retour.
export function judgedText(turn: number | null): string {
  if (turn === null) return "L'offre d'origine (supposé : avis donné avant l'enregistrement du tour)";
  return turn === 0 ? "L'offre d'origine" : `Les termes après le tour ${turn} de négociation`;
}

export function EntryItem({ entry, link = true }: { entry: FeedbackEntry; link?: boolean }) {
  const range = formatEurRange(entry.rangeLow, entry.rangeHigh);
  const facts: Array<[string, string]> = [
    ["Porte sur", judgedText(entry.turn)],
    ["Niveau", entry.tier ? TIER_GROUP_LABEL[entry.tier] : "Non enregistré"],
    ["Score", entry.score === null ? "Pas de score" : `${formatNumber(entry.score, 0)}/100`],
    ["Montant proposé", offeredText(entry)],
    ["Fourchette estimée", range ?? "Pas de fourchette"],
    ["Proposé ÷ bas de fourchette", entry.ratioToLow === null ? "Incalculable" : `× ${formatNumber(entry.ratioToLow, 2)}`],
  ];
  return (
    <li className="flex flex-col gap-3 border-t border-filet py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="font-bold text-encre">{FEEDBACK_LABEL[entry.rating]}</p>
        <p className="text-small text-attenue tabular-nums">{DATE.format(new Date(entry.answeredAt))}</p>
      </div>
      {entry.comment ? (
        <blockquote className="border-l-4 border-encre pl-3 text-encre">« {entry.comment} »</blockquote>
      ) : (
        <p className="text-small text-attenue">Sans commentaire.</p>
      )}
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-small sm:grid-cols-2">
        {facts.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4 sm:justify-start">
            <dt className="text-attenue">{label}</dt>
            <dd className="text-right font-semibold text-encre tabular-nums sm:text-left">{value}</dd>
          </div>
        ))}
      </dl>
      {link ? (
        <p className="text-small">
          <Link href={`/dev/retours/${entry.analysisId}`} className="link">
            Voir l&apos;analyse
          </Link>
        </p>
      ) : null}
    </li>
  );
}

export function FeedbackReportView({ report }: { report: FeedbackReport }) {
  const count = report.overall.total;
  return (
    <div className="flex flex-col gap-12">
      <section className="flex flex-col gap-3">
        <h2 className="text-h2">Sur l&apos;ensemble</h2>
        <p className="text-small">
          {formatNumber(count, 0)} retour{count > 1 ? "s" : ""}. Un retour par analyse : la dernière réponse donnée compte.
        </p>
        <DistributionTable
          caption="Répartition des réponses sur l'ensemble"
          rows={[{ key: "ensemble", label: "Tous les retours", distribution: report.overall }]}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-h2">Par niveau choisi</h2>
        <p className="text-small">Le niveau affiché au moment de la réponse, donc celui des chiffres jugés.</p>
        <DistributionTable caption="Répartition des réponses par niveau" rows={report.byTier} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-h2">Par version de la table de tarifs</h2>
        <p className="text-small">
          La table qui a produit les chiffres jugés. Les retours sur une ancienne table ne disent rien de l&apos;actuelle.
        </p>
        <DistributionTable caption="Répartition des réponses par version de la table" rows={report.byVersion} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-h2">Par tour jugé</h2>
        <p className="text-small">
          Un avis sur l&apos;offre d&apos;origine et un avis après des tours de négociation ne jugent pas les mêmes termes.
          Après un tour, les chiffres enregistrés et la forme du deal sont ceux des termes de ce tour.
        </p>
        <DistributionTable caption="Répartition des réponses par tour jugé" rows={report.byTurn} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-h2">Par montant proposé ÷ bas de la fourchette</h2>
        <p className="text-small">
          Sépare « la table est trop haute » de « les marques de ce segment paient mal ». Montant proposé : l&apos;argent,
          sinon la valeur des produits offerts quand elle est écrite. Bas de la fourchette : celle qui a été jugée.
        </p>
        <DistributionTable caption="Répartition des réponses par rapport entre montant proposé et bas de la fourchette" rows={report.byRatio} />
      </section>

      <section className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h2 className="text-h2">Par forme du deal</h2>
          <p className="text-small">
            La forme du deal jugé : celle de l&apos;offre d&apos;origine, ou, pour un avis donné après un tour de
            négociation, celle des termes de ce tour. Chaque retour compte une fois par tableau.
          </p>
        </div>
        {report.byShape.map((breakdown) => (
          <div key={breakdown.key} className="flex flex-col gap-2">
            <h3 className="text-lg">{breakdown.title}</h3>
            <DistributionTable caption={`Répartition des réponses : ${breakdown.title.toLowerCase()}`} rows={breakdown.groups} />
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-h2">Les retours, du plus récent au plus ancien</h2>
        <ol className="flex flex-col border-b border-filet">
          {report.entries.map((entry) => (
            <EntryItem key={entry.analysisId} entry={entry} />
          ))}
        </ol>
      </section>
    </div>
  );
}
