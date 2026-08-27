-- Arma2 Torneos · Mercado Pago Checkout Pro (TEST only).
--
-- Additive evolution of the certified FAKE commercial foundation. Production
-- is deliberately absent from the provider/environment allow-list.

set check_function_bodies = off;

begin;

alter table public.tournament_purchases
  drop constraint tournament_purchases_provider_check,
  drop constraint tournament_purchases_environment_check;

alter table public.tournament_purchases
  add constraint tournament_purchases_provider_check
    check (provider in ('FAKE','MERCADO_PAGO')),
  add constraint tournament_purchases_environment_check check (
    (provider = 'FAKE' and provider_environment in ('local','qa'))
    or (provider = 'MERCADO_PAGO' and provider_environment = 'test')
  );

create or replace function public.tournament_purchase_projection(
  p_purchase public.tournament_purchases
) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'schemaVersion',2,
    'id',p_purchase.id,
    'organizationId',p_purchase.organization_id,
    'tournamentId',p_purchase.tournament_id,
    'productCode',p_purchase.product_code,
    'offerCode',p_purchase.offer_code,
    'offerVersion',p_purchase.offer_version,
    'listAmount',p_purchase.list_amount_snapshot,
    'amount',p_purchase.amount_snapshot,
    'currency',p_purchase.currency,
    'provider',p_purchase.provider,
    'providerEnvironment',p_purchase.provider_environment,
    'providerPreferenceId',p_purchase.provider_preference_id,
    'externalReference',p_purchase.external_reference,
    'status',p_purchase.status,
    'providerStatus',p_purchase.provider_status,
    'providerStatusDetail',p_purchase.provider_status_detail,
    'preferenceExpiresAt',p_purchase.preference_expires_at,
    'approvedAt',p_purchase.approved_at,
    'entitlementActivatedAt',p_purchase.entitlement_activated_at,
    'activationErrorCode',p_purchase.activation_error_code,
    'createdAt',p_purchase.created_at,
    'updatedAt',p_purchase.updated_at
  );
$$;

create or replace function public.create_tournament_purchase(
  p_organization_id uuid,
  p_tournament_id uuid,
  p_product_code text,
  p_idempotency_key uuid,
  p_provider text,
  p_provider_environment text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_offer public.tournament_commercial_offers%rowtype;
  v_purchase public.tournament_purchases%rowtype;
  v_product public.tournament_commercial_products%rowtype;
  v_id uuid := gen_random_uuid();
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  if not public.has_tournament_organization_capability(
    p_organization_id,'billing.manage'
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_BILLING_FORBIDDEN';
  end if;
  if p_idempotency_key is null or not (
    (p_provider = 'FAKE' and p_provider_environment in ('local','qa'))
    or (p_provider = 'MERCADO_PAGO' and p_provider_environment = 'test')
  ) then
    raise exception using errcode = '22023', message = 'TORNEOS_PURCHASE_INVALID';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_organization_id::text || ':' || p_tournament_id::text || ':' || p_product_code,79
  ));

  if not exists (
    select 1 from public.tournaments tournament
    where tournament.organization_id = p_organization_id
      and tournament.id = p_tournament_id
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_PURCHASE_FORBIDDEN';
  end if;
  if exists (
    select 1 from public.tournament_plan_grants grant_row
    where grant_row.organization_id = p_organization_id
      and grant_row.tournament_id = p_tournament_id
      and grant_row.plan_code = 'PREMIUM'
      and public.is_tournament_plan_grant_effective(grant_row.id)
  ) then
    raise exception using errcode = '55000', message = 'TORNEOS_ALREADY_PREMIUM';
  end if;

  select * into v_purchase from public.tournament_purchases
  where buyer_user_id = auth.uid() and idempotency_key = p_idempotency_key;
  if v_purchase.id is not null then
    if v_purchase.organization_id <> p_organization_id
      or v_purchase.tournament_id <> p_tournament_id
      or v_purchase.product_code <> p_product_code
      or v_purchase.provider <> p_provider
      or v_purchase.provider_environment <> p_provider_environment then
      raise exception using errcode = '22023', message = 'TORNEOS_IDEMPOTENCY_CONFLICT';
    end if;
    return public.tournament_purchase_projection(v_purchase)
      || jsonb_build_object('idempotentReplay',true,'existingOpenPurchase',false);
  end if;

  select * into v_purchase from public.tournament_purchases
  where organization_id = p_organization_id and tournament_id = p_tournament_id
    and product_code = p_product_code
    and status in ('created','preference_created','pending')
  order by created_at limit 1 for update;
  if v_purchase.id is not null then
    if v_purchase.provider <> p_provider
      or v_purchase.provider_environment <> p_provider_environment then
      raise exception using errcode = '55000', message = 'TORNEOS_OPEN_PURCHASE_PROVIDER_CONFLICT';
    end if;
    return public.tournament_purchase_projection(v_purchase)
      || jsonb_build_object('idempotentReplay',false,'existingOpenPurchase',true);
  end if;

  select * into v_product from public.tournament_commercial_products
  where product_code = p_product_code and status = 'active';
  if v_product.product_code is null or v_product.plan_code <> 'PREMIUM'
    or v_product.scope <> 'tournament' or v_product.billing_model <> 'one_time' then
    raise exception using errcode = '22023', message = 'TORNEOS_PRODUCT_UNAVAILABLE';
  end if;
  select * into v_offer from public.tournament_commercial_offers offer
  where offer.product_code = p_product_code
    and offer.availability = 'available'
    and offer.valid_from <= statement_timestamp()
    and (offer.valid_until is null or offer.valid_until > statement_timestamp())
  order by offer.valid_from desc,offer.offer_version desc limit 1;
  if v_offer.product_code is null then
    raise exception using errcode = '22023', message = 'TORNEOS_OFFER_UNAVAILABLE';
  end if;

  insert into public.tournament_purchases (
    id,organization_id,tournament_id,buyer_user_id,product_code,offer_code,offer_version,
    list_amount_snapshot,amount_snapshot,currency,provider,provider_environment,
    external_reference,idempotency_key,status,preference_expires_at
  ) values (
    v_id,p_organization_id,p_tournament_id,auth.uid(),p_product_code,
    v_offer.offer_code,v_offer.offer_version,v_offer.list_amount,v_offer.amount,
    v_offer.currency,p_provider,p_provider_environment,
    'arma2:tournament:purchase:' || v_id::text,p_idempotency_key,'created',
    now() + interval '30 minutes'
  ) returning * into v_purchase;

  insert into public.tournament_purchase_events (
    purchase_id,organization_id,event_type,from_status,to_status,actor_type,actor_user_id
  ) values (
    v_purchase.id,p_organization_id,'purchase.created',null,'created','user',auth.uid()
  );

  return public.tournament_purchase_projection(v_purchase)
    || jsonb_build_object('idempotentReplay',false,'existingOpenPurchase',false);
end;
$$;

create or replace function public.record_tournament_purchase_preference(
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

create or replace function public.create_fake_tournament_purchase(
  p_organization_id uuid,
  p_tournament_id uuid,
  p_product_code text,
  p_idempotency_key uuid,
  p_provider_environment text default 'local'
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_purchase jsonb;
begin
  v_purchase := public.create_tournament_purchase(
    p_organization_id,p_tournament_id,p_product_code,p_idempotency_key,
    'FAKE',p_provider_environment
  );
  if v_purchase->>'status' = 'created' then
    v_purchase := public.record_tournament_purchase_preference(
      (v_purchase->>'id')::uuid,'FAKE',p_provider_environment,
      'fake_pref_' || (v_purchase->>'id'),
      (v_purchase->>'preferenceExpiresAt')::timestamptz
    ) || jsonb_build_object(
      'existingOpenPurchase',coalesce((v_purchase->>'existingOpenPurchase')::boolean,false),
      'idempotentReplay',coalesce((v_purchase->>'idempotentReplay')::boolean,false)
    );
  end if;
  return v_purchase;
end;
$$;

create or replace function public.get_provider_tournament_purchase(
  p_external_reference text,
  p_provider text,
  p_provider_environment text
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_purchase public.tournament_purchases%rowtype;
begin
  select * into v_purchase from public.tournament_purchases
  where external_reference = p_external_reference
    and provider = p_provider and provider_environment = p_provider_environment;
  if v_purchase.id is null then
    raise exception using errcode = 'P0002', message = 'TORNEOS_PURCHASE_NOT_FOUND';
  end if;
  return public.tournament_purchase_projection(v_purchase);
end;
$$;

create or replace function public.activate_verified_tournament_purchase(
  p_purchase_id uuid,
  p_provider text,
  p_provider_environment text,
  p_provider_status text,
  p_provider_status_detail text default null,
  p_provider_payment_id text default null,
  p_simulated_activation_error_code text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_purchase public.tournament_purchases%rowtype;
  v_offer public.tournament_commercial_offers%rowtype;
  v_product public.tournament_commercial_products%rowtype;
  v_grant_id uuid;
  v_from_status text;
begin
  select * into v_purchase from public.tournament_purchases
  where id = p_purchase_id for update;
  if v_purchase.id is null or v_purchase.provider <> p_provider
    or v_purchase.provider_environment <> p_provider_environment
    or v_purchase.provider_preference_id is null
    or (p_provider = 'MERCADO_PAGO' and (
      p_provider_environment <> 'test' or p_provider_payment_id is null
    )) then
    raise exception using errcode = '22023', message = 'TORNEOS_PURCHASE_INVALID';
  end if;
  if v_purchase.status = 'approved' and v_purchase.entitlement_activated_at is not null then
    if p_provider_payment_id is not null
      and v_purchase.approved_provider_payment_id is distinct from p_provider_payment_id then
      raise exception using errcode = '55000', message = 'TORNEOS_PAYMENT_CONFLICT';
    end if;
    return public.tournament_purchase_projection(v_purchase)
      || jsonb_build_object('idempotentReplay',true);
  end if;
  if v_purchase.status not in ('preference_created','pending','approved') then
    raise exception using errcode = '55000', message = 'TORNEOS_PURCHASE_TRANSITION_INVALID';
  end if;
  v_from_status := v_purchase.status;

  update public.tournament_purchases set
    activation_attempts = activation_attempts + 1,last_verified_at = now()
  where id = v_purchase.id returning * into v_purchase;

  if p_simulated_activation_error_code is not null then
    update public.tournament_purchases
    set activation_error_code = left(p_simulated_activation_error_code,80)
    where id = v_purchase.id returning * into v_purchase;
    insert into public.tournament_purchase_events (
      purchase_id,organization_id,event_type,from_status,to_status,provider_status,
      actor_type,metadata
    ) values (
      v_purchase.id,v_purchase.organization_id,'activation.failed',v_purchase.status,
      v_purchase.status,p_provider_status,'service',
      jsonb_build_object('errorCode',v_purchase.activation_error_code)
    );
    return public.tournament_purchase_projection(v_purchase);
  end if;

  select * into v_offer from public.tournament_commercial_offers
  where product_code = v_purchase.product_code and offer_code = v_purchase.offer_code
    and offer_version = v_purchase.offer_version;
  select * into v_product from public.tournament_commercial_products
  where product_code = v_purchase.product_code;
  if v_offer.product_code is null or v_product.plan_code <> 'PREMIUM'
    or v_product.scope <> 'tournament' or v_product.billing_model <> 'one_time'
    or v_offer.list_amount <> v_purchase.list_amount_snapshot
    or v_offer.amount <> v_purchase.amount_snapshot
    or v_offer.currency <> v_purchase.currency then
    update public.tournament_purchases set activation_error_code = 'snapshot_mismatch'
    where id = v_purchase.id returning * into v_purchase;
    insert into public.tournament_purchase_events (
      purchase_id,organization_id,event_type,from_status,to_status,provider_status,
      actor_type,metadata
    ) values (
      v_purchase.id,v_purchase.organization_id,'activation.failed',v_purchase.status,
      v_purchase.status,p_provider_status,'service',
      '{"errorCode":"snapshot_mismatch"}'::jsonb
    );
    return public.tournament_purchase_projection(v_purchase);
  end if;

  v_grant_id := public.grant_tournament_premium(
    v_purchase.organization_id,v_purchase.tournament_id,'purchase',
    'Pago ' || v_purchase.provider || ' verificado para la compra ' || v_purchase.id::text
  );
  update public.tournament_plan_grants set origin_purchase_id = v_purchase.id
  where id = v_grant_id and origin_purchase_id is null;
  insert into public.tournament_plan_grant_events (
    grant_id,purchase_id,event_type,reason_code,reason,actor_type
  ) select v_grant_id,v_purchase.id,'granted','payment_approved',
    'Premium activado por pago verificado','provider'
  where not exists (
    select 1 from public.tournament_plan_grant_events event
    where event.grant_id = v_grant_id and event.event_type = 'granted'
  );

  update public.tournament_purchases set
    status = 'approved',provider_status = left(btrim(p_provider_status),80),
    provider_status_detail = nullif(left(btrim(p_provider_status_detail),120),''),
    approved_provider_payment_id = coalesce(
      approved_provider_payment_id,p_provider_payment_id,'fake_pay_' || id::text
    ),
    approved_at = coalesce(approved_at,now()),activation_error_code = null,
    entitlement_activated_at = coalesce(entitlement_activated_at,now()),last_verified_at = now()
  where id = v_purchase.id returning * into v_purchase;

  insert into public.tournament_purchase_events (
    purchase_id,organization_id,event_type,from_status,to_status,provider_status,
    provider_status_detail,actor_type,metadata
  ) values (
    v_purchase.id,v_purchase.organization_id,'payment.approved',v_from_status,'approved',
    v_purchase.provider_status,v_purchase.provider_status_detail,'provider',
    jsonb_build_object('providerPaymentId',v_purchase.approved_provider_payment_id)
  );
  insert into public.tournament_audit_log (
    organization_id,actor_user_id,actor_type,action,resource_type,resource_id,
    tournament_id,metadata
  ) values (
    v_purchase.organization_id,null,'system','billing.purchase_activated',
    'tournament_purchase',v_purchase.id,v_purchase.tournament_id,
    jsonb_build_object('grantId',v_grant_id)
  );
  return public.tournament_purchase_projection(v_purchase)
    || jsonb_build_object('idempotentReplay',false);
end;
$$;

create or replace function public.apply_verified_tournament_payment_status(
  p_purchase_id uuid,
  p_provider text,
  p_provider_environment text,
  p_status text,
  p_provider_status text,
  p_provider_status_detail text default null,
  p_provider_payment_id text default null,
  p_simulated_activation_error_code text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_purchase public.tournament_purchases%rowtype; v_from_status text;
begin
  if p_status = 'approved' then
    return public.activate_verified_tournament_purchase(
      p_purchase_id,p_provider,p_provider_environment,p_provider_status,
      p_provider_status_detail,p_provider_payment_id,p_simulated_activation_error_code
    );
  end if;
  if p_status not in ('pending','rejected','cancelled','expired') then
    raise exception using errcode = '22023', message = 'TORNEOS_PROVIDER_STATUS_INVALID';
  end if;
  select * into v_purchase from public.tournament_purchases
  where id = p_purchase_id for update;
  if v_purchase.id is null or v_purchase.provider <> p_provider
    or v_purchase.provider_environment <> p_provider_environment
    or v_purchase.provider_preference_id is null
    or v_purchase.status = 'created' then
    raise exception using errcode = '55000', message = 'TORNEOS_PURCHASE_TRANSITION_INVALID';
  end if;
  if p_provider = 'MERCADO_PAGO' and p_provider_payment_id is null then
    raise exception using errcode = '22023', message = 'TORNEOS_PAYMENT_INVALID';
  end if;
  if v_purchase.status in ('approved','refunded','charged_back') then
    return public.tournament_purchase_projection(v_purchase)
      || jsonb_build_object('idempotentReplay',true,'ignoredOutOfOrder',true);
  end if;
  if v_purchase.status = p_status
    and v_purchase.provider_status is not distinct from left(btrim(p_provider_status),80)
    and v_purchase.provider_status_detail is not distinct from
      nullif(left(btrim(p_provider_status_detail),120),'') then
    return public.tournament_purchase_projection(v_purchase)
      || jsonb_build_object('idempotentReplay',true);
  end if;
  if v_purchase.status not in ('preference_created','pending') then
    raise exception using errcode = '55000', message = 'TORNEOS_PURCHASE_TRANSITION_INVALID';
  end if;
  v_from_status := v_purchase.status;
  update public.tournament_purchases set
    status = p_status,provider_status = left(btrim(p_provider_status),80),
    provider_status_detail = nullif(left(btrim(p_provider_status_detail),120),''),
    last_verified_at = now(),
    cancelled_at = case when p_status in ('rejected','cancelled','expired')
      then coalesce(cancelled_at,now()) else cancelled_at end
  where id = v_purchase.id returning * into v_purchase;
  insert into public.tournament_purchase_events (
    purchase_id,organization_id,event_type,from_status,to_status,provider_status,
    provider_status_detail,actor_type,metadata
  ) values (
    v_purchase.id,v_purchase.organization_id,'payment.' || p_status,v_from_status,
    p_status,v_purchase.provider_status,v_purchase.provider_status_detail,'provider',
    jsonb_build_object('providerPaymentId',p_provider_payment_id)
  );
  return public.tournament_purchase_projection(v_purchase)
    || jsonb_build_object('idempotentReplay',false);
end;
$$;

create or replace function public.apply_verified_tournament_payment_reversal(
  p_purchase_id uuid,
  p_provider text,
  p_provider_environment text,
  p_action text,
  p_provider_status text,
  p_provider_status_detail text,
  p_provider_payment_id text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_purchase public.tournament_purchases%rowtype; v_result jsonb;
begin
  select * into v_purchase from public.tournament_purchases
  where id = p_purchase_id for update;
  if v_purchase.id is null or v_purchase.provider <> p_provider
    or v_purchase.provider_environment <> p_provider_environment
    or v_purchase.approved_provider_payment_id is distinct from p_provider_payment_id then
    raise exception using errcode = '22023', message = 'TORNEOS_PURCHASE_INVALID';
  end if;
  v_result := public.apply_tournament_purchase_reversal(
    p_purchase_id,p_action,
    case p_action
      when 'refund' then 'Reembolso total verificado por el proveedor'
      when 'chargeback_disputed' then 'Contracargo verificado en disputa por el proveedor'
      when 'chargeback_restored' then 'Contracargo resuelto a favor de Arma2 por el proveedor'
      else 'Contracargo resuelto a favor del comprador por el proveedor'
    end
  );
  update public.tournament_purchases set
    provider_status = left(btrim(p_provider_status),80),
    provider_status_detail = nullif(left(btrim(p_provider_status_detail),120),''),
    last_verified_at = now()
  where id = p_purchase_id returning * into v_purchase;
  return public.tournament_purchase_projection(v_purchase)
    || jsonb_build_object(
      'idempotentReplay',coalesce((v_result->>'idempotentReplay')::boolean,false)
    );
end;
$$;

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

create or replace function public.apply_fake_tournament_payment_status(
  p_purchase_id uuid,
  p_status text,
  p_provider_status_detail text default null,
  p_provider_payment_id text default null,
  p_simulated_activation_error_code text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_environment text;
begin
  if p_status not in ('approved','pending','rejected','expired') then
    raise exception using errcode = '22023', message = 'TORNEOS_FAKE_STATUS_INVALID';
  end if;
  select provider_environment into v_environment
  from public.tournament_purchases where id = p_purchase_id and provider = 'FAKE';
  return public.apply_verified_tournament_payment_status(
    p_purchase_id,'FAKE',v_environment,p_status,p_status,p_provider_status_detail,
    p_provider_payment_id,p_simulated_activation_error_code
  );
end;
$$;

revoke all on function public.create_tournament_purchase(uuid,uuid,text,uuid,text,text)
  from public,anon;
revoke all on function public.record_tournament_purchase_preference(uuid,text,text,text,timestamptz)
  from public,anon,authenticated;
revoke all on function public.get_provider_tournament_purchase(text,text,text)
  from public,anon,authenticated;
revoke all on function public.activate_verified_tournament_purchase(uuid,text,text,text,text,text,text)
  from public,anon,authenticated;
revoke all on function public.apply_verified_tournament_payment_status(uuid,text,text,text,text,text,text,text)
  from public,anon,authenticated;
revoke all on function public.apply_verified_tournament_payment_reversal(uuid,text,text,text,text,text,text)
  from public,anon,authenticated;

grant execute on function public.create_tournament_purchase(uuid,uuid,text,uuid,text,text)
  to authenticated,service_role;
grant execute on function public.record_tournament_purchase_preference(uuid,text,text,text,timestamptz)
  to service_role;
grant execute on function public.get_provider_tournament_purchase(text,text,text)
  to service_role;
grant execute on function public.activate_verified_tournament_purchase(uuid,text,text,text,text,text,text)
  to service_role;
grant execute on function public.apply_verified_tournament_payment_status(uuid,text,text,text,text,text,text,text)
  to service_role;
grant execute on function public.apply_verified_tournament_payment_reversal(uuid,text,text,text,text,text,text)
  to service_role;

comment on function public.create_tournament_purchase(uuid,uuid,text,uuid,text,text) is
  'Authenticated server-authoritative purchase creation for explicitly allow-listed providers/environments.';
comment on function public.get_provider_tournament_purchase(text,text,text) is
  'Service-only provider lookup used after an independently verified payment API response.';

commit;
