import Link from "next/link";
import { AnalysisResult } from "@/components/result/analysis-result";
import { EstimateFeedback } from "@/components/result/estimate-feedback";
import { shouldAskFeedback } from "@/lib/analysis/feedback";
import { judgedRanges } from "@/lib/analysis/judged-ranges";
import { NegotiationThread, type ThreadTurnView } from "@/components/result/negotiation/negotiation-thread";
import { currentState } from "@/lib/negotiation/current";
import { loadScenarios, readingOf, scenarioContext } from "@/lib/negotiation/scenarios/index";
import { processTurn } from "@/lib/negotiation/turn";
import type { ThreadAccess, TurnPayload } from "@/lib/negotiation/types";
import { RetryPanel, type RetryPanelState } from "@/components/result/retry-panel";
import { VerdictCardShare } from "@/components/result/verdict-card-share";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { PREVIEW_STATES, previewAnalysis, type PreviewState } from "@/lib/fixtures/preview-states";
import { verdictCardAvailable } from "@/lib/share-card/verdict-card";
import { carteDeLAnalyse } from "@/lib/share-card/verdict-data";

// DÉVELOPPEMENT UNIQUEMENT (extension .dev.tsx, voir next.config.ts) : la page
// de résultat complète rendue depuis une fixture passée par le vrai moteur,
// sans base ni appel au modèle. /dev/resultat?etat=…
function retryPreview(value: string | string[] | undefined): RetryPanelState {
  if (value === "used") return { kind: "used", retryHref: "/dev/resultat?etat=debloque" };
  if (value === "expired") return { kind: "expired" };
  if (value === "retry_still_incomplete") return { kind: "retry_still_incomplete" };
  return { kind: "available", until: "1er octobre" };
}

// Suite de l'échange (mission #080), rendue depuis les scénarios de réponses
// de marque (lib/negotiation/scenarios) : ?echange=fil|partiel|refus|conclu|question|repli|non-verifiable|non-connecte.
const THREAD_PREVIEWS: Record<string, { scenarios: string[]; access: ThreadAccess }> = {
  fil: { scenarios: ["03-termes-a-la-hausse", "06-reponse-vague"], access: "open" },
  partiel: { scenarios: ["02-acceptation-partielle"], access: "open" },
  refus: { scenarios: ["05-refus-net"], access: "open" },
  conclu: { scenarios: ["01-acceptation-franche"], access: "open" },
  question: { scenarios: ["07-question-a-la-creatrice"], access: "open" },
  repli: { scenarios: ["10-garde-citation-inventee"], access: "open" },
  "non-verifiable": { scenarios: ["18-garde-accord-non-verifiable"], access: "open" },
  "non-connecte": { scenarios: [], access: "signed_out" },
};

function threadPreview(name: string) {
  const preview = THREAD_PREVIEWS[name];
  const all = loadScenarios();
  const chosen = preview.scenarios.map((id) => all.find((s) => s.id === id)!);
  const base = scenarioContext(all[0]);
  const previous: TurnPayload[] = [];
  const turns: ThreadTurnView[] = [];
  for (const scenario of chosen) {
    const context = { ...base, previous: [...previous], turnNumber: 2 + previous.length, brandReply: scenario.reponse_marque };
    const result = processTurn(context, readingOf(scenario, base.original));
    if (result.kind !== "turn") continue;
    previous.push(result.payload);
    turns.push({ turnNumber: context.turnNumber, createdAt: "2026-09-19T10:00:00.000Z", brandReply: scenario.reponse_marque, payload: result.payload });
  }
  return { analysis: base.original, turns, access: preview.access };
}

export default async function ResultPreviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const requested = (await searchParams).etat;
  const state: PreviewState =
    typeof requested === "string" && (PREVIEW_STATES as readonly string[]).includes(requested)
      ? (requested as PreviewState)
      : "debloque";
  const echange = (await searchParams).echange;
  const thread = typeof echange === "string" && echange in THREAD_PREVIEWS ? threadPreview(echange) : null;
  const analysis = thread ? thread.analysis : previewAnalysis(state).analysis;
  const relance = (await searchParams).relance;
  const negotiated = thread ? currentState({ turns: thread.turns, conclusion: null }) : null;

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
      <AnalysisResult
        analysis={analysis}
        unlockHref="/connexion"
        // Relance : état choisi par ?relance=available|used|expired|retry_still_incomplete.
        retry={<RetryPanel state={retryPreview(relance)} originId={null} />}
        negotiated={negotiated}
        afterMessage={
          thread ? <NegotiationThread key="echange" analysisId="apercu" turns={thread.turns} conclusion={null} access={thread.access} /> : null
        }
      >
        {/* Mission #169 — le même bouton que la page réelle. L'aperçu ne
            passe pas par la base : il pointe sur /dev/carte, qui rend la
            carte depuis la fixture. */}
        {verdictCardAvailable(carteDeLAnalyse(analysis)) ? <VerdictCardShare href={`/dev/carte?etat=${state}`} /> : null}
        {shouldAskFeedback({
          current: { low: analysis.estimate.total_low, high: analysis.estimate.total_high },
          lastJudged: null,
          answeredThisTurn: false,
        }) ? (
          <EstimateFeedback action={null} initial={null} turn={negotiated?.turn ?? 0} ranges={judgedRanges(analysis)} />
        ) : null}
      </AnalysisResult>
      <SiteFooter />
    </>
  );
}
