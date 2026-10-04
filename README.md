# Negoscore

**Colle l'offre d'une marque : on te dit ce qu'elle vaut, ce que tu cèdes, et quoi répondre.**

En production sur **[negoscore.fr](https://www.negoscore.fr)** · [voir une analyse complète](https://www.negoscore.fr/exemple)

Negoscore s'adresse aux créateurs UGC francophones qui reçoivent des propositions de
marques par DM, par mail ou en PDF, sans agent ni juriste pour les relire. Ils savent
ce que coûte une vidéo ; ils ne savent pas ce que valent les **droits** qu'on leur
demande de céder avec.

On colle le message reçu — texte, capture d'écran ou PDF — et on obtient un score sur
100, une fourchette en euros décomposée ligne par ligne, les points à renégocier, et
un message prêt à renvoyer à la marque.

---

## Le principe : le modèle extrait, le code chiffre

C'est la décision d'architecture qui structure tout le projet.

```
message de la marque  ──▶  LLM (texte + vision)  ──▶  offre en schéma structuré
                                                              │
                                                              ▼
                                            moteur de tarification déterministe
                                                              │
                                                              ▼
                                            score · fourchette · contre-offre
```

**Le modèle ne décide jamais d'un prix.** Il lit un message en langage naturel et le
rend sous forme d'objet typé et validé : livrables, plateformes, nature et durée des
droits, exclusivité, territoire, délai de paiement. Tout ce qui suit est du code
ordinaire, pur et testé.

Trois raisons :

- **Reproductibilité.** La même offre donne la même fourchette, hier comme demain.
- **Testabilité.** Un prix issu d'un modèle ne se fige pas dans un test ; un prix issu
  d'une fonction, oui. Chaque fourchette publiée est verrouillée par un test.
- **Défendabilité.** Quand une créatrice conteste un chiffre, on peut lui montrer la
  ligne exacte qui le produit et la source derrière.

## Comment le prix est calculé

Le moteur (`lib/rates`) part d'un tarif de création et empile des majorations
**additives**, chacune exprimée en pourcentage de la base :

```
unités pondérées       vidéo 1,00 · story 0,25 · photo 0,35
dégressivité           fonction affine par morceaux sur le volume
tarif de base          selon le niveau déclaré de la créatrice
majorations            droits publicitaires, whitelisting, exclusivité,
                       plateforme supplémentaire, territoire, cession
plafond cumulé         +150 %, porté à +250 % si l'offre demande une
                       utilisation à vie ou une cession totale des droits
arrondi                à la dizaine, l'écart réparti sur les lignes
```

La table de tarifs (`lib/rates/fr-2026.3.json`) porte, **pour chaque valeur**, un
niveau de confiance (`medium` ou `low`) et une note de source en clair, qui dit si la
valeur vient d'un benchmark de marché observé ou si elle a été interpolée entre deux
paliers. Une valeur interpolée n'est pas un défaut caché, c'est une dette déclarée dans
le fichier — la note se termine alors par « à recalibrer ».

## Confidentialité et mesure

Le site **n'embarque aucun outil de mesure tiers** — ni Google Analytics, ni PostHog,
ni pixel publicitaire. La mesure est entièrement première partie, écrite dans la base
du produit et lue dans `/admin`.

L'empreinte qui distingue deux visiteurs est un condensat salé, **recalculé chaque jour
avec un sel tiré au hasard puis détruit** : l'adresse IP en clair n'est jamais stockée
ni journalisée, et deux journées ne peuvent pas être reliées entre elles. C'est le
modèle Plausible / Fathom,
qui fait entrer la mesure dans l'exemption de consentement de la CNIL pour la mesure
d'audience — donc **pas de bandeau cookies**.

Le texte d'origine des offres déposées est purgé automatiquement **au bout de 30 jours**.

## Architecture

| | |
|---|---|
| Front | Next.js 16 (App Router), React 19, TypeScript strict, Tailwind 4, shadcn/ui |
| Validation | Zod, aux frontières (entrée utilisateur et sortie du modèle) |
| Base | Supabase — PostgreSQL, RLS sur toutes les tables de données utilisateur |
| IA | SDK OpenAI en production ; SDK Anthropic et Google utilisés pour les évaluations |
| Paiement | Whop (marchand de référence pour le règlement carte) |
| Email | Resend |
| Hébergement | Vercel |
| Tests | Vitest — unitaires, intégration (contre une vraie base) et évaluations modèle |

Quelques partis pris lisibles dans le code :

- **Le cockpit `/admin` affiche l'heure de Paris**, par zone nommée, jamais par décalage
  codé en dur — y compris le regroupement par jour en SQL. Ailleurs, les dates sans
  heure restent dans le fuseau du serveur.
- **Une analyse anonyme est rattachée à un compte par un jeton de 32 octets aléatoires**
  posé en cookie `httpOnly`, jamais par une heuristique de proximité temporelle.
- Un **jeton de mesure** dans le user-agent permet de tester en production sans polluer
  les chiffres.

## Qualité

```
2 011 tests                sur 137 fichiers
tests d'intégration        RLS, stockage et compteurs d'usage, contre une vraie base
évaluations modèle         extraction texte et vision, sur jeux de référence versionnés
```

Les évaluations (`evals/`) comparent plusieurs modèles sur les mêmes offres de
référence et mesurent la qualité de l'extraction, pas celle du prix — puisque le prix
ne vient pas du modèle.

## Commandes

```bash
pnpm install
pnpm dev                  # http://localhost:3000, clés lues depuis .env.local

pnpm lint && pnpm typecheck && pnpm test && pnpm build

pnpm test:integration     # RLS, bucket et garde d'usage, contre Supabase
pnpm eval                 # évaluation des modèles sur evals/fixtures
pnpm eval:vision          # évaluation image
pnpm eval:pipeline        # extraction + composition de bout en bout
```

Variables d'environnement : voir `.env.example`.

## Documents

| | |
|---|---|
| `PRODUCT.md` | cible, problème, promesse, périmètre |
| `DECISIONS.md` | décisions verrouillées et pièges rencontrés |
| `CURRENT.md` | état courant du chantier |

---

## Licence

Code publié par transparence, **tous droits réservés**. Ce dépôt n'est pas un projet
open source : aucune licence d'utilisation, de modification ou de redistribution n'est
accordée.

Negoscore est édité par Nathan Pakou Gakosso Owah, entrepreneur individuel —
mentions légales sur [negoscore.fr/mentions-legales](https://www.negoscore.fr/mentions-legales).
