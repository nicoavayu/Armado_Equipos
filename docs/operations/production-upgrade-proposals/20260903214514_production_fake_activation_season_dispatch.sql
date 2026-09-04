-- LOCAL ONLY. Exact FAKE adapter from canonical provider evolution.
-- Changes only a function created by this upgrade, absent in Production BEFORE.
-- Dispatches FAKE approvals to the season-aware activator; preserves ACL.
create or replace function public.activate_verified_fake_tournament_purchase(
  p_purchase_id uuid,
  p_provider_payment_id text default null,
  p_simulated_activation_error_code text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_environment text;
begin
  select provider_environment into v_environment
  from public.tournament_purchases where id = p_purchase_id;
  return public.activate_verified_tournament_purchase(
    p_purchase_id,'FAKE',v_environment,'approved',null,p_provider_payment_id,
    p_simulated_activation_error_code
  );
end;
$$;
-- Canonical service-only contract of the new season activator.
REVOKE ALL ON FUNCTION public.activate_verified_tournament_purchase(uuid,text,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.activate_verified_tournament_purchase(uuid,text,text,text,text,text,text) TO service_role;
