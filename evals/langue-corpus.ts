// Mission #211 — LE CORPUS DE L'ÉVAL DE FUITE DE LANGUE.
//
// Des offres ÉCRITES POUR L'ÉVAL. Aucune ne vient de la base : rien d'une
// vraie utilisatrice ne sort du produit pour une mesure.
//
// CE QUE CHAQUE OFFRE SERT À MESURER :
//   « attendu » dit quelles écritures non latines l'offre contient
//   LÉGITIMEMENT. C'est la référence de langue que lib/llm/langue.ts
//   calcule : une écriture présente là a le droit de ressortir, une
//   écriture absente de là est une fuite. Le champ est vérifié au
//   démarrage de l'éval contre le texte réel (evals/langue.ts), sinon
//   une faute de frappe dans une offre ferait passer une fuite pour
//   un cas légitime.
//
// LA CLASSE QUI A PRODUIT LE DÉFAUT DU 31/10 est le gifting pur, sans
// montant : c'est là que le modèle a le plus à écrire et le moins à
// recopier. Trois offres du corpus en relèvent (gifting-pur,
// gifting-affiliation, gifting-concours).

export type OffreEval = {
  id: string;
  /** Pourquoi elle est dans le corpus. */
  role: string;
  /** Écritures non latines présentes dans l'offre, donc autorisées en sortie. */
  attendu: string[];
  texte: string;
};

export const CORPUS: readonly OffreEval[] = [
  {
    id: "gifting-pur",
    role: "gifting pur, aucun montant — la classe de la fuite du 31/10",
    attendu: [],
    texte: `Coucou !

On adore ton feed et on aimerait te faire découvrir notre nouvelle gamme de soins visage. On t'envoie le coffret complet (valeur boutique 120 €) et en échange on aimerait 3 vidéos TikTok et 2 stories Instagram.

On ne prévoit pas de rémunération pour ce premier envoi, mais si ça matche bien on pourra parler d'une vraie collab rémunérée ensuite. On aurait besoin de pouvoir reposter les contenus sur nos comptes, et de les garder pour nos pubs si jamais.

Tu nous dis ?`,
  },
  {
    id: "gifting-affiliation",
    role: "gifting plus commission, aucun fixe — pas un seul montant à recopier",
    attendu: [],
    texte: `Bonjour,

Nous lançons notre programme créateurs et nous aimerions t'y associer. Tu reçois gratuitement deux de nos sacs de la collection automne, tu réalises une vidéo Reel et un carrousel, et tu touches une commission sur chaque vente réalisée avec ton code personnel.

Les contenus seraient utilisés sur nos réseaux et éventuellement en publicité. Nous demandons une exclusivité sur la catégorie maroquinerie le temps de la campagne.

Dis-nous si le principe te convient, nous t'envoyons le code dans la journée.`,
  },
  {
    id: "gifting-concours",
    role: "gifting déguisé en sélection — flou volontaire, rien de chiffré",
    attendu: [],
    texte: `Hello,

Tu fais partie des profils retenus pour notre campagne de rentrée. Le principe : on t'envoie le produit, tu postes du contenu, et les trois créateurs qui génèrent le plus d'engagement sont retenus pour la campagne payante de décembre.

On a besoin des rushs bruts en plus des vidéos montées, et d'une cession des droits pour pouvoir les réutiliser librement.

Tu es partante ?`,
  },
  {
    id: "fr-montant-clair",
    role: "français pur avec un montant écrit — le cas simple, pour le taux de base",
    attendu: [],
    texte: `Bonjour,

La marque Bluverre souhaite te confier la réalisation de 2 vidéos verticales de 30 secondes pour Instagram, à publier sur ton compte.

Budget : 900 € HT au total, payés à 30 jours après livraison. Droits d'utilisation organiques pendant 6 mois sur nos comptes France. Deux allers-retours de retouches sont prévus.

Livraison souhaitée avant le 20 novembre.

Bien à toi,
Camille`,
  },
  {
    id: "fr-contrat-dense",
    role: "français pur, langue de contrat — beaucoup de prose à produire en sortie",
    attendu: [],
    texte: `OBJET : PRESTATION DE CRÉATION DE CONTENU

Le Prestataire s'engage à réaliser quatre (4) contenus vidéo et deux (2) contenus photographiques, livrés en format brut et monté.

Le Prestataire cède à l'Annonceur, à titre exclusif et pour toute la durée de protection des droits, l'ensemble des droits d'exploitation sur les contenus, pour tous supports et tous territoires, y compris en publicité payante et en diffusion depuis les comptes du Prestataire.

L'Annonceur se réserve la faculté d'utiliser les contenus, l'image et la voix du Prestataire aux fins d'entraînement de ses outils automatisés.

Rémunération forfaitaire : 1 400 € HT, payable à 60 jours fin de mois. Exclusivité sectorielle de douze (12) mois. Révisions jusqu'à validation définitive par l'Annonceur.

Résiliation possible à tout moment par l'Annonceur sans indemnité.`,
  },
  {
    id: "fr-marque-japonaise",
    role: "offre française avec un nom de marque japonais légitime — ne doit pas casser",
    attendu: ["Han", "Katakana"],
    texte: `Bonjour,

Je travaille pour 株式会社ユニコ (Unico), marque japonaise de papeterie qui arrive en France.

Nous cherchons une créatrice pour 3 vidéos TikTok présentant notre gamme de carnets. Budget 600 € HT. Nous souhaitons pouvoir diffuser les vidéos en publicité payante sur le territoire français pendant 12 mois.

Merci de me dire si cela vous intéresse.`,
  },
  {
    id: "fr-marque-latine-rare",
    role: "nom de marque en latin inhabituel — ne doit déclencher aucun contrôle",
    attendu: [],
    texte: `Bonjour,

Nous représentons Hästens Łódź, distributeur de literie haut de gamme, et nous préparons une campagne avec lʼagence Nørdisk.

Nous aimerions 2 vidéos Instagram et 1 story. Budget 750 € HT payé à 45 jours. Utilisation organique uniquement, France et Belgique, 6 mois.

Au plaisir,
Søren`,
  },
  {
    id: "he-offre-hebraique",
    role: "offre entièrement en hébreu — l'hébreu devient légitime en sortie",
    attendu: ["Hebrew"],
    texte: `שלום,

אנחנו מחפשים יוצרת תוכן לקמפיין של מוצרי טיפוח. נשלח לך את כל הסדרה, ונרצה שלושה סרטוני טיקטוק ושני סטוריז באינסטגרם.

התקציב הוא 500 אירו, בתשלום תוך 30 יום. נרצה להשתמש בתוכן גם בפרסום ממומן, בישראל ובצרפת, למשך שנה.

תודה רבה`,
  },
  {
    id: "en-offre-anglaise",
    role: "offre en anglais — autre langue, écriture latine, la sortie reste française",
    attendu: [],
    texte: `Hi there,

We're reaching out from Palefield, a US skincare brand launching in Europe.

We'd love to work with you on 4 TikTok videos and 2 Instagram Reels. We're offering $1,200 for the package, paid 45 days after delivery. We'd need full usage rights in perpetuity across all markets, including paid media and whitelisting from your handle.

We'd also ask for category exclusivity for 6 months.

Let us know if you're interested!`,
  },
];
