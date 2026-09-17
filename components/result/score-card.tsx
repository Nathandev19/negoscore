import { BAND_LABEL, BAND_STYLE, CONFIDENCE_LABEL } from "@/lib/display";
import type { Analysis } from "@/lib/schema";
import { cn } from "@/lib/utils";

type ScoreCardProps = {
  score: NonNullable<Analysis["score"]>;
  confidence: Analysis["confidence"];
};

export function ScoreCard({ score, confidence }: ScoreCardProps) {
  const style = BAND_STYLE[score.band];
  return (
    <section
      aria-label="Score du deal"
      className={cn("flex flex-col items-center gap-1 rounded-2xl border px-6 py-6", style.tint, style.border)}
    >
      <p className={cn("figures flex items-baseline font-extrabold tracking-tight", style.text)}>
        <span className="text-8xl leading-none">{score.value}</span>
        <span className="text-3xl">/100</span>
      </p>
      <p className={cn("font-display text-2xl font-bold", style.text)}>{BAND_LABEL[score.band]}</p>
      <p className="mt-1 text-xs text-subtle">{CONFIDENCE_LABEL[confidence]}</p>
    </section>
  );
}
