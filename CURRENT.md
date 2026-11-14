# CURRENT

**Dernière mise à jour : 14/11/2026 (mission #214).** Ce fichier se met à jour
**à chaque mission**. S'il décrit un état que le dépôt a dépassé, il nuit plus
qu'il ne sert : deux versions avant celle-ci, il annonçait la mission #008
alors que le journal git était à la #19x.

Tout ce qui suit est établi **depuis le dépôt** — code, tests, migrations,
`.env.example`, journal git — **sauf la section « Vérifié hors du dépôt »**,
qui porte ce que l'éditeur a constaté lui-même chez l'hébergeur, chez le
prestataire de paiement ou dans la base, et qui est daté et attribué comme tel.

## CURRENT STATUS

Negoscore, application Next.js déployée sur Vercel, base Supabase, paiement
Whop, emails Resend. Le dépôt contient 32 pages `page.tsx`, 10 pages de
prévisualisation `.dev.tsx`, 25 routes sous `/api`, 3 sous `/auth`, 43 fichiers
de migration et 181 fichiers de test.

**Deux environnements de test depuis la #201** (`vitest.config.mts`, projets
`node` et `dom`) : les fichiers `*.dom.test.tsx` tournent sous jsdom avec
`@testing-library/react`, tous les autres sous Node. C'est le premier endroit
du dépôt où un bouton est réellement cliqué par un test.

En ligne sur **www.negoscore.fr** — le domaine ne se lit pas dans le dépôt
(`NEXT_PUBLIC_SITE_URL` est une variable d'environnement), il vient du point 2
de la section « Vérifié hors du dépôt ».

## WHAT EXISTS

Établi en parcourant `app/` et `lib/`.

### Analyser une offre

- **Trois entrées** : texte collé, photo, PDF (`app/api/analyse/route.ts`). Le
  PDF est envoyé tel quel au modèle (`extractDealFromPdf`) après un contrôle
  local de taille, de nombre de pages et de protection (`inspectPdf`) qui
  refuse avant tout appel payant. Aucune bibliothèque de lecture de PDF dans
  `package.json`.
- **Le modèle extrait, le code chiffre.** `openai/gpt-5.6-luna` (décision 3)
  ne produit jamais un prix : chiffrage, verdict, couche légale et contre-offre
  sortent de `lib/rates/`, `lib/legal/` et `lib/analysis/compose.ts`, depuis une
  table de tarifs versionnée — la courante est `fr-2026.4.json`.
- **La couche légale est CONDITIONNELLE au mode de diffusion** (#214).
  `lib/legal/fr.ts` est le seul fichier autorisé à porter un énoncé juridique,
  et il porte trois branches, pas une : publication demandée sur le compte du
  créateur (le champ de la loi du 9 juin 2023 est réuni, le contrat écrit
  au-delà de 1 000 € HT est affirmé), diffusion par la marque seule (hors du
  champ, l'obligation n'est pas affirmée), et doute (rien n'est affirmé de
  ferme). Le volet **L131-3** du Code de la propriété intellectuelle est
  présent dans les trois dès qu'il y a cession de droits : il n'a ni seuil de
  montant ni condition de notoriété.
- **Le verdict ne s'affiche plus en note sur 100** (missions #174 à #178). La
  bande (`bad`/`weak`/`fair`/`good`/`excellent`) est enregistrée dans le
  payload et **projetée** à la lecture, jamais recalculée depuis le nombre.
  `/admin` garde « Score : X/100 », seule exception, parce que c'est l'outil qui
  sert à recalibrer l'échelle.
- **Relance gratuite** d'une analyse incomplète, une seule fois, dans les
  `RETRY_WINDOW_DAYS` = 14 jours, sans décompter de droit (`lib/analysis/retry.ts`).
- **Négociation suivie** : `LAST_TURN` = 5, soit l'analyse puis 4 échanges avec
  la marque, enregistrés dans `negotiation_turns`, avec conclusion
  (`/api/analyses/[id]/conclusion`) et marquage des messages envoyés.
- **Carte de verdict partageable** : `/api/carte/[id]` rend une image
  (`next/og`) depuis des projections JSON, sans charger le payload entier.
- **Avis sur l'estimation** : `/api/analyses/[id]/avis`, un avis par tour, lu
  dans `/dev/retours`.

### Comptes, droits, paiement

- **Connexion par magic link** (Supabase Auth, PKCE), jetons en cookies
  httpOnly, rattachement de l'analyse anonyme au compte à la connexion.
- **Trois formules** (`lib/billing/plans.ts`, source unique des prix) : gratuit
  1 négociation, Pack Deal 3 à 4,99 €, Pro 30 par période à 12,99 €.
- **Le droit est vérifié avant l'appel au modèle et décompté après**
  l'enregistrement : un échec ne consomme rien (`lib/billing/entitlement.ts`).
- **Le solde restant s'affiche** dans l'en-tête et au-dessus du champ de saisie,
  lu là où le quota vit, et le bouton d'analyse refuse l'envoi à solde nul
  connu (décision 12).
- **Paiement Whop** : `/api/checkout` crée une configuration de checkout portant
  l'identifiant du compte, `/api/whop/webhook` vérifie la signature Standard
  Webhooks et crédite, `/merci` attend le crédit. `/resilier` annule à la fin de
  la période.
- **Suppression du compte** : `/compte/supprimer`, `/api/compte/supprimer`.

### Pages publiques et acquisition

- 12 pages déclarées publiques dans `lib/seo.ts` (sitemap et canoniques), dont
  **5 guides** : `/combien-facturer`, `/produits-offerts`,
  `/droits-utilisation`, `/droits-pub-6-mois`, `/exclusivite-ugc`. Le processus
  qui les régit est dans `SEO.md`.
- **Pages légales** : `/mentions-legales`, `/confidentialite`, `/cgv`. Plus aucun
  `[[À COMPLÉTER]]` dans une page légale, vérifié par
  `tests/anon-retention.test.tsx`.
- **Exemple chiffré** : `/analyse/demo`, qui recalcule tout depuis une fixture.
- **Chemins courts d'acquisition** : table `SHORT_PATHS`
  (`lib/acquisition/chemins.ts`), lue par `proxy.ts` — dont `/tiktok`,
  `/tiktok-promo`, `/insta`, `/exemple` et cinq chemins de vidéos. La promotion
  porte `paid_social` et `promotion_tiktok`, la bio garde `organic_social` et
  `bio_tiktok` (décision 17).

### Mesure et administration

- **Télémétrie première partie** : `/api/events`, `/api/vue`, sans donnée de
  deal, DNT respecté.
- **Deux champs orthogonaux sur cinq tables** : `environment` (quel déploiement
  a écrit la ligne) et `internal` (qui l'a produite). Trois sources de marquage
  interne : cookie `ns_interne`, User-Agent de mesure `NegoscoreMesure/1`,
  adresse du compte. Depuis la #181, l'adresse de la session vérifiée décide
  avant toute requête.
- **Cockpit** : `/admin` (quatre périodes), `/admin/analyses` avec cinq
  compteurs qui forment une partition de la table, `/admin/users`,
  `/admin/evenements`. Réservé à `OWNER_EMAIL` par `proxy.ts`.
- **Purge quotidienne** : `lib/privacy/purge.ts` supprime les lignes
  `deal_documents` **et** les fichiers du bucket au-delà de `delete_after`,
  appelée par `/api/purge`, déclarée en cron à 03:00 dans `vercel.json`.

### Infrastructure

- **Région `dub1`** déclarée dans `vercel.json` (décision 10).
- **Quatre plafonds d'appels sortants** dans `lib/reseau/delais.ts` : PostgREST
  5 s, Auth 8 s, Whop 10 s, Storage 15 s (décision 11).
- **Emails** : Resend, confirmation d'achat, confirmation de résiliation, et
  `/api/email/inbound` qui réexpédie le courrier reçu sans rien stocker.

## CURRENT BLOCKER

**Aucun.** Le seul point ouvert au 15/10 — `.env.example` qui ne documentait ni
`OWNER_EMAIL` ni `INTERNAL_EMAILS` alors que le code les lit — est corrigé par
la mission #198 : le gabarit en compte 20, et les deux nouvelles portent le
commentaire qui dit ce qui se casse en silence sans elles.

## LAUNCH BLOCKERS

**Deux lignes.** C'est le résultat principal de la mission #198 : les neuf
points que la #197 ne pouvait pas trancher ont été vérifiés par l'éditeur le
15/10, et il n'en reste que ceci.

- **Validation de `lib/legal/fr.ts` par un juriste.** Toujours ouvert.
- **Recalibrage de `lib/rates/fr-2026.4.json` sur des offres réelles.** La
  table est construite sur des repères, pas sur un corpus d'offres mesurées.

## Vérifié hors du dépôt

Constaté par l'éditeur le 15/10/2026. Rien de tout cela ne se lit dans le
dépôt : c'est inscrit ici parce que la seule autre option serait de le
redemander à chaque mission.

Les numéros sont **ceux de la liste « à confirmer » de la #197**, gardés pour
que la correspondance reste lisible. Le point 8 n'y est pas : c'est le seul des
neuf à rester ouvert, et il est passé en blocage de lancement ci-dessus.

1. **Les variables d'environnement sont renseignées en production** — les 18 du
   gabarit d'alors, plus `OWNER_EMAIL` et `INTERNAL_EMAILS`. Vérifié dans
   Vercel.
2. **Le webhook entrant Resend est déclaré**, sur
   `https://www.negoscore.fr/api/email/inbound`, statut *Enabled*.
3. **La clé API Whop porte les permissions de résiliation** : `membership:cancel`,
   ainsi que « Read members » et « Read member emails ». Les deux vocabulaires
   sont écrits exprès — Whop affiche des libellés humains dans son interface,
   pas les identifiants à deux-points de sa documentation, et chercher les
   seconds dans l'interface ne donne rien.
4. **Un achat réel a été passé le 24/09**, libellé de relevé « WHOP NEGOSCORE »
   vérifié. **Reliquat** : le double contrôle Pack PUIS Pro n'a pas été fait.
5. **Les 40 migrations sont appliquées.** Contrôlé le 15/10 sur les **six**
   dont l'absence serait invisible (33, 36, 38, 39a, 39b, 40).
   - **Pourquoi 34, 35 et 37 n'y sont pas**, et ce n'est pas un oubli : 34, 35,
     37 et 38 réécrivent la même fonction, `admin_dashboard_metrics`, par
     `create or replace`. Chaque passage remplace la fonction entière, donc la
     présence du marqueur de la 38 les clôt toutes les trois : la fonction est
     dans son état le plus récent, que les précédentes aient été jouées ou non.
   - L'outil CLI de Supabase n'a jamais été utilisé : **les migrations sont
     appliquées à la main, c'est la méthode, et ce n'est pas un défaut** —
     inutile de proposer de l'outiller.
6. **Le rattrapage de données du 12/10 est appliqué.**
7. **La mesure de la #184 est faite** : zéro offre n'occupe plus d'une ligne, sur
   42 offres au total dont 5 hors nos propres données. Le regroupement de
   `/historique` **ne se construit pas** — décision 16 de `DECISIONS.md`, pas
   une tâche en attente.
9. **Le gain de la région `dub1` est confirmé à l'usage.**
10. **CHECK UTM vérifiés par l'éditeur le 23/10/2026.** Ils acceptent null et
    limitent longueur et casse, sans liste de valeurs. Les lignes distinctes
    relevées contenaient `bio_tiktok`, `_object_object_` et
    `function_object_native_code_` ; ces deux dernières correspondent au
    défaut de recherche de clés corrigé dans `c48907c` (#113).
11. **Retour d'une créatrice UGC professionnelle rapporté par l'éditeur le
    24/10/2026.** Elle a demandé à quatre reprises en appel ce qui faisait
    varier les deux montants d'une fourchette. L'éditeur rapporte qu'elle ne
    pouvait pas utiliser ce chiffre pour négocier sans en comprendre l'écart.

## CURRENT MISSION

**#214 — le produit affirmait une obligation légale sans sa condition
d'application.**

Le produit imposait un contrat écrit au-delà de 1 000 € HT pour TOUS les deals,
sans condition. L'article 1er de la loi n° 2023-451 du 9 juin 2023 n'ouvre son
champ qu'aux personnes qui « mobilisent leur notoriété auprès de leur
audience » : une prestation d'UGC pur en sort, et l'obligation de son article 8
— seuil fixé à 1 000 € HT par le décret n° 2025-1137 — ne s'y applique pas.

- **TROIS BRANCHES, dont une qui n'affirme rien** (`diffusionDe`) :
  `createur` (publication demandée sur le compte du créateur), `marque`
  (aucune publication demandée ET diffusion par la marque écrite
  positivement), `inconnu` (tout le reste).
- **`publication_required: false` NE VEUT PAS DIRE « le créateur ne publie
  pas ».** Le prompt dit « true seulement si le créateur doit publier sur son
  propre compte » : false confond « l'offre dit non » et « l'offre n'en parle
  pas ». La sortie du champ demande donc que la diffusion par la marque soit,
  elle, écrite — sinon c'est `inconnu`.
- **MARQUAGE BLANC ET SPARK ADS VONT DANS « INCONNU ».** La publicité part du
  compte du créateur, ou pousse une publication du créateur : ce ne sont ni
  « exclusivement les canaux de la marque », ni une publication établie. Les
  ranger d'un côté demanderait une base que la mission n'a pas donnée.
- **L'OFFRE D'EXEMPLE EST HORS CHAMP**, et c'est visible sur
  `/dev/resultat?etat=debloque` : la note dit le champ, dit qu'on en est
  dehors, et s'appuie sur L131-3. Avant la #214, elle affirmait l'obligation.
- **LE VOLET L131-3 N'EXISTAIT PAS** : il a été AJOUTÉ (point 3 de la
  mission). Quatre points, ceux que l'article nomme — mention distincte de
  chacun des droits cédés, étendue et destination, lieu, durée —, affichés
  sous leur propre titre dès qu'il y a cession (`ip_transfer !== "none"`,
  « unclear » compris).
- **LA GRAVITÉ SUIT LA BASE** (point 4) : les sept « mentions obligatoires »
  sont celles du contrat écrit de la loi de 2023 ; elles ne s'annoncent plus
  que dans la branche `createur`. Les annoncer ailleurs refabriquerait
  l'affirmation sans sa condition, un cran plus bas.
- **« cumulés sur l'année civile entre une même marque et un même créateur,
  avantages en nature inclus » A DISPARU des deux endroits qui l'écrivaient.**
  Cette formulation demande une base qui n'a pas été fournie. L'ADDITION, elle,
  ne change pas : le total compare montant + produits offerts, et la note le
  dit désormais comme une règle DU PRODUIT, pas comme une citation.
- **Trois champs de plus dans `fr_legal`** (`diffusion`, `rights_transfer`,
  `missing_rights_clauses`), avec des défauts neutres : une analyse
  enregistrée avant la #214 se relit en `diffusion: "inconnu"` et n'affiche
  pas de volet qu'elle n'a pas relevé. **Aucune migration** — `fr_legal` vit
  dans le payload JSON de l'analyse.
- **Le résumé du bloc annonce les DEUX listes**, parce qu'il en rend deux :
  l'invariant des missions #104 et #115 (le nombre annoncé égale le nombre de
  puces) tient maintenant sur leur SOMME, et il a sa garde.

## MISSION PRÉCÉDENTE

**#213 — le compteur comptait des robots qui ne disent pas leur nom.**

Constat du 11 au 14/11 : 5 à 8 `landing_view` par jour sur l'accueil, toutes
« direct », sans référent, empreinte différente à chaque fois, User-Agent
Chrome. Sur 26 pages vues, 0 défilement, 0 geste, 0 contact avec le champ, et
un `page_engagement` 2 à 4 s après. Le trafic humain réel se comptait sur
trois doigts.

- **LE FILTRE DE LA #120 N'ÉTAIT PAS CASSÉ, IL ÉTAIT HORS SUJET.** Il écarte
  « les robots qui DISENT qui ils sont », c'est écrit dans son fichier depuis
  le premier jour. Ceux-là annoncent Chrome.
- **Trois colonnes** (`lib/analytics/robot-visite.ts`, migration 43) :
  `robot` le verdict, `robot_reason` pourquoi — vocabulaire fermé de cinq
  valeurs —, `agent_signature` la forme grossière de l'agent.
- **LA RÈGLE QUI ATTRAPE LE CONSTAT : une sous-requête qui annonce Chromium
  sans envoyer `Sec-CH-UA`.** Les indices client sont produits
  indépendamment de la chaîne User-Agent : les omettre trahit une
  contrefaçon négligente. **MESURÉE AVANT D'ÊTRE ÉCRITE**, sur un Chromium
  156 (route jetable `/dev/entetes`, supprimée) : sur une NAVIGATION,
  `sec-ch-ua` est ABSENT ; sur un fetch, un sendBeacon et une image, il est
  présent. La version naïve de la règle aurait donc classé robot chaque
  chargement de page. Elle est limitée aux sous-requêtes — et les deux
  chemins qui écrivent une visite en sont.
- **LES NAVIGATEURS INTÉGRÉS SONT HORS DE LA RÈGLE.** Celui d'Instagram sur
  Android annonce « Chrome/139 » ; je n'ai PAS pu mesurer s'il envoie les
  indices, et s'il ne les envoie pas la règle effaçait le trafic des DM. On
  n'écarte pas ce qu'on n'a pas mesuré. Trouvé par un test, pas par relecture.
- **SÉPARER, PAS SUPPRIMER** : un robot n'est plus jeté à la porte par les
  routes, sa ligne est écrite et marquée. Le refus de suivi (DNT, GPC),
  lui, continue de n'écrire RIEN : c'est une promesse, pas un filtre.
- **Les comptages par liste fermée** : seules les arrivées mesurées sont
  classées (`ROBOT_CLASSIFIED_EVENTS`). Un achat écrit par le webhook Whop
  ne peut pas être classé robot par construction.
- **L'admin affiche les deux nombres** : tuile « Visites humaines » (indice
  « robots exclus »), tuile « Robots écartés » juste en dessous avec le
  détail par raison, une troisième ligne de preuve à côté de `excluded` et
  `internal`, un tableau « Formes d'agent » sous l'acquisition, et une
  colonne « Robot » dans /admin/evenements.
- **La forme d'agent tranche là où `visitor` ne peut pas** : `visitor` hache
  sel + IP + agent, donc il change à chaque visite d'un client qui tourne ses
  adresses. 26 empreintes distinctes et UNE forme d'agent, ce n'est pas 26
  personnes.
- **/confidentialite a été corrigée**, et c'est une garde qui l'a imposé : la
  phrase « Rien d'autre ne les accompagne » devenait fausse. La page nomme la
  forme d'agent, dit qu'elle est effacée au bout de 7 jours, et la purge
  l'efface vraiment. Date au 14 novembre 2026, empreinte réémise.
- **AUCUNE LIGNE PASSÉE N'EST RÉÉCRITE** : la fenêtre du 11 au 14/11 restera
  surestimée à l'écran. Le filtre ne vaut que pour ce qui arrive après.
- **MIGRATION 43 À APPLIQUER À LA MAIN** (`20261114000043_robots_separes.sql`).
  Elle s'exécute sur un vrai moteur dans `tests/robots-moteur.test.ts`.

## AVANT CELLE-LÀ

**#212 — un lien de message privé ne peut plus mentir sur son réseau.**

`/dm` forçait `utm_source=instagram`, et le lien était collé en message privé
sur DEUX réseaux. Toute visite venue d'un DM TikTok comptait en Instagram —
donc le compteur de l'admin, montré plus fiable que celui de TikTok Ads
(47 contre 39, puis 353 contre 236), perdait l'acquis qui le rendait
autoritaire.

- **UN CHEMIN PAR RÉSEAU** (`lib/acquisition/chemins.ts`), et pas un paramètre
  à ajouter à la main : c'est déjà la forme du dépôt (`/insta` et `/tiktok`
  séparent les deux bios avec `bio_instagram` et `bio_tiktok`), et c'est ce que
  dit la littérature d'attribution — `utm_source` nomme la plateforme,
  `utm_medium` le type de canal. Quatre lignes de table, aucun mécanisme neuf.
- **`/dm` ET `/exemple` NE BOUGENT PAS D'UN OCTET.** Les liens déjà envoyés
  comptent sous les mêmes source, medium, campagne et contenu. D'où une
  symétrie imparfaite assumée : Instagram garde `dm_prospection` et
  `dm_exemple`, TikTok reçoit `dm_prospection_tiktok` et `dm_exemple_tiktok`.
- **`/dm-instagram` et `/exemple-instagram` sont des ALIAS EXACTS**, mêmes
  source et contenu que les adresses d'origine. Leur donner un contenu distinct
  aurait coupé le DM Instagram en deux lignes du cockpit pour toujours, et cassé
  la seule comparaison qui intéresse le projet : réseau contre réseau.
- **`/exemple` PORTAIT LE MÊME DÉFAUT, et la mission ne le nommait pas.** Il
  porte `medium: dm` : c'est l'autre lien de message privé (#125). Réparer
  `/dm` seul aurait laissé la moitié des DM falsifiée.
- **AUCUNE MIGRATION.** `admin_dashboard_metrics` groupe par
  `utm_source, utm_campaign, utm_content` : deux réseaux donnent deux lignes
  sans toucher au SQL. **Vérifié sur le moteur**, pas déduit du texte —
  `tests/migrations-moteur.test.ts` pose 3 événements Instagram et 1 TikTok sur
  PGlite, appelle la fonction, et lit deux lignes séparées (2 visites / 1
  analyse d'un côté, 1 / 0 de l'autre).
- **LA GARDE QUI EMPÊCHE LE DÉFAUT DE REVENIR** (`tests/dm-par-reseau.test.ts`,
  13 tests) : tout chemin de medium `dm` doit nommer son réseau dans son
  chemin, et les deux seules exceptions tolérées sont les adresses historiques
  `dm` et `exemple`, nommées une par une. Un chemin de DM ajouté demain sans
  réseau fait tomber la garde.
- **UNKNOWN : les occurrences de `langue_fuite_reprise` et
  `langue_fuite_reparee` depuis le 31/10.** Ces événements ne sont écrits NULLE
  PART ailleurs qu'en `console.warn` (`lib/llm/extract.ts:103` et `:106`,
  `lib/llm/turn.ts:35` et `:38`) : ils ne vivent que dans les journaux de
  l'hébergeur, qui ne se lisent pas depuis le dépôt. Le volume d'analyses sur
  la même période se lit en base ; le SELECT est dans le rapport de la mission,
  il n'a pas été exécuté ici.

## AVANT-DERNIÈRE MISSION

**#211 — la fuite de langue, mesurée sur de vrais appels.**

900 appels au modèle, 9 offres écrites pour l'éval, 50 passes par offre et par
condition (`evals/langue.ts`, corpus dans `evals/langue-corpus.ts`, résultats
dans `evals/results/langue-2026-10-31T19-05-39-717Z.json`). Coût réel
**1,5413 €**, plafond de la mission 5 €.

- **LA FUITE N'EST PLUS UNKNOWN : 1 sur 450 appels, soit 0,22 %, IC 95 %
  [0,04 % ; 1,25 %]** avec le prompt actuel. Elle a été reproduite : deux
  caractères chinois, 明确, dans `good_points[0].label`, sur une offre de
  contrat en français pur sans un caractère non latin. Même mécanisme que le
  בלבד du 31/10 : un mot étranger substitué à un mot français courant.
- **La position de la consigne N'EST PAS TRANCHÉE.** Consigne en tête : 0 fuite
  sur 450, IC 95 % [0 % ; 0,85 %]. Écart 0,22 %, IC 95 % [−0,64 % ; 1,25 %] :
  l'intervalle contient zéro, l'éval ne distingue pas les deux conditions. À ce
  taux il faudrait des dizaines de milliers d'appels pour les séparer. **Le
  prompt de production n'a pas été modifié** — la décision revient à l'éditeur.
- **L'offre qui a fui est la plus DENSE en prose à produire**, pas celle qui a
  le moins de montants : les trois offres de gifting sans rémunération ont
  donné 0 fuite sur 150. L'hypothèse « le gifting fait fuir » n'est pas
  confirmée ; elle n'est pas écartée non plus, 150 appels ne distinguent rien
  à 0,2 %.
- **LA LISTE DES ÉCRITURES AUTORISÉES NE PROTÈGE RIEN DE MESURABLE.** Sur 900
  appels, un seul a mis une écriture non latine dans un champ contrôlé — celui
  qui a fui. L'offre entièrement en hébreu et l'offre à marque japonaise ont
  rendu une prose exclusivement latine, 100 appels chacune. Les cas légitimes
  vivent dans les champs EXEMPTÉS (`brand`, message prêt à envoyer). Le
  caractère relatif à l'entrée coûte peu, mais il n'a aucun effet observé.
- **L'éval n'appelle PAS `extractDeal`** : celui-ci reprend sur une fuite, ce
  qui mesurerait la fréquence d'un échec après reprise et doublerait le coût.
  Un échantillon vaut un appel, le contrôle est appliqué après, sur la sortie
  brute.
- **Aucune température n'est envoyée**, ni ici ni en production : la valeur par
  défaut du fournisseur s'applique, elle n'est pas à zéro, et la répétition a
  donc un sens.
- **900/900 appels réussis, schéma valide du premier coup 900/900**, latence
  p50 15 780 ms, p95 21 668 ms, 2 882 jetons d'entrée et 1 606 de sortie en
  moyenne.
- **Intervalles de Wilson, écart par la méthode de Newcombe**
  (`evals/langue-mesure.ts`, gardé par `tests/eval-langue.test.ts`) :
  l'intervalle normal rendrait « 0 % [0 % ; 0 %] » à zéro succès et ferait
  conclure à l'absence de fuite.

## MISSIONS ANTÉRIEURES

**#210 — du texte non latin ne peut plus atteindre l'écran.**

Constaté en production le 31/10 : un mot hébreu, בלבד, dans une phrase
française des risques affichés. L'offre était du gifting en français, sans un
caractère non latin — la fuite venait de la génération.

- **La règle est RELATIVE À L'ENTRÉE** (`lib/llm/langue.ts`) : une écriture qui
  apparaît en sortie sans être dans l'offre est une fuite. Interdire le non
  latin en bloc aurait cassé un nom de marque japonais ou une offre en hébreu.
- **Deux familles de champs** : la prose que le modèle rédige est contrôlée ;
  ce qui recopie l'offre — nom de marque, territoire, modalités, et le message
  prêt à envoyer, que le prompt veut dans la langue de l'offre — ne l'est pas.
  Un test vérifie que les 23 champs texte du schéma sont tous classés.
- **Reprise puis réparation, jamais d'échec** : au premier essai la fuite se
  traite comme une sortie invalide et on redemande ; au dernier, on retire le
  point fautif et on garde tout le reste. Ni page cassée, ni analyse vide.
- **Détection de script Unicode, pas détection de langue** : le mot fautif
  fait quatre lettres, le régime où le LID est documenté comme peu fiable.
  `Script_Extensions` et non `Script`, suivant UTS #24 §5.3 — sans quoi
  l'apostrophe-lettre U+02BC ferait refuser « lʼoffre » en français.
- **Le délai par défaut des tests passe de 5 s à 20 s** : plusieurs tests qui
  rendent toutes les pages publiques frôlaient la limite, et trois fichiers de
  plus ont suffi à rendre la suite instable.
- **La fréquence de la fuite, UNKNOWN à la fin de la #210, est MESURÉE par la
  #211** : 0,22 % par appel sur l'éval. Ce que la #210 laissait ouvert sur la
  position de la consigne reste ouvert, mais pour une autre raison : l'éval a
  tourné et ne départage pas.

**#209 — mesurer le comportement À L'INTÉRIEUR d'une page.**

Constat : 400 visites payantes, zéro analyse. Le cockpit mesure les ÉTAPES du
funnel et rien de ce qui se passe entre deux étapes, donc deux explications
restaient ouvertes sans pouvoir être séparées — trafic non réel, ou page qui
n'appelle aucune action.

- **Un seul événement nouveau, `page_engagement`**, émis une fois par page vue,
  au départ de la page. Cinq tranches : profondeur vue, temps visible, délai du
  premier geste, onglet du formulaire touché, et si la page a bougé. Aucun
  identifiant, aucun contenu, aucune durée exacte, aucun stockage sur
  l'appareil, aucune dépendance tierce.
- **Les bornes sont sourcées quand une source existe** : 90 % pour « lue
  jusqu'au bout » (GA4), 5 s pour la faible intention (Microsoft Clarity),
  10 s pour une session engagée (GA4). Celles qui ne le sont pas le disent
  en commentaire — notamment la borne à 1 s, qui est le discriminant choisi
  pour cette mission.
- **Aucun changement visible** : le composant rend `null`, et un test le
  vérifie sur le balisage produit.
- **Le cockpit lit par CANAL** (`utm_medium`, « direct » sans attribution) :
  un entonnoir en page avec les taux écrits, trois mesures à part, et la
  distribution de la profondeur. Le verdict refuse de conclure sous 20 pages
  vues.
- **/tiktok-promo n'est pas une page** : c'est un chemin court qui redirige
  vers l'accueil en y ajoutant ses UTM. Une seule instrumentation couvre les
  deux, et le payant se lit sur la ligne `paid_social`.
- **Migration 42 écrite, NON appliquée.** Première écriture REFUSÉE par
  Postgres : `0A000 cannot use subquery in check constraint`. Corrigée en
  #209 bis sans affaiblir la garantie — `jsonb_typeof` + `?&` + `-`, trois
  opérateurs IMMUTABLE, mesurés équivalents sur dix cas.
- **Le SQL s'exécute maintenant EN TEST, sur un vrai moteur** : PGlite
  (PostgreSQL en WebAssembly, devDependency) fait tourner la migration 42
  entière, appelle `admin_dashboard_metrics()` et compte de vraies lignes.
  C'est ce qui manquait : les tests d'avant lisaient le TEXTE du fichier.
- **UNKNOWN jusqu'à ce que du trafic passe** : laquelle des deux hypothèses
  est la bonne. L'instrument existe, il n'a encore rien mesuré.

## MISSION #208

**#208 — uniformiser les demandes du message prêt à envoyer.**

- Pour une offre au périmètre incomplet ou aux conditions inconnues, chaque point demandé dans le message copiable est une question complète, en français comme en anglais. Les montants, le verdict et la contre-offre restent inchangés.

## MISSION #207

**#207 — poser les questions que l'offre courte laisse ouvertes.**

- Les offres pauvres reçoivent dans le message copiable des questions sur le script, le montage, les rushs bruts, les révisions, la livraison et le paiement. Trois champs facultatifs distinguent une responsabilité explicitement écrite d'un silence, sans participer au chiffrage. L'avertissement de l'exemple et les deux notes de résultat utilisent « verdict » au lieu de « score ».

## MISSION #206

**#206 — garder « Negoscore » entier dans l'en-tête mobile.**

- Le nom reste visible jusqu'à 320 px. Sous 430 px, sa typographie et l'espacement avec le signe diminuent ; la pastille affiche sa variante courte et le menu garde son icône avec un libellé accessible. Décision 19.

## MISSION #205

**#205 — rendre la fourchette lisible sur le résultat.**

- Le bloc « Ce que ça vaut » explique, immédiatement sous la fourchette, que
  les bornes basse et haute portent sur les mêmes contenus et conditions. Il
  montre la plage de création et nomme les suppléments déjà inclus. Aucun
  montant ni calcul du moteur n'est modifié (décision 18).

## MISSION #204

**#204 — porte distincte pour la promotion TikTok.**

- `/tiktok-promo` emprunte la table `SHORT_PATHS` et mène à l'accueil avec
  `tiktok · paid_social · lancement · promotion_tiktok`. `/tiktok` et `/dm`
  gardent leurs quatre UTM d'avant ; le cockpit sépare les contenus.

- Le vieux défaut `/__proto__` et `/constructor` de la #113 explique exactement
  les deux contenus UTM corrompus observés : conversion de `Object.prototype`
  ou du constructeur `Object` en texte par `URLSearchParams`. Validation de
  forme à la sortie des chemins courts et à l'écriture d'événement. Aucune
  ligne historique n'est réécrite.
- **Aucune migration** : les CHECK installés, contrôlés par l'éditeur, ne
  portent pas de liste fermée de source ou medium.
- **UNKNOWN — à vérifier par l'éditeur** : l'événement historique avec
  `utm_campaign=dm` et `utm_medium=null`. Aucun chemin court du code actuel ne
  produit cette paire. `tests/pages-mesurees.test.tsx` fabrique cette paire
  dans un test avec écriture simulée, sans contact avec la base de production ;
  les détails de provenance de la ligne réelle ne sont pas dans le dépôt.

### Avant

**#203 — la queue de latence devient explicable, le chemin client mesurable.**

- **Migration 41 appliquée par l'éditeur le 19/10**, et les deux colonnes sont
  désormais écrites à chaque tour : `attempts` et `schema_valid_first_try`.
  Une ligne à 36 s et une ligne à 18 s ne sont plus indiscernables —
  `latency_ms` peut contenir DEUX appels complets au modèle. Rien n'est
  rétro-rempli : les tours d'avant restent à NULL.
- **Quatre repères temporels côté navigateur** (`lib/ui/chrono.ts`) : clic,
  requête partie, réponse reçue, tour affiché. Éteints par défaut, levés par
  `localStorage.setItem("ns_chrono", "1")`, affichés dans la console, jamais
  dans l'interface. Il n'en sort QUE des durées : un test le vérifie en
  cherchant l'identifiant d'analyse, le texte collé et les montants dans tout
  ce que la sonde produit.
- **UNKNOWN, et c'est le but de la sonde** : la part des onze secondes non
  attribuées qui revient au client. L'hypothèse de la #202 — 34 s était un
  échantillon de queue — n'est ni confirmée ni infirmée.

### Avant

**#202 — la latence d'un tour vient du raisonnement, mesuré.**

- **Le réglage de raisonnement d'un tour est désormais à part de celui d'une
  offre** (`TURN_REASONING_EFFORT` dans `lib/llm/model.ts`). `null` ne
  désactivait rien : le paramètre n'était pas envoyé, et le fournisseur
  appliquait son défaut, « medium ». Mesuré sur une fixture, 3 passes par
  réglage : **18,8 s médiane** contre **4,9 s** à « none », pour la même issue,
  les mêmes trois changements de termes et aucun message de repli.
- **Un tiers du schéma de sortie n'était lu par aucun code.** Dix champs du
  deal qu'aucun groupe de termes n'atteint sortent du schéma ET de l'état
  envoyé : **4 512 → 3 191 caractères** de schéma, **2 326 → 1 990** de message
  utilisateur. `tests/tour-schema.test.ts` épingle la taille et prouve
  l'inatteignabilité par `applyGroup`, pas à l'œil.
- **Le prompt système n'a pas été touché**, et c'est un choix mesuré :
  l'entrée n'est pas le goulot. Dit en toutes lettres dans le test.
- **UNKNOWN : la médiane en production après ce changement.** Elle se relit
  avec le même SELECT qu'avant, une fois quelques tours passés.
- **Migration 41 écrite, NON appliquée** : `attempts` et
  `schema_valid_first_try` sur `negotiation_turns`. Sans elles, une ligne à
  36 s et une ligne à 18 s sont indiscernables, alors que `latency_ms`
  enferme jusqu'à DEUX appels complets.

### Avant

**#201 — où passent les secondes d'un tour, et le projet clique ses boutons.**

- **Les allers-retours en file indienne ont été mesurés, pas supposés** : une
  fausse couche réseau marque l'instant de départ de chaque appel sortant, et
  on compte les paliers. Route du tour **8 vagues → 4**, route de conclusion
  **4 → 3**, page de résultat (refaite par `router.refresh()` pendant que
  l'attente tourne encore) **6 → 4**.
- **Ce que la mesure a surtout établi, c'est où les secondes NE sont PAS** :
  à 60 ms l'aller-retour, tout le chemin hors modèle tenait en 874 ms avant,
  479 ms après. Les ~33 s restantes d'un tour sont l'appel au modèle.
  **UNKNOWN : sa latence réelle, et celle de la première analyse.** Elles sont
  enregistrées (`analyses.latency_ms`, `negotiation_turns.latency_ms`) ; le
  SELECT est dans le rapport de la mission, il n'a pas été exécuté ici.
- **`conclude()` a reçu le traitement du tour** : son propre panneau d'attente
  (`ConclusionPending`), son compteur, son plancher de 900 ms, son bouton
  réellement désactivé. Le libellé dit « récapitulatif », pas « lecture » : la
  conclusion n'appelle pas le modèle.
- **Un défaut trouvé par le premier test de clic** : le message d'erreur du fil
  était rendu **deux fois**, même identifiant, deux `role="alert"`. Il était là
  depuis la #098 et trois relectures à la source ne l'avaient pas vu.

## NEXT MISSION

À définir. Ce qui reste ouvert, et ce qui ne l'est plus :

- **Le comportement en page est INSTRUMENTÉ, pas encore mesuré** (#209). Il
  faut appliquer la migration 42 corrigée, du trafic — payant de préférence,
  pour comparer — puis relire /admin. Tant qu'aucune ligne n'est enregistrée,
  laquelle des deux hypothèses est la bonne reste UNKNOWN.
- **La version de PostgreSQL de production est 17.6**, mesurée par l'éditeur
  sur Supabase le 30/10/2026. PGlite est épinglé à l'exact sur 0.4.6, qui
  embarque PostgreSQL 17.5 : même majeure, une version corrective d'écart.
  Aucune version de PGlite ne descend à 17.6 — mesuré sur les séries 0.3.x,
  0.4.x et 0.5.x — et c'est écrit dans le test.
- **/confidentialite décrit la mesure, depuis la #209 ter** : les quatre
  signaux nommés un par un, les tranches avec un exemple chiffré, et ce qui
  n'est JAMAIS relevé — le texte collé en premier. Un test lie le texte de la
  page aux champs du relevé : un sixième signal fera tomber la garde.
- **UNE CONTRADICTION DE LA #209 TER EST CORRIGÉE** (#209 quinquies). La page
  affirmait « Aucun identifiant n'accompagne ces relevés », alors que
  `product_events` porte une colonne `visitor` — empreinte technique du jour,
  écrite sur CHAQUE événement du produit parce que `recordProductEvent` passe
  `diagnostic: true` sans condition. La phrase disait vrai de `metadata` et
  faux de la ligne. Elle dit maintenant ce qui est : l'empreinte accompagne le
  relevé, elle rapproche deux pages vues du même appareil le même jour, elle
  ne relie pas deux jours, et elle est effacée au bout de 7 jours.
  `tests/engagement-empreinte.test.ts` interroge la LIGNE réellement écrite,
  et fige la liste de ses 17 colonnes.
- **La date d'une page légale ne peut plus mentir en silence** (#209 quater).
  Elle reste écrite à la main — la dériver d'un horodatage de fichier ou d'un
  commit donnerait une date FAUSSE à chaque déploiement — mais
  `tests/pages-legales.test.tsx` fige une EMPREINTE du contenu rendu de chacune
  des trois pages légales, à côté de sa date. Changer un mot sans changer la
  date fait échouer le test, qui dit quoi faire.
- **Les relevés d'audience sont supprimés au bout de 13 MOIS** (#209 quater).
  Avant, aucune ligne de `product_events` ne l'était jamais. La purge
  quotidienne les prend par lots de 200, sous plafond de 4 000 par passage, en
  ne supprimant QUE des identifiants lus avec la limite de date. Aucune
  migration : l'index `product_events_time_idx (occurred_at desc)` existe
  depuis la migration 30, vérifié sur le moteur par un plan de requête.
- **Le chemin client d'un tour est désormais INSTRUMENTÉ, pas mesuré.** La
  sonde de la #203 existe et est éteinte ; les chiffres viendront d'un usage
  réel. Le rapport de la #203 donne la commande de console.
- **La médiane de `latency_ms` après le passage à « none »** n'a pas été
  relue. UNKNOWN jusqu'à ce que quelques tours soient passés en production.
- **Une éval large du réglage « none » sur un tour.** Celui retenu l'a été sur
  UNE fixture et trois passes, le minimum que la mission #202 demandait.
- **LE MODE DE DIFFUSION N'EST PAS EXTRAIT À TROIS VALEURS** (#214). Le
  prompt ne demande qu'un booléen `publication_required`, dont le `false`
  confond « l'offre dit non » et « l'offre n'en parle pas ». Le produit s'en
  sort en exigeant que la diffusion par la marque soit écrite, mais un champ
  d'extraction à trois valeurs trancherait vraiment. Non fait, non décidé :
  il faudrait toucher au prompt et au schéma d'extraction.
- **DEUX FORMULATIONS DU PRODUIT RESTENT SANS BASE FOURNIE** (#214), et elles
  ne sont donc plus écrites : le cumul sur l'année civile entre une même
  marque et un même créateur, et l'inclusion des avantages en nature dans le
  seuil. L'addition, elle, est restée dans le calcul. UNKNOWN jusqu'à ce que
  l'éditeur donne la base, ou décide de retirer l'addition.
- **LES SEPT MENTIONS NE SONT PAS CONDITIONNÉES AU SEUIL** (#214) : elles
  s'affichent dès que le champ de la loi est réuni, même sous 1 000 € HT.
  C'était déjà le cas avant la mission (#100, #104, #115) ; la #214 n'a touché
  qu'au champ. À trancher à part.
- **LA MIGRATION 43 N'EST PAS ENCORE APPLIQUÉE** (#213), à la date de ce
  fichier. Tant qu'elle ne l'est pas, les lignes s'écrivent sans classement
  (repli en deux temps dans `lib/analytics/first-party.ts`) et le cockpit
  affiche 0 robot écarté.
- **LE TAUX RÉEL DE ROBOTS EN PRODUCTION EST UNKNOWN** (#213) : il se lira
  dans la tuile « Robots écartés » une fois la migration appliquée et
  quelques jours passés. Les dénominateurs qui ont servi à fermer trois
  canaux, eux, restent ceux d'avant : ils ne sont pas corrigés
  rétroactivement, et ne peuvent pas l'être.
- **L'ATTRIBUTION DES DM EST SÉPARÉE PAR RÉSEAU** (#212), et il reste à
  COLLER les nouvelles adresses : `/dm-tiktok` et `/exemple-tiktok` dans les
  messages privés TikTok, `/dm-instagram` et `/exemple-instagram` dans ceux
  d'Instagram. Tant qu'aucun DM ne porte la nouvelle adresse, l'écran continue
  d'afficher une seule ligne de DM, et c'est normal.
- **LES OCCURRENCES DE FUITE DE LANGUE NE SONT PAS INTERROGEABLES** (#212).
  Elles ne vivent qu'en `console.warn`, donc dans les journaux de l'hébergeur.
  Les faire passer par `recordProductEvent` demanderait une migration : non
  fait, non décidé.
- **LA FUITE DE LANGUE EST MESURÉE, SA CAUSE NON** (#211). 0,22 % par appel,
  IC 95 % [0,04 % ; 1,25 %], une occurrence reproduite sur 450 appels. La
  position de la consigne de langue dans le prompt reste à trancher : l'éval
  a tourné et son intervalle d'écart contient zéro, donc elle ne départage
  pas, et à ce taux aucun budget raisonnable ne le ferait. Le prompt de
  production est INCHANGÉ.
