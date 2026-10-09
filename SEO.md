# SEO — le processus, pas les astuces

À relire avant CHAQUE page de guide. Une règle, deux lignes.

## Structure

Toute page de guide se construit sur `app/droits-pub-6-mois/page.tsx`.
On n'invente pas une mise en page : même `Section`, même `Point`, même `RateTable`.

## Le moteur dans la page

CHAQUE page de guide porte le moteur, pas un lien vers lui : les chiffres sont calculés dans la page, depuis la table de tarifs, et le test les recalcule un par un.
C'est la seule chose que les fermes à contenu concurrentes ne peuvent pas copier — une page qui ne l'a pas ne se publie pas.

## Maillage

Minimum CINQ liens internes vers chaque nouvelle page, depuis le CORPS DU TEXTE de pages proches — jamais depuis un menu ni un pied de page.
L'ancre reprend le mot-clé de la page visée, pas « en savoir plus ».

## Plan du site

La page entre dans `PUBLIC_PAGES` (`lib/seo.ts`) et le sitemap est régénéré au MÊME commit.
Une page absente du sitemap n'existe pas pour Google.

## Données structurées

Le balisage décrit ce qui est RÉELLEMENT dans la page, mot pour mot.
Pas de FAQ balisée sans FAQ visible, pas de prix balisé sans prix affiché.

## Cadence

Deux pages de guide par semaine au MAXIMUM, et jamais zéro.
Un dépôt qui sort dix guides d'un coup puis plus rien ressemble à de la génération en masse : si une mission demande plus de deux pages dans la même semaine, je refuse et je le dis.

## Porte de diff

Avant de modifier une page existante, lister tout élément présent dans l'ancienne version et absent de la nouvelle : tableaux, formulaires, calculs, liens internes, images.
Cette liste est montrée dans le rapport, et si elle n'est pas vide, elle est en PREMIÈRE LIGNE.

## Le piège des accents

Dans une expression régulière, `connecté\b` ne correspond JAMAIS : `é` n'est pas un caractère de mot, donc `\b` tombe entre `t` et `é`.
Utiliser `(?![a-zà-ÿ])` à la place — relevé en #158, où la moitié des occurrences genrées étaient passées au travers.
