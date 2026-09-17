import type { ReactNode } from "react";
import { BAND_LABEL, BAND_SEGMENTS, BAND_STYLE, CONFIDENCE_LABEL } from "@/lib/display";
import type { Analysis } from "@/lib/schema";
import { cn } from "@/lib/utils";

type Score = NonNullable<Analysis["score"]>;

type ScoreCardProps = {
  score: Score;
  confidence: Analysis["confidence"];
  // Contenu ajouté sous le score, dans la même carte (exemple de la page d'accueil).
  children?: ReactNode;
};

// La carte de score est la seule zone du site sur papier élevé, cernée de la
// couleur de sa bande : c'est le produit.
export function ScoreCard({ score, confidence, children }: ScoreCardProps) {
  const style = BAND_STYLE[score.band];
  return (
    <section aria-label="Score du deal" className={cn("flex flex-col border bg-papier-eleve", style.border)}>
      <div className="flex flex-col gap-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <p className={cn("figures flex items-baseline tracking-tight", style.text)}>
            <span className="text-8xl leading-[0.85]">{score.value}</span>
            <span className="text-3xl">/100</span>
          </p>
          {/* Pas de cn() ici : tailwind-merge prendrait la taille text-verdict pour une
              couleur et la retirerait au profit de la couleur de bande. */}
          <p className={`verdict pb-1 text-verdict ${style.text}`}>{BAND_LABEL[score.band]}</p>
        </div>
        <ScoreGauge score={score} />
        <p className="text-small text-attenue">{CONFIDENCE_LABEL[confidence]}</p>
      </div>
      {children}
    </section>
  );
}

// Jauge : les cinq bandes en filet, celle du score en couleur, un repère encre
// à la valeur. Décorative : la valeur et la bande sont écrites juste au-dessus.
export function ScoreGauge({ score }: { score: Score }) {
  return (
    <div aria-hidden className="relative pt-2">
      <div className="flex h-2 gap-0.5">
        {BAND_SEGMENTS.map((segment, index) => {
          const to = BAND_SEGMENTS[index + 1]?.from ?? 100;
          return (
            <span
              key={segment.band}
              className={segment.band === score.band ? BAND_STYLE[segment.band].accent : "bg-filet"}
              style={{ flexGrow: to - segment.from, flexBasis: 0 }}
            />
          );
        })}
      </div>
      <span className="absolute top-0 h-4 w-0.5 -translate-x-1/2 bg-encre" style={{ left: `${score.value}%` }} />
    </div>
  );
}
