import { ConclusionView } from "@/components/result/negotiation/conclusion-view";
import { EditableMessage } from "@/components/result/negotiation/editable-message";
import { dealRecapRows, formatEur, formatEurRange } from "@/lib/display";
import {
  ASK_STATUS_LABEL,
  OUTCOME_LABEL,
  TERM_GROUP_LABEL,
  type Ask,
  type AskStatus,
  type Pricing,
  type TurnPayload,
} from "@/lib/negotiation/types";
import { offeredOf } from "@/lib/negotiation/terms";
import { TIER_LABEL } from "@/lib/rates/tier";

// Mission #080 — un tour de l'échange, tel qu'il s'affiche. Chaque chiffre de
// cette carte vient du moteur de tarifs (pricing_*) ou des termes lus (montant
// proposé par la marque) : aucun ne sort du modèle (F1). La lecture du modèle
// est montrée en entier pour pouvoir être vérifiée avant d'envoyer quoi que ce
// soit (F2).

const DATE = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });

// Écart signé : « + 120 € », « − 80 € », « 0 € ».
export function signedEur(value: number): string {
  if (value === 0) return formatEur(0);
  return `${value > 0 ? "+" : "−"} ${formatEur(Math.abs(value))}`;
}

function gap(after: number | null, before: number | null): string {
  return after === null || before === null ? "—" : signedEur(after - before);
}

function PricingCompare({ before, after }: { before: Pricing; after: Pricing }) {
  const rows: Array<{ label: string; was: string; now: string; delta: string }> = [
    {
      label: "Fourchette estimée",
      was: formatEurRange(before.total_low, before.total_high) ?? "Pas d'estimation",
      now: formatEurRange(after.total_low, after.total_high) ?? "Pas d'estimation",
      delta: `${gap(after.total_low, before.total_low)} en bas, ${gap(after.total_high, before.total_high)} en haut`,
    },
    {
      label: "Ta contre-offre",
      was: formatEurRange(before.counter_low, before.counter_high) ?? "Aucune",
      now: formatEurRange(after.counter_low, after.counter_high) ?? "Aucune",
      delta: `${gap(after.counter_low, before.counter_low)} en bas, ${gap(after.counter_high, before.counter_high)} en haut`,
    },
  ];
  // Empilé plutôt qu'en tableau : sur un téléphone, « maintenant » et l'écart
  // restent visibles sans défilement horizontal.
  return (
    <dl className="flex flex-col divide-y divide-filet border-y-2 border-encre text-small">
      {rows.map((row) => (
        <div key={row.label} className="flex flex-col gap-1 py-3">
          <dt className="font-semibold text-encre">{row.label}</dt>
          <dd className="flex flex-col gap-0.5 tabular-nums">
            <span>Avant : {row.was}</span>
            <span className="font-semibold text-encre">Maintenant : {row.now}</span>
            <span className="text-attenue">Écart : {row.delta}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

function AskGroup({ status, asks }: { status: AskStatus; asks: Ask[] }) {
  if (asks.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <h5 className="font-semibold text-encre">{ASK_STATUS_LABEL[status]}</h5>
      <ul className="flex flex-col gap-2 text-small">
        {asks.map((ask) => (
          <li key={ask.id} className="flex flex-col gap-0.5">
            <span>{ask.label}</span>
            {ask.quote ? <q className="text-attenue">{ask.quote}</q> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TurnCard({
  turnNumber,
  createdAt,
  brandReply,
  payload,
}: {
  turnNumber: number;
  createdAt: string;
  brandReply: string | null;
  payload: TurnPayload;
}) {
  // Demandes tranchées dans CE tour, puis celles qui n'ont toujours pas de réponse.
  const decidedNow = payload.asks.filter((ask) => ask.turn === turnNumber);
  const stillOpen = payload.asks.filter((ask) => ask.status === "unanswered");
  const current = payload.pricing_after ?? payload.pricing_before;
  const currentRange = formatEurRange(current.total_low, current.total_high);
  const offered = offeredOf(payload.deal_after);
  const reading = dealRecapRows(payload.deal_after);

  return (
    <article aria-labelledby={`tour-${turnNumber}`} className="flex flex-col gap-6 border-t-2 border-encre pt-6">
      <header className="flex flex-col gap-1">
        <h3 id={`tour-${turnNumber}`} className="text-h3">
          Tour {turnNumber} — {OUTCOME_LABEL[payload.outcome]}
        </h3>
        <p className="text-small text-attenue">Réponse collée le {DATE.format(new Date(createdAt))}</p>
        {brandReply ? (
          <details className="text-small">
            <summary className="link w-fit cursor-pointer">Voir la réponse de la marque</summary>
            <blockquote className="mt-2 border-l-4 border-filet pl-3 whitespace-pre-line">{brandReply}</blockquote>
          </details>
        ) : (
          <p className="text-small text-attenue">La réponse collée a été effacée au bout de 30 jours, comme prévu. Ce qui en a été tiré reste.</p>
        )}
      </header>

      {decidedNow.length > 0 || stillOpen.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h4 className="font-bold text-encre">Ce que la marque répond à tes demandes</h4>
          <AskGroup status="granted" asks={decidedNow.filter((a) => a.status === "granted")} />
          <AskGroup status="refused" asks={decidedNow.filter((a) => a.status === "refused")} />
          <AskGroup status="countered" asks={decidedNow.filter((a) => a.status === "countered")} />
          <AskGroup status="unanswered" asks={stillOpen} />
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <h4 className="font-bold text-encre">Ce que l&apos;outil a compris des termes</h4>
        {payload.changes.length > 0 ? (
          <ul className="flex flex-col gap-3 text-small">
            {payload.changes.map((change) => (
              <li key={change.group} className="flex flex-col gap-0.5">
                <span className="font-semibold text-encre">{TERM_GROUP_LABEL[change.group]}</span>
                <span>
                  Avant : {change.before} → Maintenant : <strong className="text-encre">{change.after}</strong>
                </span>
                <q className="text-attenue">{change.quote}</q>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-small">Aucun terme du deal ne change dans cette réponse.</p>
        )}
        {reading.length > 0 ? (
          <details className="text-small" open={payload.changes.length > 0}>
            <summary className="link w-fit cursor-pointer">Le deal tel que l&apos;outil le lit après cette réponse</summary>
            <dl className="mt-2 flex flex-col divide-y divide-filet border-y border-filet">
              {reading.map((row) => (
                <div key={row.label} className="flex justify-between gap-4 py-2">
                  <dt className="text-attenue">{row.label}</dt>
                  <dd className="text-right font-semibold text-encre first-letter:uppercase">{row.value}</dd>
                </div>
              ))}
            </dl>
          </details>
        ) : null}
        <p className="text-small text-attenue">Relis cette lecture avant d&apos;envoyer quoi que ce soit : si elle est fausse, le message l&apos;est aussi.</p>
      </section>

      <section className="flex flex-col gap-3">
        <h4 className="font-bold text-encre">Chiffrage</h4>
        {payload.pricing_after ? (
          <>
            <p className="text-small">Les termes ont changé : voici le nouveau chiffrage, à côté de l&apos;ancien.</p>
            <PricingCompare before={payload.pricing_before} after={payload.pricing_after} />
            {payload.pricing_after.rate_table_version !== payload.pricing_before.rate_table_version ? (
              <p className="text-small text-attenue">
                Nouveau chiffrage calculé avec la table {payload.pricing_after.rate_table_version} ; l&apos;ancien venait de la table{" "}
                {payload.pricing_before.rate_table_version}.
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-small">
            Fourchette inchangée : <strong className="text-encre">{currentRange ?? "pas d'estimation"}</strong>
            {payload.changed_since_origin ? ", celle du tour précédent." : ", celle de l'analyse d'origine."}
          </p>
        )}
        <p className="text-xs text-attenue">Niveau « {TIER_LABEL[current.tier].short} ». Chiffres calculés par la table de tarifs, jamais par l&apos;outil de lecture.</p>
      </section>

      {payload.outcome === "refused" ? (
        <section className="flex flex-col gap-2 border-l-4 border-encre py-1 pl-4">
          <h4 className="font-bold text-encre">Pour décider de continuer ou non</h4>
          <dl className="flex flex-col gap-1 text-small">
            <div className="flex justify-between gap-4">
              <dt className="text-attenue">Fourchette estimée</dt>
              <dd className="font-semibold text-encre tabular-nums">{currentRange ?? "Pas d'estimation"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-attenue">{offered?.kind === "products" ? "Valeur des produits proposés" : "Montant proposé par la marque"}</dt>
              <dd className="font-semibold text-encre tabular-nums">{offered ? formatEur(offered.value) : "Aucun montant écrit"}</dd>
            </div>
            {offered && current.total_low !== null ? (
              <div className="flex justify-between gap-4">
                <dt className="text-attenue">Écart avec le bas de la fourchette</dt>
                <dd className="font-semibold text-encre tabular-nums">{signedEur(offered.value - current.total_low)}</dd>
              </div>
            ) : null}
          </dl>
          <p className="text-small">
            Accepter les termes de la marque, continuer à négocier ou t&apos;arrêter là : c&apos;est ton choix. L&apos;outil ne
            tranche pas à ta place.
          </p>
        </section>
      ) : null}

      {payload.brand_questions.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h4 className="font-bold text-encre">La marque te pose une question</h4>
          <ul className="flex flex-col gap-2 text-small">
            {payload.brand_questions.map((question) => (
              <li key={question.quote} className="flex flex-col gap-0.5">
                <span>{question.question}</span>
                <q className="text-attenue">{question.quote}</q>
              </li>
            ))}
          </ul>
          <p className="text-small">Le message laisse la réponse à compléter : c&apos;est à toi d&apos;y répondre.</p>
        </section>
      ) : null}

      {payload.uncertainties.length > 0 ? (
        <section className="flex flex-col gap-2 alert-bad py-2">
          <h4 className="font-bold">L&apos;outil n&apos;est pas sûr de tout ce qu&apos;il a lu</h4>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-small">
            {payload.uncertainties.map((doubt) => (
              <li key={doubt}>{doubt}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {payload.conclusion ? (
        <ConclusionView conclusion={payload.conclusion} />
      ) : (
        <section className="flex flex-col gap-2">
          <h4 className="font-bold text-encre">Ton message suivant</h4>
          {payload.message.fallback ? (
            <p className="text-small">
              Le message rédigé par l&apos;outil contenait {payload.message.fallback_reasons.join(", ")} : il a été remplacé par
              un message simple, qui reprend tes demandes.
            </p>
          ) : (
            <p className="text-small text-attenue">Ton : {payload.message.tone}</p>
          )}
          <EditableMessage text={payload.message.text} />
        </section>
      )}
    </article>
  );
}
