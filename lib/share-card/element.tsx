import type { ReactElement } from "react";
import type { ResultView } from "@/lib/analysis/lock";
import { LogoMark } from "@/components/brand/logo";
import { STATIC_PALETTE } from "@/lib/design/static-palette";
import { BAND_LABEL, deliverablesLine, EVALUABILITY_LABEL } from "@/lib/display";
import { formatEur, formatEurRange } from "@/lib/money";
import { TIER_LABEL } from "@/lib/rates/tier";

// Carte partageable (1080 × 1920), rendue par next/og. Contenu fermé : le signe
// et « negoscore.fr », le score, la pastille de verdict, la jauge, « Elle
// propose X € / Ça vaut Y – Z € », le niveau de calcul et une ligne de livrables.
// Le niveau y figure toujours (mission #039) : sans lui, la fourchette et le score
// ne correspondent à rien de vérifiable. Il nomme un niveau, jamais une personne.
// JAMAIS : le nom de la marque, un nom ou un email de personne, un texte
// recopié de l'offre (vérifié par tests/share-card.test.tsx).
//
// Sans grain : un bruit rend chaque pixel différent et le PNG incompressible
// (1,59 Mo avec le grain du site, 937 Ko encore avec un grain 10 fois plus
// grossier, mesuré le 17/09/2026). Une image enregistrée et postée depuis un
// téléphone doit rester légère ; la marque se reconnaît au bleu et à la mise en
// page. Le grain reste sur les surfaces bleues du site.

export const SHARE_CARD_SIZE = { width: 1080, height: 1920 } as const;
export const SHARE_CARD_SITE = "negoscore.fr";
export { SHARE_CARD_FILENAME } from "@/lib/share-card/filename";

const { marque, marqueDeep, creme, encre, bandOnMarque } = STATIC_PALETTE;

// Espaces insécables du formateur (U+202F) remplacés par l'insécable simple,
// présente dans les polices embarquées.
function plain(text: string): string {
  return text.replace(/\u202f/g, "\u00a0");
}

// Pas de carte vide : seulement une offre chiffrée (montant proposé ou produits)
// face à une fourchette. Ni « unpriced » (aucun montant à comparer), ni
// « incomplete » (aucune fourchette). Le bouton disparaît dans ces cas.
export function shareCardAvailable(analysis: ResultView, offered: number | null = null): boolean {
  const { deal, estimate, evaluability } = analysis;
  const proposed = offered !== null || deal.payment.amount_eur !== null || deal.in_kind_value_eur !== null;
  return (
    (evaluability === "complete" || evaluability === "terms_unknown") &&
    proposed &&
    estimate.total_low !== null &&
    estimate.total_high !== null
  );
}

export type ShareCardTexts = {
  pill: string;
  score: string | null;
  proposes: string | null;
  worth: string | null;
  tier: string;
  deliverables: string | null;
};

// Tous les textes de la carte, et rien d'autre : c'est ce que le test vérifie.
//
// Mission #100, point 4 — la carte affichait « Elle propose 600 € », le dernier
// montant FERME retenu dans les termes, pendant que l'écran de conclusion
// portait les 900 € annoncés au tour 3. Même règle que l'acceptation
// (mission #096, offeredAmount) : le plus élevé des deux. Et la carte dit d'où
// il vient — elle est faite pour être postée, elle ne doit pas laisser croire
// à un accord qui n'existe pas.
export function shareCardTexts(analysis: ResultView, offered: number | null = null): ShareCardTexts {
  const { deal, estimate, score } = analysis;
  const scored = analysis.evaluability === "complete" && score !== null;
  const pill = scored ? BAND_LABEL[score.band] : EVALUABILITY_LABEL[analysis.evaluability === "complete" ? "terms_unknown" : analysis.evaluability];
  const amount = deal.payment.amount_eur;
  const proposes =
    offered !== null
      ? `Elle propose jusqu'à ${formatEur(offered)}, à confirmer`
      : amount !== null
        ? `Elle propose ${formatEur(amount)}`
        : deal.in_kind_value_eur !== null
          ? `Elle propose ${formatEur(deal.in_kind_value_eur)} en produits`
          : null;
  const range = formatEurRange(estimate.total_low, estimate.total_high);
  return {
    pill,
    score: scored ? String(score.value) : null,
    proposes: proposes ? plain(proposes) : null,
    worth: range ? plain(`Ça vaut ${range}`) : null,
    tier: `Niveau : ${TIER_LABEL[analysis.profile_tier].short}`,
    deliverables: deliverablesLine(deal),
  };
}

const GAUGE_WIDTH = 936;
const GAUGE_HEIGHT = 36;
const MARKER_WIDTH = 12;
const MARKER_HEIGHT = 68;

// Même règle que la jauge du site : barre continue sur bleu foncé, remplie
// jusqu'au score, repère crème à la valeur.
function Gauge({ value, color }: { value: number; color: string }) {
  const clamped = Math.max(0, Math.min(100, value));
  const fill = Math.round((GAUGE_WIDTH * clamped) / 100);
  return (
    <div style={{ display: "flex", position: "relative", width: GAUGE_WIDTH, height: MARKER_HEIGHT, alignItems: "center" }}>
      <div style={{ display: "flex", width: GAUGE_WIDTH, height: GAUGE_HEIGHT, borderRadius: GAUGE_HEIGHT / 2, background: marqueDeep, overflow: "hidden" }}>
        <div style={{ display: "flex", width: fill, height: GAUGE_HEIGHT, borderRadius: GAUGE_HEIGHT / 2, background: color }} />
      </div>
      <div
        style={{
          position: "absolute",
          top: 0,
          // Centré sur la valeur, retenu dans la piste à 0 et à 100.
          left: Math.max(0, Math.min(GAUGE_WIDTH - MARKER_WIDTH, fill - MARKER_WIDTH / 2)),
          width: MARKER_WIDTH,
          height: MARKER_HEIGHT,
          borderRadius: MARKER_WIDTH / 2,
          background: creme,
        }}
      />
    </div>
  );
}

export function shareCardElement(analysis: ResultView, offered: number | null = null): ReactElement {
  const texts = shareCardTexts(analysis, offered);
  const band = analysis.evaluability === "complete" && analysis.score ? analysis.score.band : null;
  const pillColor = band ? bandOnMarque[band] : creme;
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        width: SHARE_CARD_SIZE.width,
        height: SHARE_CARD_SIZE.height,
        padding: "110px 72px 120px",
        background: marque,
        color: creme,
        fontFamily: "Familjen Grotesk",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        <LogoMark size={80} variant="creme" colors="static" />
        <div style={{ display: "flex", fontSize: 46, fontWeight: 600 }}>{SHARE_CARD_SITE}</div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, justifyContent: "center", gap: 56 }}>
        {texts.score !== null ? (
          <div style={{ display: "flex", alignItems: "baseline", fontFamily: "Bricolage Grotesque", fontWeight: 800, letterSpacing: "-0.05em" }}>
            <div style={{ display: "flex", fontSize: 440, lineHeight: 0.85 }}>{texts.score}</div>
            <div style={{ display: "flex", fontSize: 120 }}>/100</div>
          </div>
        ) : null}
        <div style={{ display: "flex" }}>
          <div
            style={{
              display: "flex",
              padding: "18px 44px",
              borderRadius: 999,
              background: pillColor,
              color: encre,
              fontFamily: "Bricolage Grotesque",
              fontWeight: 800,
              fontSize: 76,
              letterSpacing: "-0.03em",
            }}
          >
            {texts.pill}
          </div>
        </div>
        {band && analysis.score ? <Gauge value={analysis.score.value} color={bandOnMarque[band]} /> : null}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, fontFamily: "Bricolage Grotesque", fontWeight: 800, fontSize: 84, letterSpacing: "-0.02em", lineHeight: 1.08 }}>
          {texts.proposes ? <div style={{ display: "flex" }}>{texts.proposes}</div> : null}
          {texts.worth ? <div style={{ display: "flex" }}>{texts.worth}</div> : null}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12, fontSize: 50, fontWeight: 600 }}>
        <div style={{ display: "flex" }}>{texts.tier}</div>
        {texts.deliverables ? <div style={{ display: "flex" }}>{texts.deliverables}</div> : null}
      </div>
    </div>
  );
}
