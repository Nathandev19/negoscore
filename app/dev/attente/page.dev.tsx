import { WaitingScreen } from "@/components/loading-steps";
import { SiteHeader } from "@/components/site-header";

// DÉVELOPPEMENT UNIQUEMENT (extension .dev.tsx) : l'écran d'attente vu à un
// instant donné, sans lancer d'analyse. /dev/attente?depuis=35000
export default async function WaitingPreviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = (await searchParams).depuis;
  const since = typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : 0;
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 pt-6 pb-16 sm:px-6 md:pt-16">
        <WaitingScreen finished={false} startedAgoMs={since} />
      </main>
    </>
  );
}
