# CURRENT

**Dernière mise à jour : 15/10/2026.** Ce fichier se met à jour **à chaque
mission**. S'il décrit un état que le dépôt a dépassé, il nuit plus qu'il ne
sert : la version d'avant celle-ci annonçait la mission #008 alors que le
journal git était à la #19x.

Tout ce qui suit est établi **depuis le dépôt** — code, tests, migrations,
`.env.example`, journal git. Ce qui ne s'y lit pas est sous « À CONFIRMER PAR
L'ÉDITEUR », et nulle part ailleurs.

## CURRENT STATUS

Negoscore, application Next.js déployée sur Vercel, base Supabase, paiement
Whop, emails Resend. Le dépôt contient 32 pages `page.tsx`, 10 pages de
prévisualisation `.dev.tsx`, 25 routes sous `/api`, 3 sous `/auth`, 40 fichiers
de migration et 156 fichiers de test.

Si le site est en ligne et sous quel nom de domaine ne se lit pas dans le
dépôt : `NEXT_PUBLIC_SITE_URL` est une variable d'environnement.

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

Un seul point se tranche depuis le dépôt :

- **`.env.example` ne documente pas deux variables que le code lit.**
  `OWNER_EMAIL` (`lib/admin/owner.ts`, constante `OWNER_EMAIL_ENV`) et
  `INTERNAL_EMAILS` (`lib/telemetry/internal.ts`, `INTERNAL_EMAILS_ENV`) sont
  absentes du gabarit. Sans la première, `/admin` et `/dev/retours` n'existent
  pour personne ; sans les deux, le marquage interne par compte ne peut pas
  fonctionner. Un nouvel environnement monté depuis `.env.example` serait donc
  aveugle sur ces deux points, sans que rien ne le dise.

Tout le reste de ce qui bloquait est soit fermé, soit hors du dépôt — voir les
deux sections suivantes.

## LAUNCH BLOCKERS

Ce qui reste à faire **et se vérifie dans le dépôt** :

- **Recalibrage de la table de tarifs sur des offres réelles.**
  `lib/rates/fr-2026.4.json` est une table construite sur des repères, pas sur
  un corpus d'offres mesurées. Ce travail demande des données que le dépôt n'a
  pas, mais le fichier à corriger, lui, est bien là.

### Points fermés depuis la version précédente de ce fichier

Chacun était dans la liste et n'y est plus, avec ce qui l'a tranché :

- ~~Suppression effective des documents après `delete_after` (tâche planifiée à
  écrire)~~ → **faite** : `lib/privacy/purge.ts`, `/api/purge`, cron à 03:00
  dans `vercel.json`.
- ~~Lecture des PDF : aucune bibliothèque dans le projet~~ → **n'en demande
  pas** : le PDF part au modèle, après le contrôle local d'`inspectPdf`.
- ~~Médiateur de la consommation~~ → **différé par l'éditeur**, décision 15. Les
  CGV disent que l'adhésion est en cours. Ne pas remettre ce point ici.
- ~~`/resilier` à écrire~~, ~~emails de confirmation~~, ~~webhook entrant~~ →
  **présents dans le code** (`app/api/resilier`, `lib/email/templates.ts`,
  `app/api/email/inbound`).

## À CONFIRMER PAR L'ÉDITEUR

Rien ici ne se lit dans le dépôt : ce sont des états de l'hébergeur, du
prestataire de paiement ou de la base. Je ne les devine pas.

1. **Les variables d'environnement sont-elles renseignées chez l'hébergeur ?**
   `.env.example` en liste 18. Les quatre de la famille email
   (`RESEND_API_KEY`, `EMAIL_FROM`, `RESEND_INBOUND_WEBHOOK_SECRET`,
   `FORWARD_INBOUND_TO`) bloquaient dans la version précédente de ce fichier ;
   leur état actuel est **UNKNOWN**. Idem pour `OWNER_EMAIL` et
   `INTERNAL_EMAILS`, que le gabarit ne liste même pas.
2. **Le webhook entrant est-il déclaré chez Resend ?** UNKNOWN.
3. **La clé API Whop porte-t-elle les permissions de résiliation ?**
   `membership:cancel`, `member:basic:read`, `member:email:read` — exigées par
   le commentaire de `cancelMembershipAtPeriodEnd`. UNKNOWN.
4. **Un achat réel de bout en bout a-t-il été passé, une fois en Pack et une
   fois en Pro, webhook et crédits vérifiés ?** UNKNOWN. Le dépôt contient le
   code et ses tests, pas la trace d'un paiement.
5. **Les 40 migrations sont-elles toutes appliquées sur la base de
   production ?** Le dépôt contient les fichiers ; l'état du schéma est
   UNKNOWN. Le code est écrit pour survivre à une migration non appliquée
   (replis sur colonne ou table absente), ce qui veut dire qu'une migration
   oubliée ne se voit pas à l'écran.
6. **Le rattrapage de données du 12/10 a-t-il été appliqué ?** La mission #181
   a livré le code qui ferme le trou (commit `5f9f976`) et a fourni le SELECT
   puis l'UPDATE à coller. L'état des lignes en base est UNKNOWN.
7. **La mesure demandée par la mission #184 a-t-elle été faite ?** Le SELECT
   comptant les offres occupant plus d'une ligne à cause d'une relance a été
   fourni ; son résultat est UNKNOWN, et le regroupement de `/historique` n'a
   donc pas été construit — délibérément.
8. **`lib/legal/fr.ts` a-t-il été validé par un juriste ?** UNKNOWN.
9. **Le gain de la région `dub1` est-il perceptible ?** La région est déclarée
   depuis le commit `2af1866` ; aucune mesure n'existe dans le dépôt, et la
   décision 14 interdit d'instrumenter la production pour en produire une.

## CURRENT MISSION

**#197 — la mémoire du dépôt** : `AGENTS.md`, `DECISIONS.md` et ce fichier.
Aucun code applicatif modifié.

Une remarque sur la numérotation, parce qu'elle se lit mal dans le journal : le
dernier **sujet** de commit qui porte un numéro est `87a939a` « #192 ». Les
quatre commits suivants n'en portent pas dans leur sujet, et le dernier
(`9e752c6`) cite « la #195 » dans son corps comme une mission passée. Le dépôt
établit donc que #195 est livrée, mais **ne permet pas d'attribuer un numéro à
chacun des derniers commits**. Les numéros #193, #194 et #196 ne se lisent pas
dans le journal.

## NEXT MISSION

À définir.
