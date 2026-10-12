-- ROLLBACK of 00000000000019_season_commerce.sql (documented, never automatic). Restores the 0013 bodies and the 0013
-- offer (launch v1 49900/39900); launch v2 is closed, never deleted (purchases may snapshot it). Payments already
-- recorded as 'season_closed' stay as they are (they are refunded by hand); no grant is created or removed.
BEGIN;
DO $pre$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('private.activate_production_tournament_purchase(uuid,text,text,text)')) IS DISTINCT FROM '5789b8dedcdb0df08f65f685b93e0ecb'
    OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.create_tournament_season_production_checkout_purchase(uuid,uuid,uuid)')) IS DISTINCT FROM '9bba694e95d0a55ade612431de57dd6d' THEN
    RAISE EXCEPTION 'TORNEOS_0019_ROLLBACK_PRECONDITION_FAILED: 0019 is not in force';
  END IF;
END $pre$;

UPDATE public.tournament_commercial_offers SET valid_until = now(), availability = 'unavailable'
WHERE product_code = 'torneos_premium' AND offer_code = 'launch' AND offer_version = 2;
UPDATE public.tournament_commercial_offers SET valid_until = NULL
WHERE product_code = 'torneos_premium' AND offer_code = 'launch' AND offer_version = 1;
UPDATE public.tournament_pricing_config SET list_price_minor = 49900, launch_price_minor = 39900, updated_at = now() WHERE config_key = 'v1';
ALTER TABLE public.tournament_pricing_config DROP CONSTRAINT tournament_pricing_config_prices_check;
ALTER TABLE public.tournament_pricing_config ADD CONSTRAINT tournament_pricing_config_prices_check
  CHECK (list_price_minor > 0 AND launch_price_minor > 0 AND launch_price_minor < list_price_minor);
COMMENT ON TABLE public.tournament_pricing_config IS 'Authoritative price: ARS 39,900, one-time per tournament season.';

CREATE OR REPLACE FUNCTION public.create_tournament_season_production_checkout_purchase(p_organization_id uuid, p_season_id uuid, p_idempotency_key uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_uid uuid := private.current_identity_id();
  v_scope text;
  v_expired integer := 0;
  v_blocked text;
  v_offer public.tournament_commercial_offers%rowtype;
  v_product public.tournament_commercial_products%rowtype;
  v_purchase public.tournament_purchases%rowtype;
  v_id uuid := pg_catalog.gen_random_uuid();
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  if p_organization_id is null or p_season_id is null
    or not exists (
      select 1 from public.tournament_seasons season
      where season.organization_id = p_organization_id and season.id = p_season_id
    )
    or not public.has_tournament_organization_capability(p_organization_id,'billing.manage')
    or not public.has_tournament_season_access(p_organization_id,p_season_id)
    or not public.has_tournament_season_capability(p_organization_id,p_season_id,'billing.manage') then
    raise exception using errcode = '42501', message = 'TORNEOS_BILLING_FORBIDDEN';
  end if;
  if p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'TORNEOS_PURCHASE_INVALID';
  end if;
  -- The operator switch: no production purchase exists while it is off (or the organization is not listed).
  select settings.checkout_scope into v_scope from public.tournament_commerce_production_settings settings where settings.singleton;
  if v_scope is distinct from 'open' and not (v_scope = 'allowlist' and exists (
    select 1 from public.tournament_commerce_production_allowlist allowed where allowed.organization_id = p_organization_id
  )) then
    raise exception using errcode = '55000', message = 'TORNEOS_BILLING_DISABLED';
  end if;
  -- One critical section per organization + season + product (the key the TEST wrapper and the baseline use).
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_organization_id::text || ':' || p_season_id::text || ':' || 'torneos_premium',79)
  );
  -- A purchased season grant blocks a new purchase until it is definitively revoked (same rule as TEST).
  select case when bool_or(public.is_tournament_season_plan_grant_effective(grant_row.id))
    then 'TORNEOS_SEASON_ALREADY_PREMIUM' else 'TORNEOS_SEASON_PREMIUM_SUSPENDED' end
  into v_blocked
  from public.tournament_season_plan_grants grant_row
  where grant_row.organization_id = p_organization_id and grant_row.season_id = p_season_id
    and grant_row.origin_purchase_id is not null
    and coalesce((
      select event.event_type from public.tournament_season_plan_grant_events event
      where event.season_grant_id = grant_row.id order by event.id desc limit 1
    ),'granted') <> 'revoked'
  having count(*) > 0;
  if v_blocked is not null then
    raise exception using errcode = '55000', message = v_blocked;
  end if;
  -- Any other effective grant of the season (historical / manual) also means Premium is already active.
  if exists (
    select 1 from public.tournament_season_plan_grants grant_row
    where grant_row.organization_id = p_organization_id and grant_row.season_id = p_season_id
      and public.is_tournament_season_plan_grant_effective(grant_row.id)
  ) then
    raise exception using errcode = '55000', message = 'TORNEOS_SEASON_ALREADY_PREMIUM';
  end if;
  -- Stale open purchases of the season expire exactly as in TEST: never while a known payment is still open.
  with stale as (
    update public.tournament_purchases purchase set
      status = case purchase.status when 'preference_created' then 'expired' else 'cancelled' end,
      cancelled_at = coalesce(purchase.cancelled_at,now()),
      last_verified_at = now()
    where purchase.organization_id = p_organization_id and purchase.season_id = p_season_id
      and purchase.product_code = 'torneos_premium'
      and purchase.status in ('created','preference_created')
      and purchase.preference_expires_at + interval '15 minutes' < now()
      and not exists (
        select 1 from public.tournament_purchase_events opened
        where opened.purchase_id = purchase.id and opened.event_type = 'payment.pending'
          and not exists (
            select 1 from public.tournament_purchase_events closed
            where closed.purchase_id = purchase.id
              and closed.event_type in ('payment.attempt_rejected','payment.attempt_cancelled','payment.attempt_expired','payment.approved')
              and closed.metadata->>'providerPaymentId' = opened.metadata->>'providerPaymentId'
          )
      )
    returning purchase.id,purchase.organization_id,purchase.season_id,purchase.status
  ), logged as (
    insert into public.tournament_purchase_events (
      purchase_id,organization_id,event_type,from_status,to_status,actor_type,metadata
    ) select stale.id,stale.organization_id,
      case stale.status when 'expired' then 'purchase.expired' else 'purchase.cancelled' end,
      case stale.status when 'expired' then 'preference_created' else 'created' end,
      stale.status,'service',
      jsonb_build_object('reason','stale_open_purchase','graceMinutes',15,'seasonId',stale.season_id)
    from stale returning 1
  )
  select count(*)::integer into v_expired from logged;
  -- Idempotency: the same buyer + key always answers the same purchase (double tap, retry, lost response).
  select * into v_purchase from public.tournament_purchases
  where buyer_user_id = v_uid and idempotency_key = p_idempotency_key;
  if v_purchase.id is not null then
    if v_purchase.organization_id <> p_organization_id or v_purchase.season_id <> p_season_id
      or v_purchase.product_code <> 'torneos_premium' or v_purchase.provider <> 'MERCADO_PAGO'
      or v_purchase.provider_environment <> 'production' then
      raise exception using errcode = '22023', message = 'TORNEOS_IDEMPOTENCY_CONFLICT';
    end if;
    return public.tournament_purchase_projection(v_purchase)
      || jsonb_build_object('idempotentReplay',true,'existingOpenPurchase',false,'expiredStalePurchases',v_expired);
  end if;
  -- One open purchase per season: whoever asks again (same or another manager) continues that one.
  select * into v_purchase from public.tournament_purchases
  where organization_id = p_organization_id and season_id = p_season_id
    and product_code = 'torneos_premium' and status in ('created','preference_created','pending')
  order by created_at limit 1 for update;
  if v_purchase.id is not null then
    if v_purchase.provider <> 'MERCADO_PAGO' or v_purchase.provider_environment <> 'production' then
      raise exception using errcode = '55000', message = 'TORNEOS_OPEN_PURCHASE_PROVIDER_CONFLICT';
    end if;
    return public.tournament_purchase_projection(v_purchase)
      || jsonb_build_object('idempotentReplay',false,'existingOpenPurchase',true,'expiredStalePurchases',v_expired);
  end if;
  select * into v_product from public.tournament_commercial_products
  where product_code = 'torneos_premium' and status = 'active';
  if v_product.product_code is null or v_product.plan_code <> 'PREMIUM'
    or v_product.scope <> 'season' or v_product.billing_model <> 'one_time' then
    raise exception using errcode = '22023', message = 'TORNEOS_PRODUCT_UNAVAILABLE';
  end if;
  select * into v_offer from public.tournament_commercial_offers offer
  where offer.product_code = 'torneos_premium' and offer.availability = 'available'
    and offer.valid_from <= statement_timestamp()
    and (offer.valid_until is null or offer.valid_until > statement_timestamp())
  order by offer.valid_from desc,offer.offer_version desc limit 1;
  if v_offer.product_code is null then
    raise exception using errcode = '22023', message = 'TORNEOS_OFFER_UNAVAILABLE';
  end if;
  insert into public.tournament_purchases (
    id,organization_id,season_id,tournament_id,buyer_user_id,product_code,
    offer_code,offer_version,list_amount_snapshot,amount_snapshot,currency,
    provider,provider_environment,external_reference,idempotency_key,status,
    preference_expires_at
  ) values (
    v_id,p_organization_id,p_season_id,null,v_uid,'torneos_premium',
    v_offer.offer_code,v_offer.offer_version,v_offer.list_amount,v_offer.amount,
    v_offer.currency,'MERCADO_PAGO','production',
    'arma2:season:purchase:' || v_id::text,p_idempotency_key,'created',
    now() + interval '30 minutes'
  ) returning * into v_purchase;
  insert into public.tournament_purchase_events (
    purchase_id,organization_id,event_type,from_status,to_status,actor_type,actor_user_id,metadata
  ) values (
    v_purchase.id,p_organization_id,'purchase.created',null,'created','user',v_uid,
    jsonb_build_object('seasonId',p_season_id,'environment','production')
  );
  return public.tournament_purchase_projection(v_purchase)
    || jsonb_build_object('idempotentReplay',false,'existingOpenPurchase',false,'expiredStalePurchases',v_expired);
end;
$$;

CREATE OR REPLACE FUNCTION private.activate_production_tournament_purchase(p_purchase_id uuid, p_provider_status text, p_provider_status_detail text, p_provider_payment_id text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_purchase public.tournament_purchases%rowtype;
  v_offer public.tournament_commercial_offers%rowtype;
  v_product public.tournament_commercial_products%rowtype;
  v_grant_id uuid;
  v_from_status text;
begin
  select * into v_purchase from public.tournament_purchases where id = p_purchase_id for update;
  if v_purchase.id is null or v_purchase.provider <> 'MERCADO_PAGO'
    or v_purchase.provider_environment <> 'production'
    or v_purchase.provider_preference_id is null or p_provider_payment_id is null then
    raise exception using errcode = '22023', message = 'TORNEOS_PURCHASE_INVALID';
  end if;
  if v_purchase.status = 'approved' and v_purchase.entitlement_activated_at is not null then
    if v_purchase.approved_provider_payment_id is distinct from p_provider_payment_id then
      raise exception using errcode = '55000', message = 'TORNEOS_PAYMENT_CONFLICT';
    end if;
    return public.tournament_purchase_projection(v_purchase) || jsonb_build_object('idempotentReplay',true);
  end if;
  if v_purchase.status not in ('preference_created','pending','approved') then
    raise exception using errcode = '55000', message = 'TORNEOS_PURCHASE_TRANSITION_INVALID';
  end if;
  v_from_status := v_purchase.status;
  update public.tournament_purchases
  set activation_attempts = activation_attempts + 1,last_verified_at = now()
  where id = v_purchase.id returning * into v_purchase;
  select * into v_offer from public.tournament_commercial_offers
  where product_code = v_purchase.product_code and offer_code = v_purchase.offer_code
    and offer_version = v_purchase.offer_version;
  select * into v_product from public.tournament_commercial_products
  where product_code = v_purchase.product_code;
  if v_offer.product_code is null or v_product.plan_code <> 'PREMIUM'
    or v_product.scope <> 'season' or v_product.billing_model <> 'one_time'
    or v_offer.list_amount <> v_purchase.list_amount_snapshot
    or v_offer.amount <> v_purchase.amount_snapshot
    or v_offer.currency <> v_purchase.currency then
    update public.tournament_purchases set activation_error_code = 'snapshot_mismatch'
    where id = v_purchase.id returning * into v_purchase;
    return public.tournament_purchase_projection(v_purchase);
  end if;
  v_grant_id := public.grant_tournament_season_premium(
    v_purchase.organization_id,v_purchase.season_id,v_purchase.id,
    'Pago ' || v_purchase.provider || ' verificado para la temporada y compra ' || v_purchase.id::text
  );
  insert into public.tournament_season_plan_grant_events (
    season_grant_id,purchase_id,event_type,reason_code,reason,actor_type
  ) select v_grant_id,v_purchase.id,'granted','payment_approved',
    'Premium de temporada activado por pago verificado','provider'
  where not exists (
    select 1 from public.tournament_season_plan_grant_events event
    where event.season_grant_id = v_grant_id and event.event_type = 'granted'
  );
  update public.tournament_purchases set
    status = 'approved',provider_status = left(btrim(p_provider_status),80),
    provider_status_detail = nullif(left(btrim(p_provider_status_detail),120),''),
    approved_provider_payment_id = coalesce(approved_provider_payment_id,p_provider_payment_id),
    approved_at = coalesce(approved_at,now()),activation_error_code = null,
    entitlement_activated_at = coalesce(entitlement_activated_at,now()),last_verified_at = now()
  where id = v_purchase.id returning * into v_purchase;
  insert into public.tournament_purchase_events (
    purchase_id,organization_id,event_type,from_status,to_status,provider_status,
    provider_status_detail,actor_type,metadata
  ) values (
    v_purchase.id,v_purchase.organization_id,'payment.approved',v_from_status,'approved',
    v_purchase.provider_status,v_purchase.provider_status_detail,'provider',
    jsonb_build_object('providerPaymentId',v_purchase.approved_provider_payment_id,
      'seasonGrantId',v_grant_id,'seasonId',v_purchase.season_id)
  );
  insert into public.tournament_audit_log (
    organization_id,actor_user_id,actor_type,action,resource_type,resource_id,
    tournament_id,metadata
  ) values (
    v_purchase.organization_id,null,'system','billing.season_purchase_activated',
    'tournament_purchase',v_purchase.id,v_purchase.tournament_id,
    jsonb_build_object('seasonGrantId',v_grant_id,'seasonId',v_purchase.season_id,'environment','production')
  );
  return public.tournament_purchase_projection(v_purchase) || jsonb_build_object('idempotentReplay',false);
end;
$$;

CREATE OR REPLACE FUNCTION public.get_tournament_season_purchases(p_organization_id uuid, p_season_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_uid uuid := private.current_identity_id();
  v_manage boolean;
  v_available boolean;
  v_items jsonb;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  if p_organization_id is null or p_season_id is null
    or not exists (
      select 1 from public.tournament_seasons season
      where season.organization_id = p_organization_id and season.id = p_season_id
    )
    or not public.has_tournament_season_access(p_organization_id,p_season_id) then
    raise exception using errcode = '42501', message = 'TORNEOS_PURCHASE_FORBIDDEN';
  end if;
  v_manage := public.has_tournament_organization_capability(p_organization_id,'billing.manage')
    and public.has_tournament_season_capability(p_organization_id,p_season_id,'billing.manage');
  select coalesce(jsonb_agg(item order by created_at desc), '[]'::jsonb) into v_items from (
    select purchase.created_at, jsonb_build_object(
      'id',purchase.id,'status',purchase.status,'provider',purchase.provider,
      'providerEnvironment',purchase.provider_environment,'productCode',purchase.product_code,
      'listAmount',purchase.list_amount_snapshot,'amount',purchase.amount_snapshot,'currency',purchase.currency,
      'providerStatus',purchase.provider_status,'preferenceExpiresAt',purchase.preference_expires_at,
      'approvedAt',purchase.approved_at,'entitlementActivatedAt',purchase.entitlement_activated_at,
      'refundedAt',purchase.refunded_at,'chargedBackAt',purchase.charged_back_at,'cancelledAt',purchase.cancelled_at,
      'createdAt',purchase.created_at,'updatedAt',purchase.updated_at,'boughtByMe',purchase.buyer_user_id = v_uid
    ) item
    from public.tournament_purchases purchase
    where purchase.organization_id = p_organization_id and purchase.season_id = p_season_id
      and purchase.product_code = 'torneos_premium'
      and (v_manage or purchase.buyer_user_id = v_uid)
    order by purchase.created_at desc
    limit 20
  ) listed;
  -- Whether a production purchase can start for this organization now (the operator switch): Mi plan never offers a
  -- payment the server would refuse.
  select settings.checkout_scope = 'open' or (settings.checkout_scope = 'allowlist' and exists (
    select 1 from public.tournament_commerce_production_allowlist allowed where allowed.organization_id = p_organization_id))
  into v_available
  from public.tournament_commerce_production_settings settings where settings.singleton;
  return jsonb_build_object('schemaVersion',1,'organizationId',p_organization_id,'seasonId',p_season_id,
    'canManageBilling',v_manage,'checkoutAvailable',coalesce(v_available,false),'purchases',v_items);
end;
$$;

DO $post$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.create_tournament_season_production_checkout_purchase(uuid,uuid,uuid)')) IS DISTINCT FROM 'fc9559b0c1fb1b070c13ab1be0bda395'
    OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('private.activate_production_tournament_purchase(uuid,text,text,text)')) IS DISTINCT FROM 'abe70db7fc988f0e06a505f63aeca330' THEN
    RAISE EXCEPTION 'TORNEOS_0019_ROLLBACK_POSTCONDITION_FAILED: 0013 bodies';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.get_tournament_season_purchases(uuid,uuid)')) IS DISTINCT FROM '484f63507d2e789bf0d15381c0a5d9ac' THEN
    RAISE EXCEPTION 'TORNEOS_0019_ROLLBACK_POSTCONDITION_FAILED: season purchases read';
  END IF;
END $post$;
COMMIT;
