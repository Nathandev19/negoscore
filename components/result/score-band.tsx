import type { CSSProperties } from "react";
import { verdictSentence } from "@/lib/analysis/verdict";
import type { ResultView } from "@/lib/analysis/lock";
import { BAND_LABEL, BAND_STYLE, EVALUABILITY_LABEL, priceCapNote, QUANTITY_CAP_NOTE } from "@/lib/display";
import { appliedPriceCap, hasUnknownQuantity, scoreHonoursPriceCap } from "@/lib/rates/score";
import { TIER_LABEL } from "@/lib/rates/tier";
import type { Analysis } from "@/lib/schema";
import { cn } from "@/lib/utils";

type Score = NonNullable<Analysis["score"]>;

// Bandeau de verdict, posé sur la surface bleue de l'en-tête des résultats.
// Ordre de lecture sur mobile : phrase de verdict, puis score, pastille et
// jauge. Sur grand écran : score, pastille et jauge à gauche, phrase à droite.
// animated : remplissage à l'arrivée (page de résultat). L'exemple de la page
// d'accueil est affiché directement à sa valeur.
// from : score affiché juste avant (changement de niveau) ; l'animation part de
// là au lieu de 0. Rejouée parce que le parent remonte le bandeau (key).
// showTier : rappelle le niveau de calcul, dont dépendent le score et la phrase,
// avec un lien vers le sélecteur (#niveau, page de résultat).
export function ScoreBand({
  analysis,
  className,
  animated = true,
  from = null,
  showTier = false,
}: {
  analysis: ResultView;
  className?: string;
  animated?: boolean;
  from?: number | null;
  showTier?: boolean;
}) {
  const tierNote = showTier ? <TierNote tier={analysis.profile_tier} /> : null;
  const scored = analysis.evaluability === "complete" && analysis.score !== null;
  // Une analyse enregistrée avant la mission #050 garde le score calculé sans
  // plafond : la phrase serait alors affichée à côté d'un score qui la
  // contredit. Elle n'apparaît donc que si le score montré respecte le plafond.
  // Mission #113, B — un seul endroit décide si le score montré et le plafond
  // d'aujourd'hui sont d'accord (lib/rates/score.ts). La note de plafond et la
  // phrase de verdict s'y réfèrent toutes les deux : elles ne peuvent plus
  // diverger l'une de l'autre.
  const capState = appliedPriceCap(analysis.deal, analysis.estimate);
  const priceCap = capState && scoreHonoursPriceCap(analysis.deal, analysis.estimate, analysis.score) ? capState : null;
  return (
    <div className={cn("grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-center lg:gap-12", className)}>
      <p className="headline text-verdict text-balance text-creme lg:order-last">{verdictSentence(analysis)}</p>
      {scored && analysis.score ? (
        <div data-score-block className="flex flex-col gap-4">
          {/* Mission #150 — cette ligne ne s'enroule plus à partir de 360 px.
              Mesuré en #148 : le compteur passe de 64 à 129 px quand il franchit
              9 → 10, soit 64 px de largeur en plus d'un coup. À 375 px il ne
              restait que 2 px de marge : la pastille basculait à la ligne par
              moments, ce qui ajoute 64 px de hauteur et fait repasser le bouton
              « Analyser mon offre » sous la ligne de flottaison dans le
              navigateur d'Instagram.
              Deux gestes, et deux seulement : la largeur finale du compteur est
              RÉSERVÉE dès le premier rendu (--score-chiffres, voir plus bas et
              globals.css), donc plus rien ne bouge pendant l'animation ; et la
              ligne ne s'enroule plus dès 360 px, la pastille se comprimant si
              besoin. Elle ne peut pas déborder pour autant : un élément flex ne
              se réduit jamais sous sa largeur minimale de contenu, mesurée à
              78 px. Sous 360 px l'enroulement reste autorisé — c'est la seule
              issue, et 320 px est déjà hors critère.
              L'écart horizontal passe de 20 à 16 px sur mobile : à 375 px il
              manquait exactement 1 px pour que la pastille tienne sur une
              ligne, et ces 4 px la lui rendent. Au-delà de 640 px, où la place
              n'a jamais manqué, il reste à 20 px.

              Mission #163 — ET LA BANDE 360–374 px EST RÉPARÉE.
              #150 l'avait assumée : la ligne ne s'enroulait plus, mais la
              PASTILLE se comprimait et c'était son libellé qui passait sur
              deux lignes. Mesuré à l'état stabilisé, cinq relevés identiques :
                 360 px → 105 px disponibles, 117 px nécessaires, hauteur 68 px
                 365 px → 110 px disponibles, 117 px nécessaires, hauteur 68 px
                 374 px → 117 px disponibles, hauteur 40 px — ça passe
              Il manquait donc 12 px à 360 px. Le compteur n'en a aucun à
              céder : il est déjà à sa largeur minimale de contenu (207 px à
              toutes les largeurs, et il ne se comprime pas). On les prend
              UNIQUEMENT sous 375 px, et uniquement sur de l'espace vide :
              8 px sur l'écart (16 → 8) et 8 px sur les côtés de la pastille
              (16 → 12, voir VerdictPill). Seize px rendus pour douze
              nécessaires : quatre de marge, parce qu'une mesure exacte au
              pixel près est une mesure qui recasse au prochain libellé.
              Ni le score ni la phrase de verdict ne bougent d'un pixel. */}
          <div className="flex flex-wrap items-end gap-x-4 gap-y-3 max-[374px]:gap-x-2 min-[360px]:flex-nowrap sm:gap-x-5">
            <AnimatedScore score={analysis.score} animated={animated} from={from} />
            <VerdictPill band={analysis.score.band} />
          </div>
          <ScoreGauge score={analysis.score} animated={animated} from={from} />
          {hasUnknownQuantity(analysis.deal) ? (
            <p data-score-cap className="measure text-small font-semibold text-creme">
              {QUANTITY_CAP_NOTE}
            </p>
          ) : null}
          {/* Plafond par le prix (mission #050) : affiché seulement quand il a
              vraiment fait baisser la note, avec la part réellement payée. */}
          {priceCap ? (
            <p data-price-cap className="measure text-small font-semibold text-creme">
              {priceCapNote(priceCap.percent, priceCap.reason)}
            </p>
          ) : null}
          {tierNote}
        </div>
      ) : (
        <div data-score-block className="flex flex-col items-start gap-4">
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

// Mission #163 — `max-[374px]:px-3` : quatre pixels de chaque côté, rendus au
// libellé sur la seule bande où il n'en avait pas assez. Au-dessus de 374 px
// la pastille est inchangée, et sa taille de texte ne bouge jamais : c'est le
// verdict, on ne le rétrécit pas pour faire entrer la mise en page.
export function VerdictPill({ band }: { band: Score["band"] }) {
  return (
    <span className={cn("headline mb-3 rounded-pill px-4 py-1.5 text-lg text-encre max-[374px]:px-3 sm:text-xl", BAND_STYLE[band].onMarque)}>
      {BAND_LABEL[band]}
    </span>
  );
}

// Le score monte de 0 à sa valeur, une fois, en même temps que la jauge se
// remplit. Entièrement en CSS (propriété enregistrée + compteur) : rendu
// statique, aucune hydratation, et prefers-reduced-motion affiche directement
// la valeur finale (règle globale de globals.css).
export function AnimatedScore({ score, animated = true, from = null }: { score: Score; animated?: boolean; from?: number | null }) {
  return (
    <p className="figures flex items-baseline leading-none text-creme">
      <span className="sr-only">
        Score : {score.value} sur 100
      </span>
      <span
        aria-hidden
        className="score-count text-[7rem] leading-[0.8] sm:text-[9rem]"
        style={
          {
            "--score-target": score.value,
            ...(from !== null ? { "--score-from": from } : {}),
            ...(animated ? {} : { animation: "none" }),
          } as CSSProperties
        }
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

export function ScoreGauge({ score, animated = true, from = null }: { score: Score; animated?: boolean; from?: number | null }) {
  const value = Math.max(0, Math.min(100, score.value));
  const start = from === null ? null : Math.max(0, Math.min(100, from));
  const still: CSSProperties = animated ? {} : { animation: "none" };
  return (
    <div aria-hidden data-gauge={value} className="relative h-3 w-full rounded-pill bg-marque-deep">
      <span
        data-gauge-fill
        className={cn("gauge-grow absolute inset-y-0 left-0 rounded-pill", BAND_STYLE[score.band].onMarque)}
        style={{ width: `${value}%`, ...(start !== null ? { "--gauge-from": `${start}%` } : {}), ...still } as CSSProperties}
      />
      <span
        data-gauge-marker
        className="gauge-marker absolute -top-1.5 h-6 w-1 -translate-x-1/2 rounded-pill bg-creme"
        style={{ left: markerLeft(value), ...(start !== null ? { "--marker-from": markerLeft(start) } : {}), ...still } as CSSProperties}
      />
    </div>
  );
}
