import Link from "next/link";
import { TrackView } from "@/components/analytics/track-view";
import { DealInput } from "@/components/deal-input";
import { ScoreCard } from "@/components/result/score-card";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { ANALYTICS_EVENTS } from "@/lib/analytics/events";
import { FREE_ANALYSES, PLANS } from "@/lib/billing/plans";
import { FAQ, STEPS, TRUST } from "@/lib/content/home";
import { formatEur, formatEurRange } from "@/lib/display";
import { sampleAnalysis } from "@/lib/sample-analysis";

export default function HomePage() {
  const { score, confidence, estimate, red_flags, deal } = sampleAnalysis;
  const total = formatEurRange(estimate.total_low, estimate.total_high);

  return (
    <>
      <SiteHeader />
      <TrackView event={ANALYTICS_EVENTS.landingView} />
      <main className="flex-1">
        {/* C1 — le champ reste au-dessus de la ligne de flottaison sur mobile. */}
        <section
          id="analyser"
          className="mx-auto grid w-full max-w-6xl gap-5 px-4 pt-4 pb-12 sm:px-6 lg:grid-cols-2 lg:items-center lg:gap-12 lg:pt-16 lg:pb-20"
        >
          <div className="flex flex-col gap-3">
            <h1 className="text-display font-extrabold text-balance">Cette marque te propose combien&nbsp;?</h1>
            <p className="measure text-body sm:text-lg">
              Colle son message. On te dit ce que ça vaut vraiment, ce que tu cèdes, et quoi répondre. Gratuit,
              30&nbsp;secondes.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <DealInput />
            <p className="text-center text-small text-subtle">
              Score et fourchette gratuits, sans compte. Ton email suffit pour la contre-offre et le message.
            </p>
          </div>
        </section>

        {/* C2 */}
        <section id="methode" className="border-t border-line bg-surface-soft">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-14 sm:px-6 lg:py-20">
            <h2 className="text-h1 font-extrabold">Comment ça marche</h2>
            <ol className="grid gap-4 sm:grid-cols-3">
              {STEPS.map((step, index) => (
                <li key={step.title} className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5">
                  <span
                    aria-hidden
                    className="figures flex size-9 items-center justify-center rounded-full bg-brand text-lg font-bold text-white"
                  >
                    {index + 1}
                  </span>
                  <h3 className="text-h3 font-bold">{step.title}</h3>
                  <p>{step.text}</p>
                </li>
              ))}
            </ol>
            <p className="measure rounded-xl border-l-4 border-brand bg-surface p-4 text-ink">
              On ne lit que ce qui est écrit dans l&apos;offre. Ce qui n&apos;y figure pas n&apos;est ni deviné ni
              reproché à la marque.
            </p>
          </div>
        </section>

        {/* C3 */}
        <section className="border-t border-line">
          <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-14 sm:px-6 lg:grid-cols-2 lg:items-center lg:py-20">
            <div className="flex flex-col gap-3">
              <p className="text-small font-semibold tracking-wide text-brand uppercase">Exemple figé</p>
              <h2 className="text-h1 font-extrabold">Une offre reçue en DM, chiffrée en euros</h2>
              <p className="measure">
                Une marque propose{" "}
                <span className="figures font-semibold text-ink">{formatEur(deal.payment.amount_eur ?? 0)}</span> pour{" "}
                {deal.deliverables.map((d) => `${d.quantity} vidéo${d.quantity > 1 ? "s" : ""}`).join(", ")}, avec droits pub
                et exclusivité. Cet exemple ne change pas : ce n&apos;est pas une vraie analyse en cours.
              </p>
              <Link href="/analyse/demo" className="w-fit rounded-md font-semibold text-brand underline underline-offset-4 hover:text-brand-strong">
                Voir l&apos;exemple complet
              </Link>
            </div>
            <div className="flex flex-col gap-3">
              {score ? <ScoreCard score={score} confidence={confidence} /> : null}
              {total ? (
                <div className="rounded-2xl border border-line bg-surface p-5">
                  <p className="text-small text-subtle">Ce que ça vaut vraiment</p>
                  <p className="figures text-4xl font-extrabold tracking-tight text-ink sm:text-5xl">{total}</p>
                </div>
              ) : null}
              {red_flags[0] ? (
                <div className="rounded-2xl border border-line bg-surface p-5">
                  <p className="text-small text-subtle">Point à surveiller</p>
                  <p className="font-display text-h3 font-bold text-ink">{red_flags[0].label}</p>
                </div>
              ) : null}
            </div>
          </div>
        </section>

        {/* C4 */}
        <section id="tarifs" className="border-t border-line bg-surface-soft">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-14 sm:px-6 lg:py-20">
            <div className="flex flex-col gap-2">
              <h2 className="text-h1 font-extrabold">Ce que ça coûte</h2>
              <p className="measure">
                Ta première analyse est gratuite{FREE_ANALYSES > 1 ? ` (${FREE_ANALYSES} analyses)` : ""}, sans carte
                bancaire. Prix TTC.
              </p>
            </div>
            <ul className="grid gap-4 md:grid-cols-3">
              {PLANS.map((plan) => (
                <li key={plan.id} className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-5">
                  <h3 className="text-h3 font-bold">{plan.name}</h3>
                  <p className="figures text-4xl font-extrabold tracking-tight text-ink">
                    {plan.price}
                    {plan.period ? <span className="font-sans text-body font-medium text-subtle"> {plan.period}</span> : null}
                  </p>
                  <p className="font-medium text-ink">{plan.summary}</p>
                </li>
              ))}
            </ul>
            <Link
              href="/offres"
              className="inline-flex h-12 w-full items-center justify-center rounded-lg border border-brand bg-surface px-6 font-semibold text-brand transition-colors duration-150 hover:bg-brand-tint sm:w-fit"
            >
              Voir le détail des offres
            </Link>
          </div>
        </section>

        {/* C5 */}
        <section className="border-t border-line">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-14 sm:px-6 lg:py-20">
            <h2 className="text-h1 font-extrabold">Pourquoi tu peux t&apos;y fier</h2>
            <ul className="grid gap-6 sm:grid-cols-2">
              {TRUST.map((point) => (
                <li key={point.title} className="flex flex-col gap-2">
                  <h3 className="text-h3 font-bold">{point.title}</h3>
                  <p className="measure">{point.text}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* C6 */}
        <section id="faq" className="border-t border-line bg-surface-soft">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-14 sm:px-6 lg:py-20">
            <h2 className="text-h1 font-extrabold">Questions fréquentes</h2>
            <div className="flex flex-col divide-y divide-line rounded-2xl border border-line bg-surface">
              {FAQ.map((item) => (
                <details key={item.question} className="group px-5">
                  <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-3 font-semibold text-ink">
                    {item.question}
                    <span aria-hidden className="text-xl text-brand transition-transform duration-150 group-open:rotate-45">
                      +
                    </span>
                  </summary>
                  <p className="measure pb-4">{item.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* C7 */}
        <section className="bg-brand">
          <div className="mx-auto flex w-full max-w-6xl flex-col items-start gap-4 px-4 py-14 sm:px-6 lg:py-16">
            <h2 className="text-h1 font-extrabold text-white">Une offre en attente de réponse ?</h2>
            <p className="measure text-white">Colle-la, et sache ce qu&apos;elle vaut avant de répondre.</p>
            <Link
              href="/analyse"
              className="inline-flex h-12 w-full items-center justify-center rounded-lg bg-surface px-6 font-semibold text-brand-strong transition-colors duration-150 hover:bg-brand-tint sm:w-fit"
            >
              Analyser mon deal
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
