import type { CSSProperties } from "react";
import { verdictSentence } from "@/lib/analysis/verdict";
import type { ResultView } from "@/lib/analysis/lock";
import { BAND_LABEL, BAND_SEGMENTS, BAND_STYLE, EVALUABILITY_LABEL } from "@/lib/display";
import type { Analysis } from "@/lib/schema";
import { cn } from "@/lib/utils";

type Score = NonNullable<Analysis["score"]>;

// Durée du remplissage à l'arrivée (jeton --duration-score de globals.css).
export const SCORE_ANIMATION_MS = 700;

// Bandeau de verdict, posé sur la surface bleue de l'en-tête des résultats.
// Ordre de lecture sur mobile : phrase de verdict, puis score, pastille et
// jauge. Sur grand écran : score, pastille et jauge à gauche, phrase à droite.
// animated : remplissage à l'arrivée (page de résultat). L'exemple de la page
// d'accueil est affiché directement à sa valeur.
export function ScoreBand({
  analysis,
  className,
  animated = true,
}: {
  analysis: ResultView;
  className?: string;
  animated?: boolean;
}) {
  const scored = analysis.evaluability === "complete" && analysis.score !== null;
  return (
    <div className={cn("grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-center lg:gap-12", className)}>
      <p className="headline text-verdict text-balance text-creme lg:order-last">{verdictSentence(analysis)}</p>
      {scored && analysis.score ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
            <AnimatedScore score={analysis.score} animated={animated} />
            <VerdictPill band={analysis.score.band} />
          </div>
          <ScoreGauge score={analysis.score} animated={animated} />
        </div>
      ) : (
        <div className="flex">
          <span className="headline rounded-pill bg-creme px-4 py-1.5 text-lg text-encre">
            {EVALUABILITY_LABEL[analysis.evaluability === "complete" ? "terms_unknown" : analysis.evaluability]}
          </span>
        </div>
      )}
    </div>
  );
}

export function VerdictPill({ band }: { band: Score["band"] }) {
  return (
    <span className={cn("headline mb-3 rounded-pill px-4 py-1.5 text-lg text-encre sm:text-xl", BAND_STYLE[band].onMarque)}>
      {BAND_LABEL[band]}
    </span>
  );
}

// Le score monte de 0 à sa valeur, une fois, en même temps que la jauge se
// remplit. Entièrement en CSS (propriété enregistrée + compteur) : rendu
// statique, aucune hydratation, et prefers-reduced-motion affiche directement
// la valeur finale (règle globale de globals.css).
export function AnimatedScore({ score, animated = true }: { score: Score; animated?: boolean }) {
  return (
    <p className="figures flex items-baseline leading-none text-creme">
      <span className="sr-only">
        Score : {score.value} sur 100
      </span>
      <span
        aria-hidden
        className="score-count text-[7rem] leading-[0.8] sm:text-[9rem]"
        style={{ "--score-target": score.value, ...(animated ? {} : { animation: "none" }) } as CSSProperties}
      />
      <span aria-hidden className="text-4xl">
        /100
      </span>
    </p>
  );
}

// Jauge en cinq segments aux bornes de bandFor(). La part remplie prend la
// couleur de la bande du score ; les segments se remplissent l'un après
// l'autre, au même rythme linéaire que le chiffre.
export function ScoreGauge({ score, animated = true }: { score: Score; animated?: boolean }) {
  const fill = BAND_STYLE[score.band].onMarque;
  return (
    <div aria-hidden className="flex h-3 w-full gap-1.5">
      {BAND_SEGMENTS.map((segment, index) => {
        const to = BAND_SEGMENTS[index + 1]?.from ?? 100;
        const share = Math.max(0, Math.min(1, (score.value - segment.from) / (to - segment.from)));
        const reached = score.value > segment.from ? Math.min(score.value, to) - segment.from : 0;
        const style: CSSProperties =
          score.value > 0 && animated
            ? {
                width: `${share * 100}%`,
                animationDelay: `${Math.round((segment.from / score.value) * SCORE_ANIMATION_MS)}ms`,
                animationDuration: `${Math.round((reached / score.value) * SCORE_ANIMATION_MS)}ms`,
              }
            : { width: `${share * 100}%`, animation: "none" };
        return (
          <span
            key={segment.band}
            className="flex h-full overflow-hidden rounded-pill bg-creme/25"
            style={{ flexGrow: to - segment.from, flexBasis: 0 }}
          >
            {share > 0 ? <span className={cn("gauge-fill h-full", fill)} style={style} /> : null}
          </span>
        );
      })}
    </div>
  );
}
