import type { ReactElement } from "react";
import { STATIC_PALETTE } from "@/lib/design/static-palette";
import { formatEur, formatEurRange } from "@/lib/money";
import { formatNumber } from "@/lib/display";
import { HOME_ZONE, reachesWorld, ZONE_LABEL } from "@/lib/rates/zones";
import type { Analysis } from "@/lib/schema";

// Mission #165 — LA CARTE DE VERDICT, celle qu'on envoie à ses copines.
//
// Distincte de la carte de #064 (1080 × 1920, fond bleu, score et jauge), qui
// reste en place : celle-ci est au format 4:5, sur crème, et met en avant UNE
// chose — l'écart entre ce qu'on propose et ce que ça vaut.
//
// CONTENU FERMÉ, et c'est la règle qui commande tout le fichier : aucun texte
// libre venant du modèle ou de l'offre n'y entre. Pas le nom de la marque, pas
// le `format` d'un livrable (« 30 s, 3 hooks », écrit par le modèle), pas la
// `category` d'une exclusivité, pas le `territory` en toutes lettres. Ce qui
// s'affiche vient de champs TYPÉS — des nombres, des booléens, des clés de
// listes fermées — et de libellés que nous écrivons ici.
// Vérifié par tests/carte-verdict.test.tsx.

export const VERDICT_CARD_SIZE = { width: 1080, height: 1350 } as const;
export const VERDICT_CARD_SITE = "negoscore.fr";
export const VERDICT_CARD_FILENAME = "negoscore-verdict.png";

type Band = NonNullable<Analysis["score"]>["band"];

// Le verdict en UN mot. BAND_LABEL en donne deux (« Deal faible ») : sous une
// fourchette de 200 px de haut, un seul mot porte mieux. Les cinq bandes sont
// couvertes, et le test échoue si une bande n'a pas son mot.
export const VERDICT_UN_MOT: Record<Band, string> = {
  bad: "Mauvais",
  weak: "Faible",
  fair: "Correct",
  good: "Bon",
  excellent: "Excellent",
};

// Une couleur par bande, posée sur la crème. Reprises de la palette statique,
// version « sur crème » : les aplats clairs du bleu ne tiennent pas le
// contraste sur fond clair, on prend donc l'encre pour le texte et la couleur
// seulement en pastille.
const { creme, encre, encreDouce, attenue, marque, bandOnMarque } = STATIC_PALETTE;

// Espaces fines insécables du formateur (U+202F) ramenées à l'insécable
// simple, la seule présente dans les polices embarquées.
function plain(text: string): string {
  return text.replace(/ /g, " ");
}

// ─── Ce que la carte sait d'une analyse ────────────────────────────────────
//
// Volontairement PLAT et typé : c'est exactement ce que la route projette
// depuis la base, et rien de plus. Aucun objet `deal` complet ne traverse ce
// fichier, donc aucun champ libre ne peut s'y glisser par inadvertance.
export type VerdictCardData = {
  /** Montant proposé par la marque, en euros. */
  propose: number | null;
  /** Valeur annoncée des produits offerts, quand il n'y a pas d'argent. */
  produits: number | null;
  bas: number | null;
  haut: number | null;
  bande: Band | null;
  /** Nombre de contenus par type. Le `format` libre n'entre jamais ici. */
  livrables: Array<{ type: "video" | "photo" | "story" | "live"; quantity: number | null }>;
  droitsMois: number | null;
  droitsAVie: boolean;
  exclusivite: boolean;
  exclusiviteMois: number | null;
  /** Clés de la liste fermée de lib/rates/zones.ts, jamais le texte de l'offre. */
  zones: string[];
  /** Version de la table qui a produit ces chiffres. */
  bareme: string;
};

// Pas de carte sans les trois choses qui en font une : un montant proposé, une
// fourchette, et un verdict. Sans l'une des trois il n'y a rien à montrer, et
// la route répond 404 plutôt que de produire une image à moitié vide.
export function verdictCardAvailable(data: VerdictCardData): boolean {
  const propose = data.propose !== null || data.produits !== null;
  return propose && data.bas !== null && data.haut !== null && data.bande !== null;
}

const LIVRABLE: Record<VerdictCardData["livrables"][number]["type"], [string, string]> = {
  video: ["vidéo", "vidéos"],
  photo: ["photo", "photos"],
  story: ["story", "stories"],
  live: ["live", "lives"],
};

const mois = (n: number) => `${formatNumber(n)} mois`;

// La ligne qui décrit l'offre, construite UNIQUEMENT à partir de champs
// structurés : nombre de contenus par type, durée des droits, exclusivité,
// territoire. Chaque morceau est écrit ici ; rien n'est recopié de l'offre.
export function offerLine(data: VerdictCardData): string | null {
  const parts: string[] = [];
  for (const { type, quantity } of data.livrables) {
    const [un, plusieurs] = LIVRABLE[type];
    // Nombre non précisé : le pluriel, jamais un chiffre inventé.
    parts.push(quantity === null ? plusieurs : `${formatNumber(quantity)} ${quantity > 1 ? plusieurs : un}`);
  }
  if (data.droitsAVie) parts.push("droits pub à vie");
  else if (data.droitsMois !== null) parts.push(`${mois(data.droitsMois)} de droits pub`);
  if (data.exclusivite) {
    parts.push(data.exclusiviteMois === null ? "exclusivité" : `exclusivité ${mois(data.exclusiviteMois)}`);
  }
  // Les zones viennent de la liste fermée de la table de tarifs, et leurs
  // libellés sont les nôtres. La France seule ne se dit pas : c'est le
  // territoire par défaut.
  //
  // Et quand les zones atteignent le mondial, on écrit « monde entier »
  // plutôt que de les énumérer : mesuré, la liste complète fait quatre lignes
  // sur la carte et pousse le pied de page hors des marges. C'est la même
  // règle que le moteur applique au chiffrage (lib/rates/zones.ts), donc deux
  // façons de dire la même chose, jamais deux vérités.
  const horsFrance = data.zones.filter((zone) => zone !== HOME_ZONE);
  if (horsFrance.length > 0) {
    parts.push(
      reachesWorld(horsFrance)
        ? "monde entier"
        : horsFrance.map((zone) => ZONE_LABEL[zone]).filter((label): label is string => Boolean(label)).join(", "),
    );
  }
  return parts.length > 0 ? plain(parts.join(" · ")) : null;
}

export type VerdictCardTexts = {
  propose: string | null;
  vaut: string | null;
  verdict: string | null;
  offre: string | null;
  bareme: string;
};

export function verdictCardTexts(data: VerdictCardData): VerdictCardTexts {
  const propose =
    data.propose !== null
      ? formatEur(data.propose)
      : data.produits !== null
        ? `${formatEur(data.produits)} en produits`
        : null;
  const range = formatEurRange(data.bas, data.haut);
  return {
    propose: propose ? plain(propose) : null,
    vaut: range ? plain(range) : null,
    verdict: data.bande ? VERDICT_UN_MOT[data.bande] : null,
    offre: offerLine(data),
    bareme: `barème ${data.bareme}`,
  };
}

// Satori : flexbox uniquement, `display: flex` sur tout conteneur à plusieurs
// enfants, aucune propriété non supportée (pas de grid, pas de gap négatif,
// pas d'ombre).
export function verdictCardElement(data: VerdictCardData): ReactElement {
  const t = verdictCardTexts(data);
  const pastille = data.bande ? bandOnMarque[data.bande] : creme;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: VERDICT_CARD_SIZE.width,
        height: VERDICT_CARD_SIZE.height,
        padding: 100,
        background: creme,
        color: encre,
        fontFamily: "Familjen Grotesk",
      }}
    >
      <div style={{ display: "flex", fontSize: 40, fontWeight: 600, color: marque, letterSpacing: "-0.01em" }}>
        Negoscore
      </div>

      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, justifyContent: "center" }}>
        <div style={{ display: "flex", fontSize: 44, fontWeight: 600, color: attenue }}>On m&apos;a proposé</div>
        <div
          style={{
            display: "flex",
            marginTop: 8,
            fontFamily: "Bricolage Grotesque",
            fontWeight: 800,
            fontSize: 104,
            letterSpacing: "-0.03em",
            color: encreDouce,
          }}
        >
          {t.propose ?? ""}
        </div>

        <div style={{ display: "flex", marginTop: 52, fontSize: 44, fontWeight: 600, color: attenue }}>Ça en vaut</div>
        <div
          style={{
            display: "flex",
            marginTop: 8,
            fontFamily: "Bricolage Grotesque",
            fontWeight: 800,
            // L'élément dominant de la carte. La fourchette la plus longue
            // rendue par le moteur (« 2 700 € – 5 280 € ») tient sur deux
            // lignes à cette taille, dans les 880 px utiles.
            // Mesuré sur rendu : à 148 px, une fourchette à deux lignes
            // (« 2 700 € – 5 280 € ») plus une ligne d'offre longue poussaient
            // le pied de page hors de la marge de 100 px. À 132 elle tient,
            // et reste de loin l'élément dominant de la carte.
            fontSize: 132,
            lineHeight: 1.04,
            letterSpacing: "-0.04em",
          }}
        >
          {t.vaut ?? ""}
        </div>

        {t.verdict ? (
          <div style={{ display: "flex", marginTop: 44 }}>
            <div
              style={{
                display: "flex",
                padding: "16px 48px",
                borderRadius: 999,
                background: pastille,
                color: encre,
                fontFamily: "Bricolage Grotesque",
                fontWeight: 800,
                fontSize: 62,
                letterSpacing: "-0.02em",
              }}
            >
              {t.verdict}
            </div>
          </div>
        ) : null}

        {t.offre ? (
          <div style={{ display: "flex", marginTop: 44, fontSize: 34, fontWeight: 600, color: encreDouce, lineHeight: 1.32 }}>
            {t.offre}
          </div>
        ) : null}
      </div>

      <div style={{ display: "flex", alignItems: "baseline" }}>
        <div style={{ display: "flex", fontSize: 44, fontWeight: 600, color: marque }}>{VERDICT_CARD_SITE}</div>
        <div style={{ display: "flex", marginLeft: 24, fontSize: 28, fontWeight: 600, color: attenue }}>{t.bareme}</div>
      </div>
    </div>
  );
}
