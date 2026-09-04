-- LOCAL ONLY. Missing provider-neutral dependency of FAKE season checkout.
-- Exact canonical helper body. CREATE fails on any collision. No network,
-- provider configuration or provider constraints are added or widened.
create function public.record_tournament_purchase_preference(
  p_purchase_id uuid,
  p_provider text,
  p_provider_environment text,
  p_provider_preference_id text,
  p_preference_expires_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_purchase public.tournament_purchases%rowtype;
begin
  if p_provider_preference_id is null
    or char_length(btrim(p_provider_preference_id)) not between 3 and 200 then
    raise exception using errcode = '22023', message = 'TORNEOS_PREFERENCE_INVALID';
  end if;
  select * into v_purchase from public.tournament_purchases
  where id = p_purchase_id for update;
  if v_purchase.id is null or v_purchase.provider <> p_provider
    or v_purchase.provider_environment <> p_provider_environment then
    raise exception using errcode = '22023', message = 'TORNEOS_PURCHASE_INVALID';
  end if;
  if v_purchase.provider_preference_id is not null then
    if v_purchase.provider_preference_id <> btrim(p_provider_preference_id) then
      raise exception using errcode = '55000', message = 'TORNEOS_PREFERENCE_CONFLICT';
    end if;
    return public.tournament_purchase_projection(v_purchase)
      || jsonb_build_object('idempotentReplay',true);
  end if;
  if v_purchase.status <> 'created' then
    raise exception using errcode = '55000', message = 'TORNEOS_PURCHASE_TRANSITION_INVALID';
  end if;

  update public.tournament_purchases set
    status = 'preference_created',provider_status = 'created',
    provider_preference_id = btrim(p_provider_preference_id),
    preference_expires_at = coalesce(p_preference_expires_at,preference_expires_at),
    last_verified_at = now()
  where id = v_purchase.id returning * into v_purchase;
  insert into public.tournament_purchase_events (
    purchase_id,organization_id,event_type,from_status,to_status,provider_status,
    actor_type
  ) values (
    v_purchase.id,v_purchase.organization_id,'preference.created','created',
    'preference_created','created','service'
  );
  return public.tournament_purchase_projection(v_purchase)
    || jsonb_build_object('idempotentReplay',false);
end;
$$;
REVOKE ALL ON FUNCTION public.record_tournament_purchase_preference(uuid,text,text,text,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.record_tournament_purchase_preference(uuid,text,text,text,timestamptz) TO service_role;
