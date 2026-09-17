-- Mission #060 — deux pertes possibles, deux verrous.
--
-- 1. Clé d'idempotence des analyses. Le navigateur tire une clé avant
--    d'envoyer, la garde, et la renvoie s'il rejoue. Le serveur retrouve alors
--    l'analyse déjà produite au lieu d'en payer une seconde : une coupure
--    réseau ne coûte plus ni droit ni analyse. L'index partiel n'indexe que les
--    lignes qui portent une clé (les anciennes n'en ont pas).
alter table public.deals add column if not exists idempotency_key text;

create unique index if not exists deals_idempotency_key_idx
  on public.deals (idempotency_key)
  where idempotency_key is not null;

-- 2. Reprise des webhooks de paiement. Le crédit doit être accordé une fois et
--    une seule, même si le traitement est rejoué par Whop ou par le rattrapage
--    quotidien. La marque et l'ajout au solde tiennent dans une seule
--    transaction : si l'un échoue, l'autre est annulé.
alter table public.whop_events add column if not exists credited_at timestamptz;

-- Les événements enregistrés mais jamais traités : ce sont eux que reprend le
-- rattrapage (lib/billing/webhook-recovery.ts).
create index if not exists whop_events_unprocessed_idx
  on public.whop_events (received_at)
  where processed_at is null;

create or replace function public.whop_event_credit(
  p_event_id text,
  p_user_id uuid,
  p_amount integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  marked integer;
begin
  -- Marque et crédit dans la même transaction : deux appels concurrents ou
  -- successifs ne peuvent pas créditer deux fois, et un échec du crédit annule
  -- la marque, donc le rattrapage réessaiera.
  update public.whop_events
     set credited_at = now()
   where event_id = p_event_id
     and credited_at is null;
  get diagnostics marked = row_count;
  if marked = 0 then
    return false;
  end if;

  update public.credits
     set balance = balance + p_amount,
         updated_at = now()
   where user_id = p_user_id;
  return true;
end;
$$;

revoke all on function public.whop_event_credit(text, uuid, integer) from public, anon, authenticated;
