-- Mission #165 — les deux drapeaux de la carte de verdict.
--
-- `product_events.event_name` porte une contrainte de liste fermée depuis la
-- migration 30, étendue à chaque nouvel événement (33, 35, 39). Sans cette
-- extension, les deux drapeaux seraient refusés par la base.
--
-- CE QU'IL SE PASSE SI ELLE N'EST PAS ENCORE APPLIQUÉE : l'insertion échoue,
-- recordProductEvent l'attrape et journalise `product_telemetry_error`, et
-- c'est tout. La carte part quand même — l'envoi ne dépend pas de la mesure.
-- On perd le compteur, jamais le partage.
--
-- CE QUE CES DEUX LIGNES DISENT, ET RIEN DE PLUS : qu'une carte a quitté un
-- appareil, par le partage natif du téléphone ou par un téléchargement.
-- Aucun montant, aucune fourchette, aucun identifiant d'analyse : la carte
-- est faite pour être postée publiquement, la mesure n'a pas à en savoir plus
-- que « ça circule ».

begin;

alter table public.product_events drop constraint if exists product_events_event_name_check;
alter table public.product_events add constraint product_events_event_name_check
  check (event_name in (
    'landing_view', 'pricing_view', 'analysis_started', 'analysis_completed',
    'feedback_submitted', 'signup', 'negotiation_started', 'negotiation_turn',
    'negotiation_concluded', 'checkout_started', 'purchase_completed',
    'guide_view', 'example_view', 'tier_changed', 'analysis_page_view',
    'carte_partagee', 'carte_telechargee'
  ));

commit;
