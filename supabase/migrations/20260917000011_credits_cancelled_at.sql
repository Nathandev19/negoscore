-- Date de la demande de résiliation d'un abonnement Pro. L'accès reste ouvert
-- jusqu'à credits.period_end : c'est cette date qui fait foi, pas l'état
-- renvoyé par le prestataire de paiement.
alter table public.credits add column if not exists cancelled_at timestamptz;
