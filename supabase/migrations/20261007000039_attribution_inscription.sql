-- Mission #162 — l'attribution doit survivre au lien de connexion.
--
-- LE DÉFAUT, mesuré en production le 07/10 :
--   16:54:14  landing_view        instagram · lancement · bio_instagram, empreinte 8aec1a
--   16:55:25  analysis_started    même empreinte
--   17:03:26  signup              non_attribue, empreinte d5f9ca
-- Même personne, huit minutes d'écart, deux empreintes : elle a ouvert le lien
-- de connexion depuis sa messagerie, donc dans un autre navigateur. L'empreinte
-- de visiteur ne peut pas relier les deux — le sel est tiré au hasard chaque
-- jour (#131), c'est voulu, on n'y touche pas.
--
-- LE PRINCIPE : l'attribution est rangée CÔTÉ SERVEUR, à deux endroits qui
-- existent déjà, et jamais dans l'adresse du lien envoyé par email. Un lien de
-- connexion transite par des serveurs qu'on ne contrôle pas et finit dans des
-- journaux : on n'y met rien d'autre que ce qui y est déjà.
--
--   1. public.deals          — l'attribution de la visite qui a soumis l'offre.
--                              La ligne est déjà là, déjà rattachée au jeton
--                              anonyme du navigateur, déjà purgée avec
--                              l'analyse : l'attribution meurt avec elle.
--   2. public.login_claims   — l'attribution relevée au moment où le lien est
--                              DEMANDÉ, dans le bon navigateur. C'est elle que
--                              /auth/callback relit au clic, dans n'importe
--                              quel navigateur, pour écrire `signup`.
--
-- AUCUNE CONTRAINTE CHECK ICI, et c'est délibéré.
-- product_events en porte sur ses colonnes utm (longueur, minuscules). Les
-- reprendre ici ferait échouer l'INSERT ENTIER d'une réclamation ou d'un deal
-- sur une valeur hors format — c'est-à-dire qu'on perdrait le rattachement des
-- analyses anonymes, ou l'analyse elle-même, pour une colonne de mesure. Une
-- contrainte ne doit jamais pouvoir faire perdre la ligne qu'elle décore.
-- La validation est faite AVANT l'insertion, en TypeScript, par la même
-- fonction que partout ailleurs (parseAttribution, lib/analytics/first-party.ts) :
-- elle borne, met en minuscules, et écrit null quand la valeur ne convient pas.
-- Au pire on perd la colonne, jamais la ligne.

-- ─── 1. L'attribution de la visite qui a soumis l'offre ────────────────────
alter table public.deals add column if not exists utm_source text;
alter table public.deals add column if not exists utm_medium text;
alter table public.deals add column if not exists utm_campaign text;
alter table public.deals add column if not exists utm_content text;
alter table public.deals add column if not exists referrer_host text;

-- ─── 2. L'attribution rangée avec la demande de lien ───────────────────────
alter table public.login_claims add column if not exists utm_source text;
alter table public.login_claims add column if not exists utm_medium text;
alter table public.login_claims add column if not exists utm_campaign text;
alter table public.login_claims add column if not exists utm_content text;
alter table public.login_claims add column if not exists referrer_host text;

-- Une réclamation pouvait n'exister que pour un jeton anonyme. Elle peut
-- désormais n'exister que pour porter une attribution — quelqu'un qui arrive
-- avec des UTM et crée son compte sans avoir lancé d'analyse. Retirer un NOT
-- NULL ne rejette aucune ligne existante et n'en perd aucune.
alter table public.login_claims alter column anon_token drop not null;

-- RIEN N'EST RÉÉCRIT. Les lignes déjà enregistrées gardent leur attribution
-- telle quelle, y compris l'inscription du 07/10 qui reste `non_attribue` :
-- une série de mesure ne se corrige pas après coup, elle devient lisible à
-- partir d'une date, et le rapport dit laquelle.
