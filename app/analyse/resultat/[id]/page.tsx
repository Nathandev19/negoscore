import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { AnalysisResult } from "@/components/result/analysis-result";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { loadResultForViewer } from "@/lib/analysis/load";
import { getViewer } from "@/lib/auth/viewer";
import { ANON_COOKIE } from "@/lib/security/request";

export const metadata: Metadata = {
  title: "Résultat de l'analyse",
  robots: { index: false, follow: false },
};

export default async function AnalysisPage({ params }: PageProps<"/analyse/resultat/[id]">) {
  const { id } = await params;
  const anonToken = (await cookies()).get(ANON_COOKIE)?.value ?? null;
  const user = await getViewer();
  const result = await loadResultForViewer(id, { user, anonToken });
  if (!result) notFound();

  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-10 px-4 pt-2 pb-12 sm:px-6 sm:pt-8">
        <AnalysisResult
          analysis={result.analysis}
          unlockHref={`/connexion?next=${encodeURIComponent(`/analyse/resultat/${id}`)}`}
        />
      </main>
      <SiteFooter />
    </>
  );
}
