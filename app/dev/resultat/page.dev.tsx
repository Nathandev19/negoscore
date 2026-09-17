import Link from "next/link";
import { AnalysisResult } from "@/components/result/analysis-result";
import { EstimateFeedback } from "@/components/result/estimate-feedback";
import { ShareCardLink } from "@/components/result/share-card-link";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { PREVIEW_STATES, previewAnalysis, type PreviewState } from "@/lib/fixtures/preview-states";
import { shareCardAvailable } from "@/lib/share-card/element";

// DÉVELOPPEMENT UNIQUEMENT (extension .dev.tsx, voir next.config.ts) : la page
// de résultat complète rendue depuis une fixture passée par le vrai moteur,
// sans base ni appel au modèle. /dev/resultat?etat=…
export default async function ResultPreviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const requested = (await searchParams).etat;
  const state: PreviewState =
    typeof requested === "string" && (PREVIEW_STATES as readonly string[]).includes(requested)
      ? (requested as PreviewState)
      : "debloque";
  const { analysis } = previewAnalysis(state);

  return (
    <>
      <nav aria-label="États de prévisualisation" className="flex flex-wrap gap-x-4 gap-y-1 border-b-2 border-encre bg-creme px-4 py-2 text-small">
        <span className="font-bold text-encre">Prévisualisation (dev) :</span>
        {PREVIEW_STATES.map((name) => (
          <Link key={name} href={`/dev/resultat?etat=${name}`} className={name === state ? "font-bold text-encre" : "link"}>
            {name}
          </Link>
        ))}
      </nav>
      <SiteHeader tone="marque" />
      <AnalysisResult analysis={analysis} unlockHref="/connexion">
        {shareCardAvailable(analysis) ? <ShareCardLink href={`/dev/carte?etat=${state}`} /> : null}
        <EstimateFeedback action={null} initial={null} />
      </AnalysisResult>
      <SiteFooter />
    </>
  );
}
