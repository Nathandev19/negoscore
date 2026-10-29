# CURRENT

**Dernière mise à jour : 29/10/2026 (mission #209 bis).** Ce fichier se met à jour
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
prévisualisation `.dev.tsx`, 25 routes sous `/api`, 3 sous `/auth`, 42 fichiers
de migration et 170 fichiers de test.

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
- **La version de PostgreSQL de Supabase est UNKNOWN depuis le dépôt.** Le
  test moteur tourne sur PostgreSQL 18.6 (PGlite 0.5.13) ; Supabase sert du 15
  ou du 17 selon le projet. Tout ce dont la migration 42 dépend existe depuis
  PostgreSQL 12, donc l'écart est faible — mais si l'éditeur donne sa version,
  PGlite peut être épinglé pour coller (0.4.0 → PG 17.5, 0.2.17 → PG 16.4).
- **Une phrase sur le comportement en page dans /confidentialite.** La page
  promet déjà « statistiques d'usage anonymes », sans cookie ni stockage
  local, et la #209 tient tout ça. Mais elle ne mentionne ni la profondeur de
  lecture ni le temps visible. La mission interdisait de toucher au texte des
  pages ; c'est donc à trancher, pas un oubli.
- **Le chemin client d'un tour est désormais INSTRUMENTÉ, pas mesuré.** La
  sonde de la #203 existe et est éteinte ; les chiffres viendront d'un usage
  réel. Le rapport de la #203 donne la commande de console.
- **La médiane de `latency_ms` après le passage à « none »** n'a pas été
  relue. UNKNOWN jusqu'à ce que quelques tours soient passés en production.
- **Une éval large du réglage « none » sur un tour.** Celui retenu l'a été sur
  UNE fixture et trois passes, le minimum que la mission #202 demandait.
