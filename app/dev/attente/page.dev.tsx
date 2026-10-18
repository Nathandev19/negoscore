import { ThreadPending } from "@/components/result/negotiation/thread-status";
import { SiteHeader } from "@/components/site-header";
import { WaitingSimulation } from "./simulation.dev";

// DÉVELOPPEMENT UNIQUEMENT (extension .dev.tsx) : l'écran d'attente vu à un
// instant donné, sans lancer d'analyse. /dev/attente?depuis=35000&type=pdf
//
// Mission #200 — et l'attente d'un TOUR de négociation, sous le même toit :
// c'est le même panneau, avec une seule étape, et c'est le seul moyen de le
// regarder sans appeler le modèle. /dev/attente?tour=1
export default async function WaitingPreviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const since = typeof params.depuis === "string" && /^\d+$/.test(params.depuis) ? Number(params.depuis) : 0;
  const kind = params.type === "photo" || params.type === "pdf" ? params.type : "text";
  return (
    <>
      <SiteHeader />
      <main id="contenu" className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 pt-6 pb-16 sm:px-6 md:pt-16">
        {params.tour === undefined ? (
          <WaitingSimulation kind={kind} startedAgoMs={since} />
        ) : (
          <ThreadPending turnNumber={3} />
        )}
      </main>
    </>
  );
}
