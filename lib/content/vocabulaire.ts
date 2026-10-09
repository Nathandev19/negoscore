import { FREE_ANALYSES, PACK_ANALYSES, PRO_ANALYSES_PER_PERIOD } from "@/lib/billing/plans";
import { LAST_TURN } from "@/lib/negotiation/libelles";

// Mission #093 — un seul vocabulaire pour tout ce qui est public : page,
// métadonnées, données structurées, emails, CGV.
//
// L'unité vendue est la NÉGOCIATION, parce que c'est l'unité réellement
// facturée : un achat couvre le deal du premier message jusqu'à la conclusion.
// « Analyse » ne désigne plus l'unité vendue (c'est une étape de la
// négociation) ; « crédit » reste le mot de la base et du code, jamais celui
// de la copie destinée à la personne.
//
// Les nombres viennent tous du code : jamais écrits à la main dans un texte.
//
// ─── Mission #176 — « SCORE » N'EST PLUS UN MOT DE LA COPIE ───────────────
//
// La note sur 100 a quitté l'affichage (#174) : plus aucun écran de créatrice
// ne la montre. Le mot « score » ne nomme donc plus rien qu'elle puisse voir,
// et il a disparu de la copie. Deux mots le remplacent, selon le rôle :
//
//   ce qui LIT l'offre          → « l'analyse »
//   ce qui S'AFFICHE en retour  → « le verdict »
//
// La note continue d'être calculée et enregistrée : « score » reste le mot du
// CODE et de la BASE, comme « crédit ». Une seule exception à l'écran, et
// elle est nommée : /admin, où le rapport d'avis affiche « Score : X/100 »
// parce que c'est l'outil qui sert justement à recalibrer l'échelle.
//
// tests/note-contre-bande.test.ts refuse le mot partout ailleurs.

// Nombre de tours d'un échange, l'analyse comprise (lib/negotiation/types.ts).
export const NEGOTIATION_TURNS = LAST_TURN;

// Mission #099, point 11 (audit B13) — le produit annonçait « jusqu'à 5 tours »
// et l'écran disait « les 4 tours sont utilisés » : le tour 1 est l'analyse
// elle-même. Côté client, on ne compte plus des « tours » mais des ÉCHANGES
// avec la marque, et l'analyse est nommée à part. Le nombre vient de la
// constante : il ne peut pas diverger de ce que la route autorise.
export const NEGOTIATION_EXCHANGES = LAST_TURN - 1;

// « l'analyse, puis jusqu'à 4 échanges avec la marque » : la formule, partout.
export const EXCHANGES_PHRASE = `l'analyse, puis jusqu'à ${NEGOTIATION_EXCHANGES} échanges avec la marque`;

// « 4 échanges », « 1 échange ».
export function exchanges(count: number): string {
  return `${count} échange${count > 1 ? "s" : ""}`;
}

export const NEGOTIATIONS = {
  free: FREE_ANALYSES,
  pack: PACK_ANALYSES,
  proPerPeriod: PRO_ANALYSES_PER_PERIOD,
} as const;

// « 3 négociations », « 1 négociation ».
export function negotiations(count: number): string {
  return `${count} négociation${count > 1 ? "s" : ""}`;
}

// Ce qu'une négociation contient, dit d'une seule façon partout.
export const WHAT_IS_A_NEGOTIATION = `Une négociation couvre un deal en entier : ${EXCHANGES_PHRASE}, et la conclusion. Répondre à la marque ne coûte rien de plus.`;

// Ce que le produit est, et ce qu'il n'est pas. Repris tel quel sur l'accueil.
export const COPILOT_PROMISE =
  "Negoscore est un copilote de négociation : il lit l'offre, la chiffre et rédige tes messages. Accepter ou refuser reste ta décision.";

export const ESTIMATE_DISCLAIMER =
  "Les montants affichés sont des repères de marché calculés à partir d'une table de tarifs, pas une promesse de gain.";

// Mission #102, partie A — l'attente, sur un téléphone qu'on quitte. La
// phrase est vraie : le travail n'est pas rattaché à la connexion du
// navigateur, et au retour l'écran va rechercher l'état réel
// (lib/analysis/resume.ts).
export const WORK_SURVIVES_BACKGROUND = "L'analyse continue même si tu quittes l'application.";

// Retour au premier plan, et le serveur ne connaît rien de cette tentative,
// longtemps après : on le dit, sans rien relancer dans son dos.
export const RESUME_FAILED =
  "L'analyse n'est pas arrivée au bout. Rien n'a été décompté : appuie de nouveau sur « Analyser mon deal ».";

// Mission #102, partie B — le filet horaire porte sur l'OUVERTURE d'une
// négociation, jamais sur les échanges qu'elle contient. Le message dit donc
// ce qui est bloqué, et jusqu'à quand.
//
// Mission #104, E3 — il ne dit plus « tu as lancé » à quelqu'un qui n'a rien
// lancé : derrière une même adresse mobile, plusieurs visiteurs partagent le
// compteur. Le message nomme donc ce qui est compté — ce réseau, ou ce compte
// — et reste vrai dans les deux cas.
export function tooManyOpenings(minutes: number, scope: "adresse" | "compte" = "adresse"): string {
  const source = scope === "compte" ? "avec ce compte" : "depuis ce réseau";
  return `Trop de nouvelles négociations ouvertes ${source} dans l'heure. Réessaie dans ${minutes} min : tes négociations déjà ouvertes, elles, continuent.`;
}

// Mission #111 — ce que la page Tarifs propose à un compte, selon ce qu'il
// possède déjà. Aucune de ces phrases n'est écrite dans le composant.
//
// Le Pack devient une RECHARGE dans deux situations, et elle ne se raconte pas
// de la même façon : un abonné Pro achète de quoi dépasser son quota du mois,
// quelqu'un qui a déjà des négociations en réserve achète simplement la suite.
// Dire « utilisables quand ton quota mensuel est atteint » au second serait
// faux : il n'a pas de quota mensuel.
export const RECHARGE_NAME = "Recharge";
export const RECHARGE_ACTION = "Recharger";
export const RECHARGE_SUMMARY = `${negotiations(NEGOTIATIONS.pack)} supplémentaires`;

export const RECHARGE_FEATURES: Record<"pro" | "reserve", readonly string[]> = {
  pro: [
    "Utilisables quand ton quota mensuel est atteint",
    "Sans date d'expiration",
    "Conservées si tu résilies ton abonnement",
  ],
  reserve: [
    "Ajoutées à celles qu'il te reste",
    "Sans date d'expiration",
    "Utilisables quand tu veux",
  ],
};

// Action d'achat d'une formule qu'on ne possède pas encore.
export function takePlan(name: string): string {
  return `Prendre ${name}`;
}

export const SIGN_IN_TO_PAY = "Se connecter pour payer";

// Formule Pro en cours. Trois cas, trois phrases vraies : abonnement payé avec
// une date, abonnement résilié qui court encore, et accès offert par
// l'administrateur — qui n'a ni date ni résiliation possible.
export function proInProgress(endsAt: string | null, cancelled: boolean): string {
  if (cancelled) return endsAt ? `Ta formule en cours. Elle prend fin le ${endsAt}.` : "Ta formule en cours. Elle prend fin à la fin de la période.";
  return endsAt ? `Ta formule en cours, jusqu'au ${endsAt}.` : "Ta formule en cours.";
}

export const PRO_OFFERED = "Ton accès Pro offert est en cours. Rien à payer.";

// Mission #158 — la mention « toutes taxes comprises », écrite une seule fois.
//
// Elle apparaît à trois endroits : l'accueil (section Tarifs), la FAQ de
// l'accueil, et la description de /tarifs lue par les moteurs. Les trois
// disaient déjà le même mot pour mot ; rien ne les empêchait de diverger au
// prochain passage. Elles le lisent maintenant ici.
//
// Ce n'est PAS la phrase longue de /tarifs : cette page-là est celle qui vend,
// et elle dit en plus qui collecte la taxe et sous quel libellé le prélèvement
// apparaît (mission #122). Deux surfaces, deux niveaux de détail, volontaire.
export const MENTION_TTC = "Prix TTC.";

// Mission #119 — le lien vers l'exemple chiffré, écrit une seule fois.
//
// La page /analyse/demo était indexée par Google et atteignable depuis le seul
// accueil : les trois guides, qui sont les pages d'arrivée depuis la recherche,
// n'y menaient pas. C'est pourtant la page qui montre le produit fini à
// quelqu'un qui n'a rien à coller.
//
// Le libellé dit ce qu'on y trouve, jamais « démo » : personne ne clique sur
// « démo », et le mot ne dit pas qu'il y a des euros au bout. « Analyse » est
// employé au sens du vocabulaire de la mission #093 — une ÉTAPE de la
// négociation, pas l'unité vendue : c'est exactement ce que la page montre.
export const FULL_EXAMPLE = {
  href: "/analyse/demo",
  label: "Voir une analyse chiffrée, sur un exemple",
} as const;

// Mission #104, A3 — les libellés de concept vivent dans lib/content/labels.ts
// (module feuille, sans import) et sont ré-exportés ici : le vocabulaire reste
// la porte d'entrée, sans entraîner la facturation dans le graphe d'imports de
// l'écran de résultat.
export { RAW_FOOTAGE_LABEL } from "@/lib/content/labels";
// Mission #109 — la phrase de verdict selon la position du montant dans la
// fourchette, et le premier palier de contre-offre.
export { COUNTER_FIRST_STEP_TITLE, counterFirstStepSentence, WITHIN_RANGE_SENTENCE, type WithinRange } from "@/lib/content/labels";
