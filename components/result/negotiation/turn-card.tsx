import { ConclusionView } from "@/components/result/negotiation/conclusion-view";
import { EditableMessage } from "@/components/result/negotiation/editable-message";
import { dealRecapRows, formatEur, formatEurRange } from "@/lib/display";
import { POINT_LABEL } from "@/lib/negotiation/points";
import { turnAnchorId } from "@/lib/ui/reveal";
import {
  ASK_STATUS_LABEL,
  OUTCOME_LABEL,
  POINT_STATUS_LABEL,
  TERM_GROUP_LABEL,
  UNVERIFIED_HINT,
  UNVERIFIED_LABEL,
  type Ask,
  type AskStatus,
  type Pricing,
  type TermGroup,
  type TurnPayload,
} from "@/lib/negotiation/types";
import { normalizeForQuote } from "@/lib/negotiation/quotes";
import { groupLabel, offeredOf } from "@/lib/negotiation/terms";
import { TIER_LABEL } from "@/lib/rates/tier";
import { toneLabel } from "@/lib/tone";

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
  // Mission #082 : fourchette et contre-offre identiques avant ET après (offre
  // sous le bas de la fourchette) : une seule ligne, pas deux fois le même
  // chiffre.
  const same = (p: Pricing) => p.counter_low === p.total_low && p.counter_high === p.total_high;
  if (same(before) && same(after)) {
    rows.splice(0, 2, { ...rows[0], label: "Fourchette estimée, et ta contre-offre" });
  }
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

// Mêmes mots, à la casse, aux espaces et à la ponctuation près.
function sameWords(a: string, b: string): boolean {
  const words = (text: string) => normalizeForQuote(text).replace(/[^\p{L}\d]+/gu, " ").trim();
  return words(a) === words(b);
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
            {/* Accord global : la phrase est citée une seule fois, au-dessus. */}
            {ask.quote && !ask.global ? <q className="text-attenue">{ask.quote}</q> : null}
            {/* Accordé en partie (mission #082) : ce qui reste à préciser. */}
            {ask.status === "partial" ? (
              <span className="font-semibold text-encre">Reste à préciser : {ask.remaining ?? "ce que la marque n'a pas repris de ta demande"}.</span>
            ) : null}
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
  // Mission #083, A1 : une demande dont la lecture a été écartée n'est ni
  // accordée ni « sans réponse » : elle est dite non vérifiable, dans le tour
  // où c'est arrivé, et tant qu'aucune réponse vérifiée ne l'a remplacée.
  const unverified = payload.asks.filter(
    (ask) => ask.unverified_turn !== null && (ask.unverified_turn === turnNumber || ask.status === "unanswered"),
  );
  const isUnverified = (ask: Ask) => unverified.includes(ask);
  const decidedNow = payload.asks.filter((ask) => ask.turn === turnNumber && !isUnverified(ask));
  // Mission #080 quinquies, C : une demande sans réponse explicite dont le
  // terme a changé, preuve à l'appui, dans son sens n'est pas « sans réponse ».
  const aligned = payload.asks.filter((ask) => ask.status === "unanswered" && ask.aligned_group !== null);
  const stillOpen = payload.asks.filter((ask) => ask.status === "unanswered" && ask.aligned_group === null && !isUnverified(ask));
  const globalQuote = decidedNow.find((ask) => ask.global)?.quote ?? null;
  const current = payload.pricing_after ?? payload.pricing_before;
  // Mission #085 : termes changés, table de l'analyse disparue du code. Aucun
  // chiffre n'est actuel : ni celui d'origine, ni celui d'une autre table.
  const unpriced = payload.pricing_unavailable;
  const currentRange = unpriced ? null : formatEurRange(current.total_low, current.total_high);
  const offered = offeredOf(payload.deal_after);
  const reading = dealRecapRows(payload.deal_after);
  // Mission #095 — points refermés par la marque, et points encore ouverts.
  const settled = payload.points.filter((point) => point.status !== "unknown");
  const open = payload.points.filter((point) => point.status === "unknown");

  return (
    <article aria-labelledby={`tour-${turnNumber}`} className="flex flex-col gap-6 border-t-2 border-encre pt-6">
      <header className="flex flex-col gap-1">
        {/* Mission #096 : c'est ce titre qu'on amène en vue et qui prend le
            focus à l'arrivée du tour (lib/ui/reveal.ts). */}
        <h3 id={turnAnchorId(turnNumber)} tabIndex={-1} className="scroll-mt-24 text-h3">
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

      {decidedNow.length > 0 || stillOpen.length > 0 || aligned.length > 0 || unverified.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h4 className="font-bold text-encre">Ce que la marque répond à tes demandes</h4>
          {globalQuote ? (
            <p className="border-l-4 border-encre py-1 pl-3 text-small">
              Accord global, sans détail point par point : <q>{globalQuote}</q>. La marque n&apos;a repris aucun point
              un par un : fais-les-lui confirmer par écrit.
            </p>
          ) : null}
          <AskGroup status="granted" asks={decidedNow.filter((a) => a.status === "granted")} />
          <AskGroup status="partial" asks={decidedNow.filter((a) => a.status === "partial")} />
          <AskGroup status="refused" asks={decidedNow.filter((a) => a.status === "refused")} />
          <AskGroup status="countered" asks={decidedNow.filter((a) => a.status === "countered")} />
          {aligned.length > 0 ? (
            <div className="flex flex-col gap-1">
              <h5 className="font-semibold text-encre">Le terme a changé dans ce sens, sans phrase explicite de la marque</h5>
              <ul className="flex flex-col gap-2 text-small">
                {aligned.map((ask) => (
                  <li key={ask.id} className="flex flex-col gap-0.5">
                    <span>{ask.label}</span>
                    <span className="text-attenue">
                      Maintenant : {groupLabel(payload.deal_after, ask.aligned_group as TermGroup)}. Fais-le-lui confirmer par écrit.
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {unverified.length > 0 ? (
            <div className="flex flex-col gap-1">
              <h5 className="font-semibold text-encre">{UNVERIFIED_LABEL}</h5>
              <ul className="flex flex-col gap-2 text-small">
                {unverified.map((ask) => (
                  <li key={ask.id} className="flex flex-col gap-0.5">
                    <span>{ask.label}</span>
                    <span className="text-attenue">{UNVERIFIED_HINT}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
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
        {unpriced ? (
          <p className="text-small">
            Les termes ont changé, mais la table de tarifs {payload.pricing_before.rate_table_version} de cette analyse
            n&apos;existe plus dans l&apos;outil : ni la fourchette ni ta contre-offre ne peuvent être recalculées sur ces
            termes. Le message suivant ne cite donc aucun montant.
          </p>
        ) : payload.pricing_after ? (
          <>
            <p className="text-small">Les termes ont changé : voici le nouveau chiffrage, à côté de l&apos;ancien.</p>
            <PricingCompare before={payload.pricing_before} after={payload.pricing_after} />
            {/* Tours enregistrés avant la mission #085 seulement : depuis, un fil se
                chiffre entier avec la table de son analyse. */}
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
              <dd className="font-semibold text-encre tabular-nums">{unpriced ? "Non recalculable" : (currentRange ?? "Pas d'estimation")}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-attenue">{offered?.kind === "products" ? "Valeur des produits proposés" : "Montant proposé par la marque"}</dt>
              <dd className="font-semibold text-encre tabular-nums">{offered ? formatEur(offered.value) : "Aucun montant écrit"}</dd>
            </div>
            {offered && !unpriced && current.total_low !== null ? (
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
                {/* Mission #084, B1 : reformulation identique à la citation
                    (« Ça te va ? » deux fois) : la citation seule suffit. */}
                {sameWords(question.question, question.quote) ? null : <span>{question.question}</span>}
                <q className={sameWords(question.question, question.quote) ? undefined : "text-attenue"}>{question.quote}</q>
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

      {/* Mission #095 — la mémoire du fil, à l'écran : ce que la marque a déjà
          renseigné, et la phrase qui le dit. C'est ce qui interdit de le
          redemander ; ça doit donc être vérifiable. */}
      {settled.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h4 className="font-bold text-encre">Ce que la marque a déjà renseigné</h4>
          <ul className="flex flex-col gap-2 text-small">
            {settled.map((point) => (
              <li key={point.key} className="flex flex-col gap-0.5">
                <span className="font-semibold text-encre">
                  {POINT_LABEL[point.key]} — {POINT_STATUS_LABEL[point.status].toLowerCase()} au tour {point.turn}
                </span>
                {point.quote ? <q className="text-attenue">{point.quote}</q> : null}
              </li>
            ))}
          </ul>
          {open.length > 0 ? (
            <p className="text-small text-attenue">Reste à obtenir : {open.map((point) => POINT_LABEL[point.key].toLowerCase()).join(", ")}.</p>
          ) : null}
          {payload.dropped_questions.length > 0 ? (
            <p className="text-small">
              Le message proposé reposait une question sur{" "}
              {[...new Set(payload.dropped_questions.map((dropped) => POINT_LABEL[dropped.point].toLowerCase()))].join(", ")} : elle a été
              retirée, la marque y a déjà répondu.
            </p>
          ) : null}
        </section>
      ) : null}

      {payload.conclusion ? (
        <ConclusionView conclusion={payload.conclusion} turn={turnNumber} />
      ) : payload.closing ? (
        <section className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <h4 className="font-bold text-encre">Tout est sur la table</h4>
            <p className="text-small">
              La marque a répondu sur chaque point et un montant est écrit. À toi de décider : accepter ces termes, ou tenir ton tarif.
              L&apos;outil ne tranche pas à ta place — les deux messages sont prêts, tu envoies celui que tu choisis.
            </p>
            <dl className="flex flex-col divide-y divide-filet border-y border-filet text-small">
              {payload.closing.recap.map((row) => (
                <div key={row.label} className="flex justify-between gap-4 py-2">
                  <dt className="text-attenue">{row.label}</dt>
                  <dd className="text-right font-semibold text-encre">{row.value}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="flex flex-col gap-2 border-l-4 border-encre py-1 pl-4">
            <h5 className="font-semibold text-encre">Si tu acceptes</h5>
            <p className="text-small">{payload.closing.accept.implies}</p>
            <EditableMessage text={payload.closing.accept.text} label="Message qui accepte" turn={turnNumber} />
          </div>
          <div className="flex flex-col gap-2 border-l-4 border-encre py-1 pl-4">
            <h5 className="font-semibold text-encre">Si tu tiens ton prix</h5>
            <p className="text-small">{payload.closing.hold.implies}</p>
            <EditableMessage text={payload.closing.hold.text} label="Message qui tient le prix" turn={turnNumber} />
          </div>
        </section>
      ) : (
        <section className="flex flex-col gap-2">
          <h4 className="font-bold text-encre">Ton message suivant</h4>
          {payload.message.fallback ? (
            <p className="text-small">
              Le message rédigé par l&apos;outil contenait {payload.message.fallback_reasons.join(", ")} : il a été remplacé par
              un message simple, qui reprend tes demandes.
            </p>
          ) : (
            <p className="text-small text-attenue">Ton : {toneLabel(payload.message.tone)}</p>
          )}
          <EditableMessage text={payload.message.text} turn={turnNumber} />
        </section>
      )}
    </article>
  );
}
