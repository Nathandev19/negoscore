# CURRENT

**Dernière mise à jour : 15/10/2026 (mission #198).** Ce fichier se met à jour
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
prévisualisation `.dev.tsx`, 25 routes sous `/api`, 3 sous `/auth`, 40 fichiers
de migration et 156 fichiers de test.

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
  `/insta`, `/exemple` et cinq chemins de vidéos.

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
5. **Les 40 migrations sont appliquées.** Contrôlé le 15/10 sur celles dont
   l'absence serait invisible : 33, 36, 38, les deux portant le préfixe 39, et
   40. L'outil CLI de Supabase n'a jamais été utilisé : **les migrations sont
   appliquées à la main, c'est la méthode, et ce n'est pas un défaut** — inutile
   de proposer de l'outiller.
6. **Le rattrapage de données du 12/10 est appliqué.**
7. **La mesure de la #184 est faite** : zéro offre n'occupe plus d'une ligne, sur
   42 offres au total dont 5 hors nos propres données. Le regroupement de
   `/historique` **ne se construit pas** — décision 16 de `DECISIONS.md`, pas
   une tâche en attente.
9. **Le gain de la région `dub1` est confirmé à l'usage.**

## CURRENT MISSION

**#198 — les neuf réponses, et deux dettes.** Les neuf points « à confirmer » de
la #197 inscrits tels que l'éditeur les a constatés, `.env.example` complété de
ses deux variables manquantes, et la règle du numéro de mission dans le sujet du
commit ajoutée à `AGENTS.md`. Aucun code applicatif modifié.

## NEXT MISSION

À définir.
