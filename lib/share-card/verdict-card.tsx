import type { ReactElement } from "react";
import { STATIC_PALETTE } from "@/lib/design/static-palette";
import { formatEur, formatEurRange } from "@/lib/money";
import { comparedAmount } from "@/lib/rates/score";
import { formatNumber } from "@/lib/display";
import { HOME_ZONE, reachesWorld, ZONE_LABEL } from "@/lib/rates/zones";
import { AVANCES_FOURCHETTE, AVANCES_OFFRE, tailleQuiTient } from "@/lib/share-card/mesure-texte";
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
const { creme, encre, attenue, marque, bandOnMarque, surMarque } = STATIC_PALETTE;

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
  /**
   * Mission #168 — le montant vient d'un message d'ACCEPTATION, pas d'un
   * accord ferme : la marque a annoncé « jusqu'à 900 € » et la créatrice
   * s'apprête à l'accepter. La carte le dit, parce qu'elle est faite pour
   * être postée et qu'elle ne doit pas laisser croire à un accord conclu.
   * Nuance reprise telle quelle de la carte de #064.
   */
  plafond: boolean;
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
  // ─── LE TERRITOIRE (mission #167) ────────────────────────────────────────
  //
  // Une zone retenue = un élément de la ligne, avec le libellé de la table
  // (lib/rates/zones.ts). Plus d'énumération de pays, plus de virgules à
  // l'intérieur d'un élément : « France · Europe francophone · Amérique du
  // Nord ».
  //
  // LA FRANCE N'EST PLUS RETIRÉE. Elle l'était parce que sa majoration vaut
  // zéro — mais ce qui ne se facture pas peut très bien avoir été demandé, et
  // une offre « France, Belgique, Suisse » affichait « Belgique, Suisse,
  // Luxembourg » : une zone demandée disparaissait de l'écran.
  //
  // Une zone absente de l'offre n'apparaît jamais : `data.zones` ne contient
  // que ce que le modèle a extrait, filtré par la liste fermée.
  //
  // Toutes les zones retenues : « monde entier », d'un bloc. C'est la règle
  // du chiffrage (reachesWorld), donc deux façons de dire la même chose et
  // jamais deux vérités — et c'est aussi ce qui garde la ligne courte, la
  // liste complète débordant des marges de la carte (mesuré en #165).
  const facturables = data.zones.filter((zone) => zone !== HOME_ZONE);
  if (data.zones.length > 0) {
    if (reachesWorld(facturables)) parts.push("monde entier");
    else for (const zone of data.zones) {
      const label = ZONE_LABEL[zone];
      if (label) parts.push(label);
    }
  }
  return parts.length > 0 ? plain(parts.join(" · ")) : null;
}

export type VerdictCardTexts = {
  /** « On m'a proposé », ou « On m'a proposé jusqu'à » quand c'est un plafond. */
  proposeLabel: string;
  propose: string | null;
  /** « à confirmer », sous le montant, quand c'est un plafond. null sinon. */
  aConfirmer: string | null;
  vaut: string | null;
  verdict: string | null;
  offre: string | null;
  /** La seule mention technique de la carte. */
  bareme: string;
};

export function verdictCardTexts(data: VerdictCardData): VerdictCardTexts {
  // Mission #167 — LE MÊME NOMBRE QUE CELUI QUI AFFRONTE LA FOURCHETTE.
  // `comparedAmount` décide une fois pour toutes lequel des deux compte, et
  // c'est lui qu'on affiche : sans ça la carte annoncerait un montant et
  // jugerait l'autre.
  const compare = comparedAmount(data.propose, data.produits);
  const propose =
    compare === null ? null : `${formatEur(compare)}${data.propose === null ? " en produits" : ""}`;
  const range = formatEurRange(data.bas, data.haut);
  // Mission #168 — « On m'a proposé jusqu'à 900 €, à confirmer » : la phrase
  // de #064, répartie sur les trois niveaux de la bande haute pour que le
  // montant reste le montant. Aucun mot n'est perdu.
  // ─── Mission #170 — LE NIVEAU DE CALCUL NE FIGURE PLUS ICI ──────────────
  //
  // Il y était depuis la #168, au nom de la #039 : une fourchette sans son
  // niveau ne correspond à rien de vérifiable. C'est vrai sur la page de
  // résultat, où la #039 reste en vigueur — et faux sur une image publique.
  //
  // Le niveau est écrit à la première personne (« Je débute », « C'est mon
  // métier ») : sur une carte postée en story, ce n'est pas une information
  // sur le deal, c'est une information sur la créatrice, et elle joue contre
  // elle. Une marque qui lit « Je débute » sous une fourchette sait quoi en
  // faire.
  //
  // Il ne reste donc que le barème, qui dit quelle table a produit ces
  // chiffres et ne dit rien de personne.
  return {
    proposeLabel: data.plafond ? "On m'a proposé jusqu'à" : "On m'a proposé",
    propose: propose ? plain(propose) : null,
    aConfirmer: data.plafond ? "à confirmer" : null,
    vaut: range ? plain(range) : null,
    verdict: data.bande ? VERDICT_UN_MOT[data.bande] : null,
    offre: offerLine(data),
    bareme: `barème ${data.bareme}`,
  };
}

// ─── LA MISE EN PAGE (mission #168) ─────────────────────────────────────────
//
// Avant : deux montants de même poids sur un fond uniforme — un reçu. Une
// carte qui ne donne pas envie d'être postée ne sert à rien.
//
// Maintenant, deux temps et une seule chose qui domine :
//   - une bande haute crème de 420 px, où « on m'a proposé » est dit en petit
//     et le montant en 90 px. C'est VOLONTAIREMENT le second rôle ;
//   - un champ bleu à fond perdu sur tout le reste, où la fourchette fait
//     150 px. C'est l'élément dominant, et c'est le sujet de la carte.
//
// LE CHAMP BLEU NE CHANGE JAMAIS DE COULEUR SELON LE VERDICT. C'est la
// pastille qui porte l'état, et elle seule : les trois cas — sous-évalué,
// correct, sur-évalué — partagent une seule identité visuelle. Une carte dont
// le fond vire au rouge est une carte qu'on ne poste pas.
//
// La marque reste discrète : « negoscore.fr » en pied, dans le bleu, et le
// barème à 50 % d'opacité à côté. Une carte qui a l'air d'une publicité ne se
// partage pas.

export const CARTE_MARGE = 90;
const LARGEUR_UTILE = VERDICT_CARD_SIZE.width - 2 * CARTE_MARGE;
const HAUTEUR_BANDE = 420;

// LA FOURCHETTE NE PASSE JAMAIS SUR DEUX LIGNES. Elle est le sujet de la
// carte ; coupée en deux elle cesse de se lire d'un coup d'œil, et elle
// pousse le pied de page vers le bas. La taille descend donc par paliers
// jusqu'à tenir dans les 900 px utiles.
//
// À 150 px, « 610 € – 1 310 € » tient (837 px mesurés). « 2 700 € – 5 280 € »
// déborderait (1 047 px) et descend à 116. Les paliers sont choisis pour que
// la fourchette reste dominante même au plus bas : 90 px est encore la
// moitié plus grand que le montant proposé.
export const TAILLES_FOURCHETTE = [150, 132, 116, 102, 90] as const;
export function tailleFourchette(texte: string): number {
  return tailleQuiTient(texte, AVANCES_FOURCHETTE, TAILLES_FOURCHETTE, LARGEUR_UTILE);
}

// LA LIGNE D'OFFRE TIENT SUR DEUX LIGNES AU PLUS, et aucun élément n'en est
// retiré pour y arriver : c'est la taille qui descend. Retirer une zone ou un
// livrable ferait mentir la carte par omission — exactement ce que la #167
// vient de corriger sur le territoire.
export const TAILLES_OFFRE = [34, 31, 28, 26] as const;
export function tailleOffre(texte: string): number {
  return tailleQuiTient(texte, AVANCES_OFFRE, TAILLES_OFFRE, LARGEUR_UTILE, 2, 0.92);
}

const BLANC_60 = surMarque.attenue;
const BLANC_50 = surMarque.discret;

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
        background: marque,
        fontFamily: "Familjen Grotesk",
      }}
    >
      {/* ─── La bande haute : crème, le montant proposé, en second rôle ─── */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          height: HAUTEUR_BANDE,
          padding: `0 ${CARTE_MARGE}px`,
          background: creme,
        }}
      >
        <div style={{ display: "flex", fontSize: 34, fontWeight: 600, color: attenue, letterSpacing: "0.1em" }}>
          {t.proposeLabel}
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 14,
            fontFamily: "Bricolage Grotesque",
            fontWeight: 800,
            fontSize: 90,
            letterSpacing: "-0.03em",
            color: encre,
          }}
        >
          {t.propose ?? ""}
        </div>
        {t.aConfirmer ? (
          <div style={{ display: "flex", marginTop: 10, fontSize: 30, fontWeight: 600, color: attenue }}>{t.aConfirmer}</div>
        ) : null}
      </div>

      {/* ─── Le champ bleu : la fourchette, et c'est elle qu'on retient ─── */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flexGrow: 1,
          // Pas de marge haute : le groupe est centré dans la hauteur
          // disponible, et une marge en haut seulement le décalerait vers le
          // bas. Les 90 px du bas tiennent le pied de page, et la zone morte
          // de 60 px reste intacte.
          padding: `0 ${CARTE_MARGE}px ${CARTE_MARGE}px`,
          color: surMarque.plein,
        }}
      >
        {/* Mission #170 — LE GROUPE EST CENTRÉ dans la hauteur disponible.
            Avant, il commençait en haut du champ bleu et le pied de page
            était collé en bas : il restait environ 260 px de bleu vide au
            milieu, sur les cinq rendus. Le pied reste ancré en bas, le reste
            se centre — et ça tient avec une ligne d'offre comme avec deux. */}
        <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, justifyContent: "center" }}>
          <div style={{ display: "flex", fontSize: 34, fontWeight: 600, color: BLANC_60, letterSpacing: "0.1em" }}>Ça en vaut</div>
          <div
            style={{
              display: "flex",
              marginTop: 12,
              fontFamily: "Bricolage Grotesque",
              fontWeight: 800,
              fontSize: tailleFourchette(t.vaut ?? ""),
              lineHeight: 1,
              letterSpacing: "-0.04em",
            }}
          >
            {t.vaut ?? ""}
          </div>

          {t.verdict ? (
            <div style={{ display: "flex", marginTop: 40 }}>
              <div
                style={{
                  display: "flex",
                  padding: "14px 44px",
                  borderRadius: 999,
                  background: pastille,
                  color: encre,
                  fontFamily: "Bricolage Grotesque",
                  fontWeight: 800,
                  fontSize: 56,
                  letterSpacing: "-0.02em",
                }}
              >
                {t.verdict}
              </div>
            </div>
          ) : null}

          {t.offre ? (
            <div
              style={{
                display: "flex",
                marginTop: 36,
                fontSize: tailleOffre(t.offre),
                fontWeight: 600,
                color: BLANC_60,
                lineHeight: 1.3,
              }}
            >
              {t.offre}
            </div>
          ) : null}
        </div>

        <div style={{ display: "flex", alignItems: "baseline" }}>
          <div style={{ display: "flex", fontSize: 40, fontWeight: 600 }}>{VERDICT_CARD_SITE}</div>
          <div style={{ display: "flex", marginLeft: 22, fontSize: 26, fontWeight: 600, color: BLANC_50 }}>{t.bareme}</div>
        </div>
      </div>
    </div>
  );
}
