import type { Metadata } from "next";
import Link from "next/link";
import { FirstPartyView } from "@/components/analytics/first-party-view";
import { DealInput } from "@/components/deal-input";
import { ScoreBand } from "@/components/result/score-band";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { FEATURED_PLAN, PLANS } from "@/lib/billing/plans";
import { exampleHrefFrom } from "@/lib/analytics/views";
import { FULL_EXAMPLE, MENTION_TTC, negotiations, NEGOTIATIONS } from "@/lib/content/vocabulaire";
import { FAQ, STEPS, TRUST } from "@/lib/content/home";
import { JsonLd } from "@/components/seo/json-ld";
import { faqJsonLd, publicPageMetadata, softwareApplicationJsonLd } from "@/lib/seo";
import { formatEur, formatEurRange } from "@/lib/display";
import { sampleAnalysis } from "@/lib/sample-analysis";
import { cn } from "@/lib/utils";

// Rythme : serré à l'intérieur d'un groupe, large entre les groupes (64 px sur
// mobile, 96 px au-delà). Fond crème ; le bleu marque n'apparaît que sur
// l'exemple de résultat, le bouton principal et les liens.
const SECTION = "border-t border-filet";
const SECTION_INNER = "mx-auto flex w-full max-w-6xl flex-col px-4 py-16 sm:px-6 md:py-24";

export const metadata: Metadata = publicPageMetadata("/");

export default function HomePage() {
  const { score, estimate, red_flags, deal } = sampleAnalysis;
  const total = formatEurRange(estimate.total_low, estimate.total_high);

  return (
    <>
      {/* Ce qu'est le site, pour les moteurs (mission #069) : l'application,
          sa promesse et ses formules, prix repris de la source unique.
          L'organisation et le site sont déclarés par la mise en page. */}
      <JsonLd data={softwareApplicationJsonLd()} />
      {/* La FAQ affichée plus bas, balisée mot pour mot : même source (FAQ). */}
      <JsonLd data={faqJsonLd()} />
      <SiteHeader />
      <FirstPartyView event="landing_view" />
      <main id="contenu" className="flex-1">
        {/* C1 — le champ reste au-dessus de la ligne de flottaison sur mobile. */}
        <section
          id="analyser"
          /* Mission #163 — LES 27 px QUI MANQUAIENT AU LIEN, pris dans le
             vide et nulle part ailleurs. Mesuré à 375 x 667, état stabilisé :
             le bas du lien tombait à 694 px pour un écran de 667.
             Ni le titre ni la phrase de promesse ne sont touchés : ce sont
             trois espacements, et seulement sur mobile — au-delà de 1024 px
             les valeurs d'origine (lg:) s'appliquent toujours.
                pt-6 → pt-3        12 px sous un en-tête collant de 56 px
                gap-6 → gap-3      12 px entre le message et le formulaire
                gap-3 → gap-2       4 px entre le titre et la promesse
             Vingt-huit px rendus. Le reste du levier est dans la zone de
             texte, et on n'y touche pas : c'est la surface du geste. */
          className="mx-auto grid w-full max-w-6xl gap-3 px-4 pt-3 pb-16 sm:px-6 md:pb-24 lg:grid-cols-[1.1fr_1fr] lg:items-end lg:gap-16 lg:pt-20"
        >
          <div className="flex flex-col gap-2">
            <h1 className="text-display font-extrabold text-balance">Cette marque te propose combien&nbsp;?</h1>
            <p className="measure text-body text-encre-douce sm:text-lg">
              Colle son message. On te dit ce que ça vaut vraiment, ce que tu cèdes, et quoi répondre — jusqu&apos;à la
              conclusion du deal.
            </p>
            {/* Mission #153 — COPILOT_PROMISE a quitté le haut de page : 61 px
                pour redire ce que les deux lignes au-dessus disent déjà. La
                phrase n'est pas perdue pour autant — elle reste, mot pour mot,
                dans la FAQ de cette même page (« Un copilote, pas un
                décideur », lib/content/home.ts) et dans la description du
                service aux CGV. */}
          </div>
          <div className="flex flex-col gap-2">
            {/* La phrase est masquée quand il ne reste aucun droit : elle serait fausse à ce moment-là. */}
            <DealInput note="Verdict et fourchette gratuits, sans compte. Ton email suffit pour la contre-offre et les messages." />
            {/* Mission #152 — LA SORTIE POUR QUI N'A PAS D'OFFRE SOUS LA MAIN.
                Le lien vers l'exemple existait déjà, mais dans la section C3,
                trois écrans plus bas : quelqu'un qui arrive par la bio voit un
                champ à remplir, rien d'autre, et repart s'il n'a rien à coller.
                Ici c'est un LIEN, pas un bouton : il ne concurrence pas
                l'action principale, il offre l'autre chemin.
                Le libellé est celui du vocabulaire, le même partout (#119).
                Et aucun paramètre utm : un lien interne ne doit jamais
                réécrire l'attribution d'acquisition du visiteur. `?de=` ne dit
                que d'où vient le clic, et n'entre pas dans les colonnes utm. */}
            <Link href={exampleHrefFrom("accueil")} className="link w-fit text-small">
              {FULL_EXAMPLE.label}
            </Link>
          </div>
        </section>

        {/* C2 */}
        <section id="methode" className={SECTION}>
          <div className={cn(SECTION_INNER, "gap-10 md:gap-12")}>
            <h2 className="text-h1 font-extrabold">Comment ça marche</h2>
            <ol className="flex flex-col border-b border-filet">
              {STEPS.map((step, index) => (
                <li
                  key={step.title}
                  className="grid grid-cols-[3.5rem_1fr] gap-x-4 border-t border-filet py-6 sm:grid-cols-[6rem_1fr] md:grid-cols-[6rem_16rem_1fr] md:gap-x-8"
                >
                  <span aria-hidden className="figures text-5xl leading-none text-attenue sm:text-6xl">
                    {index + 1}
                  </span>
                  <div className="flex flex-col gap-2 md:contents">
                    <h3 className="text-h3 font-bold md:pt-1">{step.title}</h3>
                    <p className="measure md:pt-1">{step.text}</p>
                  </div>
                </li>
              ))}
            </ol>
            <blockquote className="headline measure text-verdict text-encre">
              On ne lit que ce qui est écrit dans l&apos;offre. Ce qui n&apos;y figure pas n&apos;est ni deviné ni
              reproché à la marque.
            </blockquote>
          </div>
        </section>

        {/* C3 — l'exemple reprend l'en-tête bleu d'une page de résultat : c'est le produit. */}
        <section className={SECTION}>
          <div className={cn(SECTION_INNER, "gap-10 lg:grid lg:grid-cols-[1fr_1.2fr] lg:items-center lg:gap-16")}>
            <div className="flex flex-col gap-3">
              <p className="text-xs font-bold tracking-wide text-attenue uppercase">Exemple</p>
              <h2 className="text-h1">Une offre reçue en DM, chiffrée en euros</h2>
              <p className="measure">
                Une marque propose{" "}
                <span className="figures text-encre">{formatEur(deal.payment.amount_eur ?? 0)}</span> pour{" "}
                {deal.deliverables.map((d) => (d.quantity === null ? "des vidéos" : `${d.quantity} vidéo${d.quantity > 1 ? "s" : ""}`)).join(", ")}, avec droits pub
                et exclusivité. L&apos;offre est inventée, le chiffrage est celui du moteur actuel : ce n&apos;est pas une vraie
                négociation en cours.
              </p>
              {/* Mission #119 — le lien existait déjà ici, et ici seulement.
                  Son libellé vient désormais du vocabulaire, le même que sur
                  les trois guides : une seule formule pour une seule page. */}
              <Link href={exampleHrefFrom("accueil")} className="link w-fit">
                {FULL_EXAMPLE.label}
              </Link>
            </div>
            {score ? (
              <div className="on-marque grain flex flex-col overflow-hidden rounded-control bg-marque text-creme">
                <ScoreBand analysis={sampleAnalysis} className="p-5 sm:p-7 lg:grid-cols-1 lg:gap-6" />
                {total ? (
                  <div className="flex flex-col gap-1 border-t border-creme/30 px-5 py-4 sm:px-7">
                    <p className="text-small">Ce que ça vaut vraiment</p>
                    <p className="figures text-4xl text-creme sm:text-5xl">{total}</p>
                  </div>
                ) : null}
                {red_flags[0] ? (
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-creme/30 px-5 py-4 sm:px-7">
                    <p className="headline text-h3 text-creme">{red_flags[0].label}</p>
                    <span className="rounded-pill bg-band-bad-on-marque px-2.5 py-0.5 text-xs font-bold text-encre">
                      Point à surveiller
                    </span>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </section>

        {/* C4 — trois formules séparées par des filets, une seule mise en avant. */}
        <section id="tarifs" className={SECTION}>
          <div className={cn(SECTION_INNER, "gap-10 md:gap-12")}>
            <div className="flex flex-col gap-2">
              <h2 className="text-h1 font-extrabold">Ce que ça coûte</h2>
              <p className="measure">
                Ta première négociation est gratuite{NEGOTIATIONS.free > 1 ? ` (${negotiations(NEGOTIATIONS.free)})` : ""}, sans
                carte bancaire. Une négociation couvre un deal en entier, de l&apos;analyse à la conclusion.{" "}
                {MENTION_TTC}
              </p>
            </div>
            <ul className="flex flex-col">
              {PLANS.map((plan) => {
                const featured = plan.id === FEATURED_PLAN;
                return (
                  <li
                    key={plan.id}
                    className={cn(
                      "flex flex-wrap items-baseline justify-between gap-x-8 gap-y-1 border-t py-6 last:border-b",
                      featured ? "border-encre py-8 [&+li]:border-t-encre" : "border-filet",
                    )}
                  >
                    <div className="flex flex-col gap-1">
                      <h3 className={cn("font-bold", featured ? "text-h2" : "text-h3")}>{plan.name}</h3>
                      <p className={featured ? "font-medium text-encre" : undefined}>{plan.summary}</p>
                    </div>
                    <p
                      className={cn(
                        "figures tracking-tight text-encre",
                        featured ? "text-5xl sm:text-6xl" : "text-3xl text-encre-douce",
                      )}
                    >
                      {plan.price}
                      {plan.period ? <span className="font-sans text-body font-medium text-attenue"> {plan.period}</span> : null}
                    </p>
                  </li>
                );
              })}
            </ul>
            <Link href="/tarifs" className="link w-fit font-semibold">
              Voir le détail des formules
            </Link>
          </div>
        </section>

        {/* C5 */}
        <section className={SECTION}>
          <div className={cn(SECTION_INNER, "gap-10 md:gap-12")}>
            <h2 className="text-h1 font-extrabold">Pourquoi tu peux t&apos;y fier</h2>
            <ul className="grid gap-x-12 gap-y-8 sm:grid-cols-2">
              {TRUST.map((point) => (
                <li key={point.title} className="flex flex-col gap-2 border-t border-encre pt-4">
                  <h3 className="text-h3 font-bold">{point.title}</h3>
                  <p className="measure">{point.text}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* C6 */}
        <section id="faq" className={SECTION}>
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-16 sm:px-6 md:py-24">
            <h2 className="text-h1 font-extrabold">Questions fréquentes</h2>
            <div className="flex flex-col divide-y divide-filet border-y border-filet">
              {FAQ.map((item) => (
                <details key={item.question} className="group">
                  <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-3 font-semibold text-encre">
                    {item.question}
                    <span aria-hidden className="figures text-2xl leading-none transition-transform duration-150 group-open:rotate-45">
                      +
                    </span>
                  </summary>
                  <p className="measure pb-5">{item.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* C7 */}
        <section className="border-t border-encre">
          <div className="mx-auto flex w-full max-w-6xl flex-col items-start gap-3 px-4 py-16 sm:px-6 md:py-24">
            <h2 className="text-h1 font-extrabold">Une offre en attente de réponse ?</h2>
            <p className="measure">Colle-la, et sache ce qu&apos;elle vaut avant de répondre.</p>
            <Button asChild size="lg" className="mt-5 h-12 w-full text-base sm:w-fit">
              <Link href="/analyse">Analyser mon deal</Link>
            </Button>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
