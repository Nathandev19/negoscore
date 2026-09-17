import type { CSSProperties } from "react";
import { verdictSentence } from "@/lib/analysis/verdict";
import type { ResultView } from "@/lib/analysis/lock";
import { BAND_LABEL, BAND_STYLE, EVALUABILITY_LABEL, QUANTITY_CAP_NOTE } from "@/lib/display";
import { hasUnknownQuantity } from "@/lib/rates/score";
import { TIER_LABEL } from "@/lib/rates/tier";
import type { Analysis } from "@/lib/schema";
import { cn } from "@/lib/utils";

type Score = NonNullable<Analysis["score"]>;

// Bandeau de verdict, posé sur la surface bleue de l'en-tête des résultats.
// Ordre de lecture sur mobile : phrase de verdict, puis score, pastille et
// jauge. Sur grand écran : score, pastille et jauge à gauche, phrase à droite.
// animated : remplissage à l'arrivée (page de résultat). L'exemple de la page
// d'accueil est affiché directement à sa valeur.
// showTier : rappelle le niveau de calcul, dont dépendent le score et la phrase,
// avec un lien vers le sélecteur (#niveau, page de résultat).
export function ScoreBand({
  analysis,
  className,
  animated = true,
  showTier = false,
}: {
  analysis: ResultView;
  className?: string;
  animated?: boolean;
  showTier?: boolean;
}) {
  const tierNote = showTier ? <TierNote tier={analysis.profile_tier} /> : null;
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
          {hasUnknownQuantity(analysis.deal) ? (
            <p data-score-cap className="measure text-small font-semibold text-creme">
              {QUANTITY_CAP_NOTE}
            </p>
          ) : null}
          {tierNote}
        </div>
      ) : (
        <div className="flex flex-col items-start gap-4">
          <span className="headline rounded-pill bg-creme px-4 py-1.5 text-lg text-encre">
            {EVALUABILITY_LABEL[analysis.evaluability === "complete" ? "terms_unknown" : analysis.evaluability]}
          </span>
          {tierNote}
        </div>
      )}
    </div>
  );
}

function TierNote({ tier }: { tier: ResultView["profile_tier"] }) {
  return (
    <p data-tier-note className="text-small text-creme">
      Calculé pour le niveau « {TIER_LABEL[tier].short} ».{" "}
      <a href="#niveau" className="font-semibold underline underline-offset-2">
        Changer
      </a>
    </p>
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

// Jauge : une barre continue de 0 à 100, remplie jusqu'au score dans la couleur
// de sa bande, avec un repère crème à la valeur. Une seule règle de lecture :
// la position dit le score. L'ancienne jauge en cinq segments proportionnels aux
// bandes (30, 20, 20, 15, 15 points) montrait des morceaux de largeurs
// différentes et des segments à moitié remplis, qui ne voulaient rien dire.
// Piste en bleu foncé : le remplissage s'en détache à 3:1 au moins, quelle que
// soit la bande (tests/design.test.ts). Le remplissage et le repère avancent au
// même rythme linéaire que le chiffre.
// Demi-largeur du repère (w-1 = 4 px). Le centre du repère tombe sur la valeur,
// sauf aux extrêmes où il est retenu à 2 px du bord : le repère reste dans la
// piste à 0 et à 100 au lieu d'en dépasser. Entre les deux (dès 1 sur une barre
// de plus de 200 px), la position n'est pas modifiée.
const MARKER_HALF_PX = 2;

export function markerLeft(value: number): string {
  return `clamp(${MARKER_HALF_PX}px, ${value}%, calc(100% - ${MARKER_HALF_PX}px))`;
}

export function ScoreGauge({ score, animated = true }: { score: Score; animated?: boolean }) {
  const value = Math.max(0, Math.min(100, score.value));
  const still: CSSProperties = animated ? {} : { animation: "none" };
  return (
    <div aria-hidden data-gauge={value} className="relative h-3 w-full rounded-pill bg-marque-deep">
      <span
        data-gauge-fill
        className={cn("gauge-grow absolute inset-y-0 left-0 rounded-pill", BAND_STYLE[score.band].onMarque)}
        style={{ width: `${value}%`, ...still }}
      />
      <span
        data-gauge-marker
        className="gauge-marker absolute -top-1.5 h-6 w-1 -translate-x-1/2 rounded-pill bg-creme"
        style={{ left: markerLeft(value), ...still }}
      />
    </div>
  );
}
