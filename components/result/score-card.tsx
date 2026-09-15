import { BAND_BG, BAND_COLOR, BAND_LABEL, CONFIDENCE_LABEL } from "@/lib/display";
import type { Analysis } from "@/lib/schema";
import { cn } from "@/lib/utils";

type ScoreCardProps = {
  score: Analysis["score"];
  confidence: Analysis["confidence"];
};

export function ScoreCard({ score, confidence }: ScoreCardProps) {
  return (
    <section
      aria-label="Score du deal"
      className={cn("flex flex-col items-center gap-1 rounded-2xl border px-6 py-6", BAND_BG[score.band])}
    >
      <p className={cn("flex items-baseline font-black tracking-tight", BAND_COLOR[score.band])}>
        <span className="text-8xl leading-none">{score.value}</span>
        <span className="text-3xl">/100</span>
      </p>
      <p className={cn("text-2xl font-bold", BAND_COLOR[score.band])}>{BAND_LABEL[score.band]}</p>
      <p className="mt-1 text-xs text-neutral-600">{CONFIDENCE_LABEL[confidence]}</p>
    </section>
  );
}
