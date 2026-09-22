-- Mission #090 bis — prolonger la période Pro au lieu de l'écraser.
--
-- Constat (#090, B1) : à l'activation d'un abonnement, le webhook écrivait
-- period_end = renewal_period_end du nouvel abonnement, sans regarder la date
-- déjà en place. Deux abonnements payés en parallèle ne donnaient qu'une seule
-- période : un mois encaissé sans contrepartie.
--
-- Pour prolonger, il faut distinguer deux choses que Whop envoie sur le même
-- type d'événement (membership.activated) :
--   - le RENOUVELLEMENT mensuel du même abonnement : la date annoncée par Whop
--     fait foi, il ne faut surtout pas l'ajouter à la période en place ;
--   - un abonnement DISTINCT activé alors qu'un autre court : sa durée s'ajoute.
-- La seule marque de cette différence dans la charge est l'identifiant de
-- l'abonnement. On le garde donc sur le compte, pour le comparer au suivant.
--
-- NULL : aucun abonnement connu (compte jamais Pro), ou abonnement activé
-- avant cette migration. Dans ce dernier cas, le code ne peut pas distinguer un
-- renouvellement d'un second abonnement : il garde alors la date la plus
-- lointaine et le journalise, plutôt que de prolonger à tort.
--
-- À appliquer à la main, APRÈS 20260915000005 (credits) — ou toute migration
-- ultérieure qui touche credits.

alter table public.credits
  add column if not exists membership_id text;
