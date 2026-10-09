import { verdictSentence } from "@/lib/analysis/verdict";
import type { ResultView } from "@/lib/analysis/lock";
import { BAND_LABEL, BAND_STYLE, EVALUABILITY_LABEL, priceCapNote, QUANTITY_CAP_NOTE } from "@/lib/display";
import { appliedPriceCap, hasUnknownQuantity, scoreHonoursPriceCap } from "@/lib/rates/score";
import { TIER_LABEL } from "@/lib/rates/tier";
import type { Analysis } from "@/lib/schema";
import { cn } from "@/lib/utils";

type Score = NonNullable<Analysis["score"]>;

// Bandeau de verdict, posé sur la surface bleue de l'en-tête des résultats.
// Ordre de lecture sur mobile : phrase de verdict, puis pastille. Sur grand
// écran : pastille à gauche, phrase à droite.
//
// ─── Mission #174 — LA NOTE SUR 100 N'EST PLUS AFFICHÉE ────────────────────
//
// Elle est toujours CALCULÉE et ENREGISTRÉE : ni le moteur, ni le schéma, ni
// ce qui est écrit en base ne changent. C'est une décision d'affichage, et
// elle est réversible.
//
// Pourquoi : la note et la bande pouvaient nommer deux choses opposées. Une
// offre à 400 € sous un plancher de 610 € portait « Faible » à côté de
// 58/100, et 58 est dans la tranche que l'échelle appelle « correct »
// (mesuré en #172 ; tests/note-contre-bande.test.ts garde le constat). La
// note se lit en premier : entre les deux, c'est elle qu'on croit.
//
// Retiré POUR TOUS LES DEALS, pas seulement ceux qui se contredisent : un
// affichage conditionnel ferait changer la page de forme sans raison visible.
//
// Ce que la zone occupait, mesuré sur /dev/resultat le 10/10 : 179 px de
// haut (nombre 115, jauge 12, note de niveau 20, deux écarts de 16). Il en
// reste 76. Les 103 px rendus font remonter la phrase de verdict et la
// section « Ce que ça vaut » — qui passe au-dessus de la ligne de flottaison
// sur un iPhone de 664 px. La pastille reprend sa ligne entière et cesse de
// s'enrouler à 375 px.
//
// showTier : rappelle le niveau de calcul, dont dépend la phrase, avec un
// lien vers le sélecteur (#niveau, page de résultat).
export function ScoreBand({
  analysis,
  className,
  showTier = false,
}: {
  analysis: ResultView;
  className?: string;
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
            <VerdictPill band={analysis.score.band} />
          </div>
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
    <span className={cn("headline rounded-pill px-4 py-1.5 text-lg text-encre max-[374px]:px-3 sm:text-xl", BAND_STYLE[band].onMarque)}>
      {BAND_LABEL[band]}
    </span>
  );
}
