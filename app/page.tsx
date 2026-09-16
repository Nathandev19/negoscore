import Link from "next/link";
import { ShieldCheckIcon } from "lucide-react";
import { TrackView } from "@/components/analytics/track-view";
import { DealInput } from "@/components/deal-input";
import { ScoreCard } from "@/components/result/score-card";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { ANALYTICS_EVENTS } from "@/lib/analytics/events";
import { formatEurRange } from "@/lib/display";
import { sampleAnalysis } from "@/lib/sample-analysis";

const PROOFS = [
  { title: "Un score sur 100", text: "Tu sais tout de suite si l'offre tient la route." },
  { title: "Un chiffrage en euros", text: "Ce que valent vraiment les droits, l'exclusivité et les rushs." },
  { title: "Un message prêt à envoyer", text: "Tu négocies sans passer pour quelqu'un de gourmand." },
] as const;

export default function HomePage() {
  const { score, confidence, estimate, red_flags } = sampleAnalysis;
  const total = formatEurRange(estimate.total_low, estimate.total_high);

  return (
    <>
      <SiteHeader />
      <TrackView event={ANALYTICS_EVENTS.landingView} />
      <main className="flex-1">
        <section
          id="analyser"
          className="mx-auto grid w-full max-w-5xl scroll-mt-4 gap-5 px-4 pt-2 pb-10 sm:px-6 lg:grid-cols-2 lg:items-center lg:gap-12 lg:pt-12 lg:pb-20"
        >
          <div className="flex flex-col gap-3">
            <h1 className="text-[2rem] leading-[1.1] font-black tracking-tight text-balance sm:text-5xl">
              Cette marque te propose combien&nbsp;?
            </h1>
            <p className="text-base text-neutral-700 sm:text-lg">
              Colle son message. On te dit ce que ça vaut vraiment, ce que tu cèdes, et quoi
              répondre. Gratuit, 30&nbsp;secondes.
            </p>
          </div>
          <DealInput />
        </section>

        <section className="border-t bg-white">
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-12 px-4 py-12 sm:px-6 lg:py-20">
            <ul className="grid gap-6 sm:grid-cols-3">
              {PROOFS.map((proof) => (
                <li key={proof.title} className="flex flex-col gap-1">
                  <p className="text-lg font-bold">{proof.title}</p>
                  <p className="text-neutral-600">{proof.text}</p>
                </li>
              ))}
            </ul>

            <div className="grid gap-6 lg:grid-cols-2 lg:items-center">
              <div className="flex flex-col gap-2">
                <p className="text-sm font-medium text-neutral-500">Exemple d&apos;analyse</p>
                <p className="text-2xl font-bold tracking-tight">
                  Une offre reçue en DM, passée au crible en 30&nbsp;secondes.
                </p>
              </div>
              <div className="flex flex-col gap-3">
                <ScoreCard score={score} confidence={confidence} />
                {total ? (
                  <div className="rounded-xl border bg-white p-4">
                    <p className="text-sm text-neutral-600">Ce que ça vaut vraiment</p>
                    <p className="text-3xl font-black tracking-tight">{total}</p>
                  </div>
                ) : null}
                {red_flags[0] ? (
                  <div className="rounded-xl border bg-white p-4">
                    <p className="text-sm text-neutral-600">Red flag</p>
                    <p className="text-xl font-bold">{red_flags[0].label}</p>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="flex gap-3 rounded-xl border bg-neutral-50 p-5">
              <ShieldCheckIcon className="mt-0.5 size-6 shrink-0 text-neutral-800" />
              <div>
                <p className="font-bold">Tes documents sont supprimés après 30&nbsp;jours</p>
                <p className="text-neutral-600">
                  Messages, captures et PDF : on ne les garde pas plus longtemps. Ils ne servent
                  qu&apos;à ton analyse.
                </p>
              </div>
            </div>

            <Button asChild size="lg" className="h-12 w-full text-base sm:w-auto sm:self-center sm:px-10">
              <Link href="/analyse">Analyser mon deal</Link>
            </Button>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
