-- Mission #157 — l'arrivée sur /analyse a son propre nom d'événement.
-- La RPC du cockpit regroupe déjà tous les noms dans counts. Ses quatre
-- filtres de visites restent inchangés : analysis_page_view n'est pas une
-- visite dans la série historique, mais une marche distincte du funnel.
begin;

alter table public.product_events drop constraint if exists product_events_event_name_check;
alter table public.product_events add constraint product_events_event_name_check
  check (event_name in (
    'landing_view', 'pricing_view', 'analysis_started', 'analysis_completed',
    'feedback_submitted', 'signup', 'negotiation_started', 'negotiation_turn',
    'negotiation_concluded', 'checkout_started', 'purchase_completed',
    'guide_view', 'example_view', 'tier_changed', 'analysis_page_view'
  ));

commit;
