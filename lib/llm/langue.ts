// Mission #210 — DU TEXTE NON LATIN NE DOIT PLUS ATTEINDRE L'ÉCRAN.
//
// Constaté en production le 31/10/2026, sur une analyse réelle. Dans les
// risques affichés à la créatrice :
//
//   « Les contenus sont demandés en échange de produits בלבד, avec une
//     éventuelle rémunération seulement pour une future collaboration. »
//
// בלבד est un mot hébreu qui veut dire « seulement ». L'offre analysée était
// une proposition de gifting en français, sans un seul caractère non latin :
// la fuite vient de la GÉNÉRATION, pas de l'entrée. Le prompt demande déjà
// « Écris en français naturel […] même si l'offre est dans une autre langue »
// (lib/llm/prompt.ts) ; une consigne ne suffit donc pas, et c'est pour ça
// qu'il y a un contrôle ici.
//
// ─── LA RÈGLE : ON COMPARE LA SORTIE À L'ENTRÉE ────────────────────────────
//
// Interdire tout caractère non latin dans la prose serait plus simple, et
// faux : une marque peut s'appeler 株式会社 ou Крафт, et la créatrice peut
// coller une offre dans n'importe quelle langue. Une règle qui casse des cas
// légitimes finit désactivée.
//
// La règle retenue est donc relative : UN SCRIPT QUI APPARAÎT DANS LA SORTIE
// SANS ÊTRE DANS L'ENTRÉE est une fuite. Elle attrape le cas constaté — une
// offre française, un mot hébreu en sortie — et elle ne peut pas casser un
// cas où les caractères viennent de l'offre, puisqu'ils y sont par
// construction.
//
// Ce qu'elle ne voit pas, et c'est assumé : un mot qui fuirait dans le MÊME
// script que l'offre. Sur une offre hébraïque, un mot hébreu de trop n'est
// pas un défaut d'affichage.
//
// ─── CE QUI EST CONTRÔLÉ, ET CE QUI NE PEUT PAS L'ÊTRE ─────────────────────
//
// Deux familles de champs, et une seule est contrôlée :
//
//   LA PROSE QUE LE MODÈLE RÉDIGE — risques, points favorables, points à
//   négocier, demandes de contre-offre, informations manquantes. Le prompt
//   la veut en français quelle que soit la langue de l'offre. C'est elle qui
//   a fui, et c'est elle qu'on contrôle.
//
//   CE QUI RECOPIE L'OFFRE — le nom de la marque, le territoire, la
//   catégorie d'exclusivité, les modalités de paiement, la devise, les
//   échéances, et le message prêt à envoyer, que le prompt veut « dans la
//   langue de l'offre ». Ces champs-là doivent pouvoir porter n'importe quel
//   script : ils ne sont pas contrôlés du tout.
//
// `ready_to_send_message.tone` n'est pas contrôlé non plus, pour une autre
// raison : il ne va jamais à l'écran tel quel. lib/tone.ts le ramène à l'une
// de trois étiquettes françaises, avec un repli. Un ton qui fuirait serait
// déjà blanchi avant l'affichage.

// Les scripts qu'on sait nommer. La liste ne sert qu'au JOURNAL : la
// détection, elle, n'a pas besoin de connaître un script pour le refuser —
// elle refuse ce qui n'est pas latin. Un script absent d'ici se journalise
// « autre », et la fuite est quand même attrapée.
const SCRIPTS_NOMMES = [
  "Hebrew", "Arabic", "Han", "Hiragana", "Katakana", "Hangul", "Cyrillic", "Greek",
  "Devanagari", "Thai", "Bengali", "Tamil", "Telugu", "Armenian", "Georgian",
  "Ethiopic", "Khmer", "Lao", "Myanmar", "Sinhala", "Tibetan", "Gujarati",
  "Gurmukhi", "Kannada", "Malayalam", "Oriya", "Syriac", "Thaana", "Cherokee", "Mongolian",
] as const;

export type ScriptNomme = (typeof SCRIPTS_NOMMES)[number] | "autre";

// ─── Pourquoi la DÉTECTION DE SCRIPT et pas la détection de langue ─────────
//
// Le mot qui a fui fait quatre lettres. C'est exactement le régime où la
// détection de langue statistique est documentée comme peu fiable : franc rend
// « indéterminé » sous 10 caractères, et l'article de référence sur le sujet —
// Marchisio et al., « Understanding and Mitigating Language Confusion in
// LLMs », EMNLP 2024 — ne soumet ses lignes au détecteur de langue qu'au-delà
// de 4 mots, « LID is less precise on shorter sequences ».
//
// Ce même article, pour mesurer la contamination AU NIVEAU DU MOT dans les
// langues à script latin, remplace le détecteur de langue par une détection de
// plage de script Unicode. C'est le choix fait ici, et il est déterministe : il
// ne dépend pas de la longueur du texte.
//
// ─── Pourquoi `Script_Extensions`, et pourquoi seulement les lettres ───────
//
// UTS #24 §5.3 recommande d'apparier sur `Script_Extensions` plutôt que sur
// `Script`, parce que `Script` seul rate des caractères : un caractère partagé
// entre plusieurs écritures a pour `Script` la valeur « Common », alors que
// `Script_Extensions` énumère les écritures où il sert vraiment.
//
// UTS #39 §5.1, qui définit la détection de mélange d'écritures employée en
// sécurité, va plus loin : les ensembles contenant Common ou Inherited y sont
// « traités comme l'ensemble de TOUS les scripts », ce qui rend chiffres,
// ponctuation et espaces NEUTRES par construction. On obtient la même
// neutralité ici en ne regardant que les lettres : les chiffres, la
// ponctuation, les tirets cadratins, les guillemets français et les emoji ne
// désignent aucune langue.
//
// CE QU'ON NE REPREND PAS D'UTS #39, et c'est un choix : sa règle absolue
// déclare « mélangé » dès que l'intersection des écritures est vide. Appliquée
// telle quelle, elle refuserait « La marque 株式会社 demande… » dans une analyse
// dont l'offre est japonaise — un cas légitime qu'on n'a pas le droit de
// casser. D'où la règle RELATIVE À L'ENTRÉE décrite plus haut.
const EST_LETTRE = /\p{L}/u;
const LETTRE_LATINE = /\p{Script_Extensions=Latin}/u;

// Les lettres d'un texte qui ne sont pas latines. Vide : rien à signaler.
export function lettresNonLatines(texte: string): string[] {
  const trouvees: string[] = [];
  for (const caractere of texte) {
    if (!EST_LETTRE.test(caractere)) continue;
    if (LETTRE_LATINE.test(caractere)) continue;
    if (!trouvees.includes(caractere)) trouvees.push(caractere);
  }
  return trouvees;
}

// LES scripts d'une lettre, au pluriel. Un caractère han appartient à la fois
// à Han et aux écritures japonaise et coréenne : n'en rendre qu'un ferait
// refuser une lettre dont une AUTRE écriture est pourtant autorisée. C'est le
// raisonnement en ensembles d'UTS #39, qui définit l'ensemble de scripts
// augmenté d'un caractère et non une valeur unique.
//
// « autre » quand aucune écriture nommée ne correspond : on ne prétend pas la
// reconnaître, et la fuite est quand même attrapée.
export function scriptsDe(lettre: string): ScriptNomme[] {
  const noms = SCRIPTS_NOMMES.filter((script) =>
    new RegExp(`\\p{Script_Extensions=${script}}`, "u").test(lettre),
  );
  return noms.length > 0 ? [...noms] : ["autre"];
}

// Les scripts non latins présents dans un texte, nommés et triés. C'est ce
// qu'on compare entre l'entrée et la sortie.
export function scriptsNonLatins(texte: string): ScriptNomme[] {
  const noms = new Set<ScriptNomme>();
  for (const lettre of lettresNonLatines(texte)) for (const nom of scriptsDe(lettre)) noms.add(nom);
  return [...noms].sort();
}

// ─── Ce qu'on autorise pour une analyse donnée ─────────────────────────────

// Les scripts qu'une sortie a le droit d'employer, déduits de l'ENTRÉE.
//
// `null` veut dire « on ne connaît pas l'entrée » : c'est le cas d'une offre
// déposée en photo ou en PDF, où le texte n'existe que dans l'image et n'a
// jamais traversé notre code. La prose est alors contrôlée contre le latin
// seul — c'est plus strict, et c'est le bon sens : si une offre photographiée
// porte un nom de marque japonais, il a sa place dans le champ `brand`, qui
// n'est pas contrôlé, pas dans une phrase française sur les risques.
export function scriptsAutorises(offre: string | null): ReadonlySet<ScriptNomme> {
  return new Set(offre === null ? [] : scriptsNonLatins(offre));
}

export type FuiteDeLangue = {
  /** Où, dans la sortie du modèle. Jamais le texte entier : voir `extrait`. */
  champ: string;
  /** Les scripts fautifs, nommés. */
  scripts: ScriptNomme[];
  /** Les lettres fautives, et elles seules. */
  lettres: string[];
};

// Un texte fuit-il ? Rend null si tout va bien.
export function fuiteDe(champ: string, texte: string, autorises: ReadonlySet<ScriptNomme>): FuiteDeLangue | null {
  // Une lettre passe s'il suffit que L'UNE de ses écritures soit autorisée.
  const lettres = lettresNonLatines(texte).filter(
    (lettre) => !scriptsDe(lettre).some((script) => autorises.has(script)),
  );
  if (lettres.length === 0) return null;
  return { champ, scripts: [...new Set(lettres.flatMap(scriptsDe))].sort(), lettres };
}

// Ce qui part dans le journal : où, quels scripts, et les lettres fautives.
// JAMAIS la phrase entière — elle décrit l'offre d'une créatrice, et un
// journal n'est pas un endroit pour ça (lib/analytics : aucune donnée de deal).
export function journalDeFuite(fuites: readonly FuiteDeLangue[]): Record<string, unknown> {
  return {
    champs: fuites.map((fuite) => fuite.champ),
    scripts: [...new Set(fuites.flatMap((fuite) => fuite.scripts))].sort(),
    lettres: [...new Set(fuites.flatMap((fuite) => fuite.lettres))].join(""),
  };
}

// ─── Les champs de prose d'une analyse, et la réparation ───────────────────
//
// La liste est ÉCRITE, pas devinée par parcours du schéma. Un parcours
// générique contrôlerait aussi `deal.brand` et le message prêt à envoyer, qui
// ont le droit de porter n'importe quel script : il casserait les cas
// légitimes que la mission interdit de casser. Chaque ajout de champ de prose
// se déclare donc ici, et un test vérifie que la liste couvre bien tous les
// champs texte du schéma — ceux qui n'y sont pas sont nommés comme exemptés,
// avec leur raison.

type Prose = { champ: string; texte: string };

// Les textes de prose d'une extraction, avec leur chemin.
function proseDeLExtraction(extraction: ProseSource): Prose[] {
  const textes: Prose[] = [];
  const liste = (nom: string, items: ReadonlyArray<{ label: string; why: string }> | undefined) => {
    (items ?? []).forEach((item, i) => {
      textes.push({ champ: `${nom}[${i}].label`, texte: item.label });
      textes.push({ champ: `${nom}[${i}].why`, texte: item.why });
    });
  };
  liste("good_points", extraction.good_points);
  liste("red_flags", extraction.red_flags);
  liste("negotiate", extraction.negotiate);
  (extraction.counter_offer?.changes ?? []).forEach((texte, i) => {
    textes.push({ champ: `counter_offer.changes[${i}]`, texte });
  });
  (extraction.input_quality?.missing_critical ?? []).forEach((texte, i) => {
    textes.push({ champ: `input_quality.missing_critical[${i}]`, texte });
  });
  return textes;
}

// La forme minimale qu'on lit : de quoi éprouver la fonction sans construire
// une extraction entière, et de quoi accepter une extraction réelle.
export type ProseSource = {
  good_points?: ReadonlyArray<{ label: string; why: string }>;
  red_flags?: ReadonlyArray<{ label: string; why: string }>;
  negotiate?: ReadonlyArray<{ label: string; why: string }>;
  counter_offer?: { changes: readonly string[] };
  input_quality?: { missing_critical: readonly string[] };
};

export function fuitesDeLExtraction(extraction: ProseSource, autorises: ReadonlySet<ScriptNomme>): FuiteDeLangue[] {
  return proseDeLExtraction(extraction)
    .map(({ champ, texte }) => fuiteDe(champ, texte, autorises))
    .filter((fuite): fuite is FuiteDeLangue => fuite !== null);
}

// LA RÉPARATION RETIRE L'ÉLÉMENT FAUTIF, elle ne le rafistole pas.
//
// Retirer les lettres fautives d'une phrase donnerait « en échange de
// produits , avec une éventuelle rémunération » : une phrase cassée à
// l'écran, ce qui est pire que la phrase d'origine. Et la traduire demanderait
// un second appel au modèle, pour un point consultatif.
//
// On retire donc le point entier, et on le DIT dans le journal : le chiffrage,
// le verdict et la contre-offre ne viennent pas du modèle, ils ne bougent pas
// d'un euro. La mission exige qu'une sortie rejetée ne laisse ni page cassée
// ni analyse vide : cette réparation est le seul chemin qui tienne les deux.
export function extractionSansFuites<T extends ProseSource>(
  extraction: T,
  autorises: ReadonlySet<ScriptNomme>,
): { extraction: T; fuites: FuiteDeLangue[] } {
  const fuites = fuitesDeLExtraction(extraction, autorises);
  if (fuites.length === 0) return { extraction, fuites };
  const propre = (texte: string) => fuiteDe("", texte, autorises) === null;
  const paire = (item: { label: string; why: string }) => propre(item.label) && propre(item.why);
  return {
    extraction: {
      ...extraction,
      ...(extraction.good_points ? { good_points: extraction.good_points.filter(paire) } : {}),
      ...(extraction.red_flags ? { red_flags: extraction.red_flags.filter(paire) } : {}),
      ...(extraction.negotiate ? { negotiate: extraction.negotiate.filter(paire) } : {}),
      ...(extraction.counter_offer
        ? { counter_offer: { ...extraction.counter_offer, changes: extraction.counter_offer.changes.filter(propre) } }
        : {}),
      ...(extraction.input_quality
        ? {
            input_quality: {
              ...extraction.input_quality,
              missing_critical: extraction.input_quality.missing_critical.filter(propre),
            },
          }
        : {}),
    },
    fuites,
  };
}

// ─── Les mêmes deux familles, pour un tour de négociation ──────────────────
//
// Mission #080 : la lecture d'une réponse de marque produit elle aussi de la
// prose française (les doutes, ce qu'il reste à préciser, la note de
// pertinence) et des champs qui recopient la réponse de la marque (les
// citations, mot pour mot par construction, et le message suivant, « dans la
// langue de la réponse de la marque »). Même règle, même réparation.
export type ProseTour = {
  relevance_note?: string;
  uncertainties?: readonly string[];
  asks?: ReadonlyArray<{ remaining: string | null }>;
};

export function fuitesDuTour(lecture: ProseTour, autorises: ReadonlySet<ScriptNomme>): FuiteDeLangue[] {
  const textes: Prose[] = [];
  if (lecture.relevance_note) textes.push({ champ: "relevance_note", texte: lecture.relevance_note });
  (lecture.uncertainties ?? []).forEach((texte, i) => textes.push({ champ: `uncertainties[${i}]`, texte }));
  (lecture.asks ?? []).forEach((ask, i) => {
    if (ask.remaining) textes.push({ champ: `asks[${i}].remaining`, texte: ask.remaining });
  });
  return textes
    .map(({ champ, texte }) => fuiteDe(champ, texte, autorises))
    .filter((fuite): fuite is FuiteDeLangue => fuite !== null);
}

export function tourSansFuites<T extends ProseTour>(
  lecture: T,
  autorises: ReadonlySet<ScriptNomme>,
): { lecture: T; fuites: FuiteDeLangue[] } {
  const fuites = fuitesDuTour(lecture, autorises);
  if (fuites.length === 0) return { lecture, fuites };
  const propre = (texte: string) => fuiteDe("", texte, autorises) === null;
  return {
    lecture: {
      ...lecture,
      // Une note de pertinence qui fuit disparaît : l'écran a son propre
      // libellé par type de refus (OFF_TOPIC_MESSAGE), elle ne manque donc
      // jamais à personne.
      ...(lecture.relevance_note && !propre(lecture.relevance_note) ? { relevance_note: "" } : {}),
      ...(lecture.uncertainties ? { uncertainties: lecture.uncertainties.filter(propre) } : {}),
      ...(lecture.asks
        ? {
            asks: lecture.asks.map((ask) =>
              ask.remaining && !propre(ask.remaining) ? { ...ask, remaining: null } : ask,
            ),
          }
        : {}),
    },
    fuites,
  };
}
