-- Arma2 Torneos — COMMERCE-PRODUCTION: Mercado Pago Checkout Pro PRODUCTION, explicit and separate from TEST.
-- Applies after 0000 → 0011 (0012 is reserved for the gallery and is not required). Database only: no provider HTTP,
-- gateway route or frontend here.
--
-- What it adds (and nothing else):
--   * tournament_purchases_environment_check: MERCADO_PAGO may also be 'production'. FAKE local/qa and MERCADO_PAGO
--     test stay exactly as certified; every certified TEST function keeps its body (pinned by md5 before and after)
--     and keeps refusing anything that is not 'test'.
--   * Role torneos_payment_production_service: NOLOGIN NOINHERIT, no table privilege, EXECUTE on exactly seven
--     production service RPCs. Its login is created by the production bootstrap, never here. The TEST role
--     torneos_payment_service keeps exactly its four functions.
--   * Environment isolation on tournament_purchases (trigger): a session whose login is an explicit member of the TEST
--     payments role can only write MERCADO_PAGO/test rows, one of the production role only MERCADO_PAGO/production rows,
--     a member of both nothing. It closes the one generic path the TEST role could otherwise use on a production row
--     (the baseline record_tournament_purchase_preference) without changing that certified function.
--   * Checkout switch, outside any client reach: tournament_commerce_production_settings (singleton, installed 'off')
--     and tournament_commerce_production_allowlist. 'off' → no production purchase can be created; 'allowlist' → only
--     the listed organizations (first real charge); 'open' → every organization. Payment events, refunds, chargebacks
--     and reconciliation never depend on it: closing new sales never strands money already in flight.
--   * create_tournament_season_production_checkout_purchase: the only client entry point. Product, provider,
--     environment and price are fixed server-side (torneos_premium / MERCADO_PAGO / production / current offer); same
--     authorization, Premium block, stale sweep, idempotency and single-open-purchase rules as the TEST wrapper.
--   * get_tournament_season_purchases: what Mi plan needs to show a purchase in progress or a past one without
--     buying again (billing.manage sees the season's purchases; anyone else with season access only their own), and
--     whether the switch lets this organization start a production purchase now (checkoutAvailable).
--   * Production service RPCs (same domain policy as the certified MP-A2 + MP-B1.2 TEST chain, environment
--     'production'): purchase lookup, preference record, ordered status / reversal (provider date_last_updated
--     watermark), reconciliation candidates and per-purchase check claim/complete (throttle + bookkeeping in
--     tournament_purchase_provider_checks).
--
-- Fail-closed: the preconditions accept the certified TEST chain (bodies pinned) with no production object (first
-- application) or with every production object (re-application is a no-op that keeps the operator's switch);
-- anything else aborts before any change. Postconditions re-verify schema and ACL inside the same transaction.
BEGIN;

-- ============================================================================ 1. preconditions
DO $pre$
DECLARE
  v_missing text;
  v_environment_def text;
  v_present integer;
  v_expected text[] := array[
    'public.create_tournament_season_production_checkout_purchase(uuid,uuid,uuid)',
    'public.get_tournament_season_purchases(uuid,uuid)',
    'public.get_production_provider_tournament_purchase(text)',
    'public.record_production_tournament_purchase_preference(uuid,text,timestamp with time zone)',
    'public.apply_production_tournament_payment_status(uuid,text,text,text,text,timestamp with time zone)',
    'public.apply_production_tournament_payment_reversal(uuid,text,text,text,text,timestamp with time zone)',
    'public.list_production_tournament_purchases_to_reconcile(integer)',
    'public.claim_production_tournament_purchase_check(uuid,integer)',
    'public.complete_production_tournament_purchase_check(uuid,text)',
    'private.activate_production_tournament_purchase(uuid,text,text,text)',
    'private.unordered_production_tournament_payment_status(uuid,text,text,text,text)',
    'private.unordered_production_tournament_payment_reversal(uuid,text,text,text,text)',
    'private.order_production_tournament_payment(uuid,text,text,text,text,text,timestamp with time zone)',
    'private.enforce_tournament_purchase_payment_environment()'
  ];
BEGIN
  -- The certified TEST commercial chain (0000 + 0002 + 0003), byte for byte: production reuses its tables and its
  -- generic helpers and must never change what TEST certified.
  SELECT string_agg(signature || ' ' || coalesce(actual, 'absent'), ', ') INTO v_missing FROM (
    SELECT pin.signature, (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = to_regprocedure(pin.signature)) actual, pin.body_md5
    FROM (VALUES
      ('public.create_tournament_season_checkout_purchase(uuid,uuid,uuid)', 'ce838d427a83994f51c1366100d953ea'),
      ('public.get_provider_tournament_purchase(text,text,text)', 'c14da619edde527396a8080af422f048'),
      ('public.record_tournament_purchase_preference(uuid,text,text,text,timestamp with time zone)', '6eb78b1189e03b55545aa1057aafae8d'),
      ('public.unordered_tournament_payment_status(uuid,text,text,text,text,text,text)', '503d79f692d1417e4fa07b3f810ec192'),
      ('public.unordered_tournament_payment_reversal(uuid,text,text,text,text,text,text)', '1de0dd1965670d1fc08b52586765e248'),
      ('public.order_verified_tournament_payment(uuid,text,text,text,text,text,text,text,timestamp with time zone)', 'c1b838f976de3426c01cd3f0748bb512'),
      ('public.apply_verified_tournament_payment_status(uuid,text,text,text,text,text,text,timestamp with time zone)', '77fb95399a6df295832ae4125b39a140'),
      ('public.apply_verified_tournament_payment_reversal(uuid,text,text,text,text,text,text,timestamp with time zone)', '12d260171bf19be9737712abeaab293d'),
      ('public.activate_verified_tournament_purchase(uuid,text,text,text,text,text,text)', '8a97cc62c510971331eb19de2f83326b'),
      ('public.apply_tournament_purchase_reversal(uuid,text,text)', 'e4e8950b33c382bb771ced1905f168e2'),
      ('public.grant_tournament_season_premium(uuid,uuid,uuid,text)', 'e277a5b389da2a1bf8ee8bd4626ff6c4'),
      ('public.is_tournament_season_plan_grant_effective(uuid)', 'b401f53013e850cba1a833817bc34852'),
      ('public.tournament_purchase_projection(public.tournament_purchases)', 'c9eb6bb7eef92fec2453db95dec62043'),
      ('public.enforce_tournament_purchase_transition()', '2876e51dba7cc935ea2f0449d1b925aa'),
      ('public.protect_tournament_purchase_snapshots()', '1e9a3a1dade128748a4177fd8c8ec4d2'),
      ('public.has_tournament_organization_capability(uuid,text)', '2faa4bbaf76f0eb48f62d12e2f476e59'),
      ('public.has_tournament_season_access(uuid,uuid)', 'a24e268717406e5bb28fd8c303d94e9c'),
      ('public.has_tournament_season_capability(uuid,uuid,text)', '3c6e5d0a06d44dc68623f8baba78ce91')
    ) pin(signature, body_md5)
  ) s WHERE actual IS DISTINCT FROM body_md5;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION USING errcode = '55000', message = 'TORNEOS_MP_PRODUCTION_PRECONDITION_FAILED: certified TEST chain ' || v_missing;
  END IF;
  SELECT string_agg(r, ', ') INTO v_missing FROM unnest(array[
    'public.tournament_purchases', 'public.tournament_purchase_events', 'public.tournament_season_plan_grants',
    'public.tournament_season_plan_grant_events', 'public.tournament_commercial_products', 'public.tournament_commercial_offers',
    'public.tournament_payment_provider_watermarks', 'public.tournament_seasons', 'public.tournament_organizations', 'public.tournament_audit_log'
  ]) r WHERE to_regclass(r) IS NULL;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION USING errcode = '55000', message = 'TORNEOS_MP_PRODUCTION_PRECONDITION_FAILED: missing table(s) ' || v_missing;
  END IF;
  -- The TEST role executes exactly its four certified functions.
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_missing FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname IN ('public','private') AND has_function_privilege('torneos_payment_service', p.oid, 'EXECUTE')
    AND p.oid NOT IN ('public.get_provider_tournament_purchase(text,text,text)'::regprocedure,
      'public.record_tournament_purchase_preference(uuid,text,text,text,timestamp with time zone)'::regprocedure,
      'public.apply_verified_tournament_payment_status(uuid,text,text,text,text,text,text,timestamp with time zone)'::regprocedure,
      'public.apply_verified_tournament_payment_reversal(uuid,text,text,text,text,text,text,timestamp with time zone)'::regprocedure);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION USING errcode = '55000', message = 'TORNEOS_MP_PRODUCTION_PRECONDITION_FAILED: TEST role executes ' || v_missing;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tournament_commercial_products WHERE product_code = 'torneos_premium' AND plan_code = 'PREMIUM'
      AND scope = 'season' AND billing_model = 'one_time' AND status = 'active') THEN
    RAISE EXCEPTION USING errcode = '55000', message = 'TORNEOS_MP_PRODUCTION_PRECONDITION_FAILED: product torneos_premium';
  END IF;

  -- First application (no production object) or re-application (all of them): never a partial state.
  SELECT count(*) INTO v_present FROM unnest(v_expected) f WHERE to_regprocedure(f) IS NOT NULL;
  SELECT pg_get_constraintdef(oid) INTO v_environment_def FROM pg_constraint
  WHERE conrelid = 'public.tournament_purchases'::regclass AND conname = 'tournament_purchases_environment_check';
  IF v_present = 0 THEN
    IF v_environment_def IS DISTINCT FROM 'CHECK ((((provider = ''FAKE''::text) AND (provider_environment = ANY (ARRAY[''local''::text, ''qa''::text]))) OR ((provider = ''MERCADO_PAGO''::text) AND (provider_environment = ''test''::text))))'
      OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'torneos_payment_production_service')
      OR to_regclass('public.tournament_commerce_production_settings') IS NOT NULL
      OR to_regclass('public.tournament_commerce_production_allowlist') IS NOT NULL
      OR to_regclass('public.tournament_purchase_provider_checks') IS NOT NULL THEN
      RAISE EXCEPTION USING errcode = '55000', message = 'TORNEOS_MP_PRODUCTION_PRECONDITION_FAILED: partial production state (no function, other objects present)';
    END IF;
  ELSIF v_present = cardinality(v_expected) THEN
    IF v_environment_def IS DISTINCT FROM 'CHECK ((((provider = ''FAKE''::text) AND (provider_environment = ANY (ARRAY[''local''::text, ''qa''::text]))) OR ((provider = ''MERCADO_PAGO''::text) AND (provider_environment = ANY (ARRAY[''test''::text, ''production''::text])))))'
      OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'torneos_payment_production_service')
      OR to_regclass('public.tournament_commerce_production_settings') IS NULL
      OR to_regclass('public.tournament_commerce_production_allowlist') IS NULL
      OR to_regclass('public.tournament_purchase_provider_checks') IS NULL THEN
      RAISE EXCEPTION USING errcode = '55000', message = 'TORNEOS_MP_PRODUCTION_PRECONDITION_FAILED: partial production state (functions present, other objects missing)';
    END IF;
  ELSE
    RAISE EXCEPTION USING errcode = '55000', message = 'TORNEOS_MP_PRODUCTION_PRECONDITION_FAILED: partial production functions ' || v_present;
  END IF;
END $pre$;

-- ============================================================================ 2. production payment service role
DO $role$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'torneos_payment_production_service') THEN
    CREATE ROLE torneos_payment_production_service NOLOGIN NOINHERIT;
  END IF;
END $role$;
GRANT USAGE ON SCHEMA public TO torneos_payment_production_service;

-- ============================================================================ 3. environment CHECK
ALTER TABLE public.tournament_purchases DROP CONSTRAINT tournament_purchases_environment_check;
ALTER TABLE public.tournament_purchases ADD CONSTRAINT tournament_purchases_environment_check CHECK (
  (provider = 'FAKE' AND provider_environment IN ('local','qa'))
  OR (provider = 'MERCADO_PAGO' AND provider_environment IN ('test','production'))
);

-- ============================================================================ 4. operator switch and reconciliation bookkeeping
CREATE TABLE IF NOT EXISTS public.tournament_commerce_production_settings (
  singleton boolean PRIMARY KEY DEFAULT true
    CONSTRAINT tournament_commerce_production_settings_singleton_check CHECK (singleton),
  checkout_scope text NOT NULL DEFAULT 'off'
    CONSTRAINT tournament_commerce_production_settings_scope_check CHECK (checkout_scope IN ('off','allowlist','open')),
  reason text NOT NULL
    CONSTRAINT tournament_commerce_production_settings_reason_check CHECK (reason = btrim(reason) AND char_length(reason) BETWEEN 8 AND 200),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.tournament_commerce_production_settings (singleton, checkout_scope, reason)
VALUES (true, 'off', 'Instalado cerrado por 00000000000013') ON CONFLICT (singleton) DO NOTHING;
COMMENT ON TABLE public.tournament_commerce_production_settings IS
  'COMMERCE-PRODUCTION operator switch for NEW Mercado Pago production purchases (off | allowlist | open). Written only by the installer; payment events never depend on it.';

CREATE TABLE IF NOT EXISTS public.tournament_commerce_production_allowlist (
  organization_id uuid PRIMARY KEY REFERENCES public.tournament_organizations(id) ON DELETE CASCADE,
  reason text NOT NULL
    CONSTRAINT tournament_commerce_production_allowlist_reason_check CHECK (reason = btrim(reason) AND char_length(reason) BETWEEN 8 AND 200),
  added_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.tournament_commerce_production_allowlist IS
  'COMMERCE-PRODUCTION organizations that may buy while checkout_scope = allowlist (first real charge). Written only by the installer.';

CREATE TABLE IF NOT EXISTS public.tournament_purchase_provider_checks (
  purchase_id uuid PRIMARY KEY REFERENCES public.tournament_purchases(id),
  last_claimed_at timestamptz NOT NULL,
  last_completed_at timestamptz,
  last_outcome text CONSTRAINT tournament_purchase_provider_checks_outcome_check CHECK (last_outcome IS NULL OR last_outcome ~ '^[a-z][a-z0-9_]{1,59}$'),
  checks integer NOT NULL DEFAULT 0 CONSTRAINT tournament_purchase_provider_checks_count_check CHECK (checks >= 0)
);
COMMENT ON TABLE public.tournament_purchase_provider_checks IS
  'COMMERCE-PRODUCTION reconciliation bookkeeping: last provider check of a production purchase (throttle + monitoring). No payment data.';

ALTER TABLE public.tournament_commerce_production_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_commerce_production_allowlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_purchase_provider_checks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.tournament_commerce_production_settings, public.tournament_commerce_production_allowlist,
  public.tournament_purchase_provider_checks
  FROM PUBLIC, anon, authenticated, service_role, torneos_payment_service, torneos_payment_production_service;

-- ============================================================================ 5. environment isolation of payment logins
CREATE OR REPLACE FUNCTION private.enforce_tournament_purchase_payment_environment() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_test boolean;
  v_production boolean;
  v_environment text;
begin
  -- Explicit membership of the LOGIN (session_user cannot be changed by SET ROLE): a superuser or the installer is no
  -- explicit member and is never restricted here; PostgREST sessions (authenticator) are not either.
  select coalesce(bool_or(granted.rolname = 'torneos_payment_service'), false),
         coalesce(bool_or(granted.rolname = 'torneos_payment_production_service'), false)
  into v_test, v_production
  from pg_catalog.pg_auth_members link
  join pg_catalog.pg_roles granted on granted.oid = link.roleid
  join pg_catalog.pg_roles login on login.oid = link.member
  where login.rolname = session_user;
  if not v_test and not v_production then
    return new;
  end if;
  if v_test and v_production then
    raise exception using errcode = '42501', message = 'TORNEOS_PAYMENT_ENVIRONMENT_ISOLATION';
  end if;
  v_environment := case when v_production then 'production' else 'test' end;
  if new.provider <> 'MERCADO_PAGO' or new.provider_environment <> v_environment
    or (tg_op = 'UPDATE' and (old.provider <> 'MERCADO_PAGO' or old.provider_environment <> v_environment)) then
    raise exception using errcode = '42501', message = 'TORNEOS_PAYMENT_ENVIRONMENT_ISOLATION';
  end if;
  return new;
end;
$$;
DROP TRIGGER IF EXISTS tournament_purchases_payment_environment ON public.tournament_purchases;
CREATE TRIGGER tournament_purchases_payment_environment BEFORE INSERT OR UPDATE ON public.tournament_purchases
  FOR EACH ROW EXECUTE FUNCTION private.enforce_tournament_purchase_payment_environment();

-- ============================================================================ 6. client: production checkout purchase
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

-- ============================================================================ 7. client: purchases of a season (Mi plan)
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

-- ============================================================================ 8. production service internals (no grant)
-- Activation of a verified production payment: the baseline activation, environment 'production', no simulation hook.
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

-- The MP-A2 status policy (attempt outcomes, duplicates, after-close, stale), environment 'production'.
CREATE OR REPLACE FUNCTION private.unordered_production_tournament_payment_status(p_purchase_id uuid, p_status text, p_provider_status text, p_provider_status_detail text, p_provider_payment_id text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_purchase public.tournament_purchases%rowtype;
  v_payment text := nullif(btrim(p_provider_payment_id),'');
  v_provider_status text := left(btrim(coalesce(p_provider_status,'')),80);
  v_detail text := nullif(left(btrim(p_provider_status_detail),120),'');
  v_from text;
  v_target text;
  v_event text;
  v_outcome text;
  v_manual_refund boolean := false;
  v_touch boolean := false;
  v_result jsonb;
begin
  if p_status is null or p_status not in ('approved','pending','rejected','cancelled','expired') then
    raise exception using errcode = '22023', message = 'TORNEOS_PROVIDER_STATUS_INVALID';
  end if;
  if v_payment is null or char_length(v_payment) > 80 then
    raise exception using errcode = '22023', message = 'TORNEOS_PAYMENT_INVALID';
  end if;
  if char_length(v_provider_status) < 2 then v_provider_status := p_status; end if;
  select * into v_purchase from public.tournament_purchases where id = p_purchase_id for update;
  if v_purchase.id is null or v_purchase.provider <> 'MERCADO_PAGO' or v_purchase.provider_environment <> 'production' then
    raise exception using errcode = '22023', message = 'TORNEOS_PURCHASE_INVALID';
  end if;
  if v_purchase.status = 'created' then
    raise exception using errcode = '55000', message = 'TORNEOS_PURCHASE_NOT_READY';
  end if;
  v_from := v_purchase.status;
  v_target := v_purchase.status;

  if p_status = 'approved' and v_purchase.status in ('preference_created','pending') then
    if exists (
      select 1 from public.tournament_purchases other
      where other.provider = 'MERCADO_PAGO' and other.provider_environment = 'production'
        and other.approved_provider_payment_id = v_payment and other.id <> v_purchase.id
    ) then
      raise exception using errcode = '22023', message = 'TORNEOS_PAYMENT_CONFLICT';
    end if;
    v_result := private.activate_production_tournament_purchase(v_purchase.id,v_provider_status,v_detail,v_payment);
    select * into v_purchase from public.tournament_purchases where id = p_purchase_id;
    return v_result || jsonb_build_object(
      'outcome',case when v_purchase.status = 'approved' then 'approved' else 'activation_failed' end,
      'stateChanged',v_purchase.status <> v_from,'idempotentReplay',false,
      'requiresManualRefund',false,'requiresManualReview',v_purchase.status <> 'approved'
    );
  end if;

  if p_status = 'approved' then
    if v_purchase.status in ('approved','refunded','charged_back')
      and v_purchase.approved_provider_payment_id = v_payment then
      if v_purchase.status = 'approved' then
        v_outcome := 'duplicate_approved'; v_event := 'payment.approved_duplicate';
      else
        v_outcome := 'stale_ignored'; v_event := 'payment.stale_status_ignored';
      end if;
    elsif v_purchase.status in ('approved','refunded','charged_back') then
      v_outcome := 'duplicate_payment'; v_event := 'payment.approved_duplicate_payment'; v_manual_refund := true;
    else
      v_outcome := 'approved_after_close'; v_event := 'payment.approved_after_close'; v_manual_refund := true;
    end if;
  elsif v_purchase.status not in ('preference_created','pending') then
    v_outcome := 'stale_ignored'; v_event := 'payment.stale_status_ignored';
  elsif p_status = 'pending' then
    if exists (
      select 1 from public.tournament_purchase_events e
      where e.purchase_id = v_purchase.id
        and e.event_type in ('payment.attempt_rejected','payment.attempt_cancelled','payment.attempt_expired','payment.approved')
        and e.metadata->>'providerPaymentId' = v_payment
    ) then
      v_outcome := 'stale_ignored'; v_event := 'payment.stale_status_ignored';
    else
      v_outcome := 'pending'; v_event := 'payment.pending'; v_target := 'pending'; v_touch := true;
    end if;
  else
    v_outcome := 'attempt_' || p_status; v_event := 'payment.attempt_' || p_status;
    if v_purchase.status = 'pending' and not exists (
      select 1 from public.tournament_purchase_events opened
      where opened.purchase_id = v_purchase.id and opened.event_type = 'payment.pending'
        and opened.metadata->>'providerPaymentId' is distinct from v_payment
        and not exists (
          select 1 from public.tournament_purchase_events closed
          where closed.purchase_id = v_purchase.id
            and closed.event_type in ('payment.attempt_rejected','payment.attempt_cancelled','payment.attempt_expired','payment.approved')
            and closed.metadata->>'providerPaymentId' = opened.metadata->>'providerPaymentId'
        )
    ) then
      v_target := 'preference_created';
    end if;
    v_touch := v_purchase.status = 'preference_created' or v_target <> v_purchase.status;
  end if;

  if exists (
    select 1 from public.tournament_purchase_events e
    where e.purchase_id = v_purchase.id and e.event_type = v_event
      and e.metadata->>'providerPaymentId' = v_payment and e.metadata->>'status' = p_status
  ) then
    return public.tournament_purchase_projection(v_purchase) || jsonb_build_object(
      'outcome',v_outcome,'stateChanged',false,'idempotentReplay',true,
      'requiresManualRefund',v_manual_refund,'requiresManualReview',false
    );
  end if;
  if v_touch then
    update public.tournament_purchases set
      status = v_target,provider_status = v_provider_status,provider_status_detail = v_detail,
      last_verified_at = now()
    where id = v_purchase.id returning * into v_purchase;
  end if;
  insert into public.tournament_purchase_events (
    purchase_id,organization_id,event_type,from_status,to_status,provider_status,
    provider_status_detail,actor_type,metadata
  ) values (
    v_purchase.id,v_purchase.organization_id,v_event,v_from,v_purchase.status,v_provider_status,
    v_detail,'provider',
    jsonb_build_object('providerPaymentId',v_payment,'status',p_status,'seasonId',v_purchase.season_id)
      || case when v_manual_refund then jsonb_build_object('requiresManualRefund',true) else '{}'::jsonb end
  );
  return public.tournament_purchase_projection(v_purchase) || jsonb_build_object(
    'outcome',v_outcome,'stateChanged',v_purchase.status <> v_from,'idempotentReplay',false,
    'requiresManualRefund',v_manual_refund,'requiresManualReview',false
  );
end;
$$;

-- The MP-A2 reversal policy (refund / chargeback through the generic baseline reversal), environment 'production'.
CREATE OR REPLACE FUNCTION private.unordered_production_tournament_payment_reversal(p_purchase_id uuid, p_action text, p_provider_status text, p_provider_status_detail text, p_provider_payment_id text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_purchase public.tournament_purchases%rowtype;
  v_payment text := nullif(btrim(p_provider_payment_id),'');
  v_provider_status text := left(btrim(coalesce(p_provider_status,'')),80);
  v_detail text := nullif(left(btrim(p_provider_status_detail),120),'');
  v_last text;
  v_event text;
  v_outcome text;
  v_error text;
  v_manual_review boolean := false;
  v_result jsonb;
begin
  if p_action is null or p_action not in ('refund','chargeback_disputed','chargeback_restored','chargeback_buyer_won') then
    raise exception using errcode = '22023', message = 'TORNEOS_REVERSAL_INVALID';
  end if;
  if v_payment is null or char_length(v_payment) > 80 then
    raise exception using errcode = '22023', message = 'TORNEOS_PAYMENT_INVALID';
  end if;
  if char_length(v_provider_status) < 2 then v_provider_status := p_action; end if;
  select * into v_purchase from public.tournament_purchases where id = p_purchase_id for update;
  if v_purchase.id is null or v_purchase.provider <> 'MERCADO_PAGO' or v_purchase.provider_environment <> 'production' then
    raise exception using errcode = '22023', message = 'TORNEOS_PURCHASE_INVALID';
  end if;

  if v_purchase.entitlement_activated_at is null then
    v_outcome := 'reversal_without_activation'; v_event := 'payment.reversal_without_activation';
  elsif v_purchase.approved_provider_payment_id is distinct from v_payment then
    v_outcome := 'reversal_other_payment'; v_event := 'payment.reversal_other_payment';
  else
    select event.event_type into v_last
    from public.tournament_season_plan_grant_events event
    join public.tournament_season_plan_grants grant_row on grant_row.id = event.season_grant_id
    where grant_row.origin_purchase_id = v_purchase.id
    order by event.id desc limit 1;
    if v_last = 'revoked' and p_action in ('chargeback_disputed','chargeback_restored') then
      v_outcome := 'reversal_ignored_after_revocation'; v_event := 'payment.reversal_ignored_after_revocation';
    else
      begin
        v_result := public.apply_tournament_purchase_reversal(
          v_purchase.id,p_action,
          case p_action
            when 'refund' then 'Reembolso total verificado por el proveedor'
            when 'chargeback_disputed' then 'Contracargo verificado en disputa por el proveedor'
            when 'chargeback_restored' then 'Contracargo resuelto a favor de Arma2 por el proveedor'
            else 'Contracargo resuelto a favor del comprador por el proveedor'
          end
        );
      exception when object_not_in_prerequisite_state then
        get stacked diagnostics v_error = message_text;
        v_outcome := 'reversal_conflict'; v_event := 'payment.reversal_conflict'; v_manual_review := true;
      end;
      if v_result is not null then
        update public.tournament_purchases set
          provider_status = v_provider_status,provider_status_detail = v_detail,last_verified_at = now()
        where id = v_purchase.id returning * into v_purchase;
        return public.tournament_purchase_projection(v_purchase) || jsonb_build_object(
          'outcome','reversal_applied',
          'stateChanged',not coalesce((v_result->>'idempotentReplay')::boolean,false),
          'idempotentReplay',coalesce((v_result->>'idempotentReplay')::boolean,false),
          'requiresManualRefund',false,'requiresManualReview',false
        );
      end if;
    end if;
  end if;

  if exists (
    select 1 from public.tournament_purchase_events e
    where e.purchase_id = v_purchase.id and e.event_type = v_event
      and e.metadata->>'providerPaymentId' = v_payment and e.metadata->>'status' = p_action
  ) then
    return public.tournament_purchase_projection(v_purchase) || jsonb_build_object(
      'outcome',v_outcome,'stateChanged',false,'idempotentReplay',true,
      'requiresManualRefund',false,'requiresManualReview',v_manual_review
    );
  end if;
  insert into public.tournament_purchase_events (
    purchase_id,organization_id,event_type,from_status,to_status,provider_status,
    provider_status_detail,actor_type,metadata
  ) values (
    v_purchase.id,v_purchase.organization_id,v_event,v_purchase.status,v_purchase.status,
    v_provider_status,v_detail,'provider',
    jsonb_build_object('providerPaymentId',v_payment,'status',p_action,'seasonId',v_purchase.season_id)
      || case when v_error is not null then jsonb_build_object('error',left(v_error,120)) else '{}'::jsonb end
  );
  return public.tournament_purchase_projection(v_purchase) || jsonb_build_object(
    'outcome',v_outcome,'stateChanged',false,'idempotentReplay',false,
    'requiresManualRefund',false,'requiresManualReview',v_manual_review
  );
end;
$$;

-- The MP-B1.2 ordering (per payment provider date_last_updated watermark, durable review), environment 'production'.
CREATE OR REPLACE FUNCTION private.order_production_tournament_payment(p_purchase_id uuid, p_kind text, p_state text, p_provider_status text, p_provider_status_detail text, p_provider_payment_id text, p_date_last_updated timestamptz) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_purchase public.tournament_purchases%rowtype;
  v_previous public.tournament_payment_provider_watermarks%rowtype;
  v_payment text := nullif(btrim(p_provider_payment_id), '');
  v_state jsonb := jsonb_build_array(p_kind,p_state);
  v_result jsonb;
  v_event text;
  v_anomaly boolean;
BEGIN
  IF p_date_last_updated IS NULL OR NOT isfinite(p_date_last_updated) THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'TORNEOS_PROVIDER_ORDERING_REQUIRED';
  END IF;
  IF v_payment IS NULL OR length(v_payment) > 80 THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'TORNEOS_PAYMENT_INVALID';
  END IF;
  IF p_kind = 'status' AND (p_state IS NULL OR p_state NOT IN ('approved','pending','rejected','cancelled','expired')) THEN
    RAISE EXCEPTION USING errcode='22023', message='TORNEOS_PROVIDER_STATUS_INVALID';
  ELSIF p_kind = 'reversal' AND (p_state IS NULL OR p_state NOT IN ('refund','chargeback_disputed','chargeback_restored','chargeback_buyer_won')) THEN
    RAISE EXCEPTION USING errcode='22023', message='TORNEOS_REVERSAL_INVALID';
  ELSIF p_kind IS NULL OR p_kind NOT IN ('status','reversal') THEN
    RAISE EXCEPTION USING errcode='22023', message='TORNEOS_PROVIDER_STATUS_INVALID';
  END IF;
  SELECT * INTO v_purchase FROM public.tournament_purchases WHERE id = p_purchase_id FOR UPDATE;
  IF v_purchase.id IS NULL OR v_purchase.provider <> 'MERCADO_PAGO' OR v_purchase.provider_environment <> 'production' THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'TORNEOS_PURCHASE_INVALID';
  END IF;
  SELECT * INTO v_previous FROM public.tournament_payment_provider_watermarks
    WHERE purchase_id = p_purchase_id AND provider_payment_id = v_payment;
  IF v_previous.date_last_updated >= p_date_last_updated THEN
    v_anomaly := v_previous.date_last_updated = p_date_last_updated AND v_previous.snapshot_state <> v_state;
    IF v_anomaly THEN
      UPDATE public.tournament_payment_provider_watermarks SET requires_manual_review=true
        WHERE purchase_id=p_purchase_id AND provider_payment_id=v_payment;
      v_previous.requires_manual_review := true;
    END IF;
    v_event := CASE WHEN v_anomaly THEN 'payment.provider_ordering_anomaly'
      WHEN v_previous.date_last_updated > p_date_last_updated THEN 'payment.stale_status_ignored' END;
    IF v_event IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.tournament_purchase_events e WHERE e.purchase_id=p_purchase_id AND e.event_type=v_event
        AND e.metadata->>'providerPaymentId'=v_payment
        AND (e.metadata->>'providerDateLastUpdated')::timestamptz=p_date_last_updated
        AND e.metadata->'incomingState'=v_state
    ) THEN
      INSERT INTO public.tournament_purchase_events (purchase_id,organization_id,event_type,from_status,to_status,actor_type,metadata)
      VALUES (p_purchase_id,v_purchase.organization_id,v_event,v_purchase.status,v_purchase.status,'provider',
        jsonb_build_object('providerPaymentId',v_payment,'providerDateLastUpdated',p_date_last_updated,
          'storedDateLastUpdated',v_previous.date_last_updated,'incomingState',v_state,'storedState',v_previous.snapshot_state));
    END IF;
    RETURN public.tournament_purchase_projection(v_purchase) || jsonb_build_object(
      'outcome', CASE
        WHEN v_previous.date_last_updated > p_date_last_updated THEN 'stale_ignored'
        WHEN v_previous.snapshot_state = v_state THEN 'provider_snapshot_duplicate'
        ELSE 'provider_ordering_anomaly' END,
      'stateChanged',false,
      'idempotentReplay',v_previous.date_last_updated = p_date_last_updated AND v_previous.snapshot_state = v_state,
      'requiresManualRefund',v_previous.requires_manual_refund,
      'requiresManualReview',v_previous.requires_manual_review OR (v_previous.date_last_updated = p_date_last_updated AND v_previous.snapshot_state <> v_state)
    );
  END IF;
  IF p_kind = 'status' THEN
    v_result := private.unordered_production_tournament_payment_status(p_purchase_id,p_state,p_provider_status,p_provider_status_detail,v_payment);
  ELSE
    v_result := private.unordered_production_tournament_payment_reversal(p_purchase_id,p_state,p_provider_status,p_provider_status_detail,v_payment);
  END IF;
  v_result := v_result || jsonb_build_object('requiresManualReview',
    coalesce(v_previous.requires_manual_review,false) OR coalesce((v_result->>'requiresManualReview')::boolean,false));
  INSERT INTO public.tournament_payment_provider_watermarks VALUES (p_purchase_id,v_payment,p_date_last_updated,v_state,coalesce((v_result->>'requiresManualRefund')::boolean,false),coalesce((v_result->>'requiresManualReview')::boolean,false))
    ON CONFLICT (purchase_id,provider_payment_id) DO UPDATE
    SET date_last_updated = excluded.date_last_updated, snapshot_state = excluded.snapshot_state,
        requires_manual_refund = excluded.requires_manual_refund, requires_manual_review = excluded.requires_manual_review;
  RETURN v_result;
END;
$$;

-- ============================================================================ 9. production service RPCs (production role only)
CREATE OR REPLACE FUNCTION public.get_production_provider_tournament_purchase(p_external_reference text) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_purchase public.tournament_purchases%rowtype;
begin
  select * into v_purchase from public.tournament_purchases
  where external_reference = p_external_reference
    and provider = 'MERCADO_PAGO' and provider_environment = 'production';
  if v_purchase.id is null then
    raise exception using errcode = 'P0002', message = 'TORNEOS_PURCHASE_NOT_FOUND';
  end if;
  return public.tournament_purchase_projection(v_purchase);
end;
$$;

CREATE OR REPLACE FUNCTION public.record_production_tournament_purchase_preference(p_purchase_id uuid, p_provider_preference_id text, p_preference_expires_at timestamptz) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_purchase public.tournament_purchases%rowtype;
begin
  if p_provider_preference_id is null
    or char_length(btrim(p_provider_preference_id)) not between 3 and 200 then
    raise exception using errcode = '22023', message = 'TORNEOS_PREFERENCE_INVALID';
  end if;
  if p_preference_expires_at is null or not isfinite(p_preference_expires_at) then
    raise exception using errcode = '22023', message = 'TORNEOS_PREFERENCE_INVALID';
  end if;
  select * into v_purchase from public.tournament_purchases where id = p_purchase_id for update;
  if v_purchase.id is null or v_purchase.provider <> 'MERCADO_PAGO' or v_purchase.provider_environment <> 'production' then
    raise exception using errcode = '22023', message = 'TORNEOS_PURCHASE_INVALID';
  end if;
  if v_purchase.provider_preference_id is not null then
    if v_purchase.provider_preference_id <> btrim(p_provider_preference_id) then
      raise exception using errcode = '55000', message = 'TORNEOS_PREFERENCE_CONFLICT';
    end if;
    return public.tournament_purchase_projection(v_purchase) || jsonb_build_object('idempotentReplay',true);
  end if;
  if v_purchase.status <> 'created' then
    raise exception using errcode = '55000', message = 'TORNEOS_PURCHASE_TRANSITION_INVALID';
  end if;
  update public.tournament_purchases set
    status = 'preference_created',provider_status = 'created',
    provider_preference_id = btrim(p_provider_preference_id),
    preference_expires_at = p_preference_expires_at,
    last_verified_at = now()
  where id = v_purchase.id returning * into v_purchase;
  insert into public.tournament_purchase_events (
    purchase_id,organization_id,event_type,from_status,to_status,provider_status,actor_type
  ) values (
    v_purchase.id,v_purchase.organization_id,'preference.created','created','preference_created','created','service'
  );
  return public.tournament_purchase_projection(v_purchase) || jsonb_build_object('idempotentReplay',false);
end;
$$;

CREATE OR REPLACE FUNCTION public.apply_production_tournament_payment_status(p_purchase_id uuid, p_status text, p_provider_status text, p_provider_status_detail text, p_provider_payment_id text, p_date_last_updated timestamptz) RETURNS jsonb
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT private.order_production_tournament_payment(p_purchase_id,'status',p_status,p_provider_status,p_provider_status_detail,p_provider_payment_id,p_date_last_updated);
$$;

CREATE OR REPLACE FUNCTION public.apply_production_tournament_payment_reversal(p_purchase_id uuid, p_action text, p_provider_status text, p_provider_status_detail text, p_provider_payment_id text, p_date_last_updated timestamptz) RETURNS jsonb
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT private.order_production_tournament_payment(p_purchase_id,'reversal',p_action,p_provider_status,p_provider_status_detail,p_provider_payment_id,p_date_last_updated);
$$;

-- Reconciliation candidates, least recently checked first: open purchases (after a 2-minute head start for the webhook,
-- at most every 10 minutes), approved / disputed ones of the last 200 days (refunds and chargebacks, every 6 hours) and
-- purchases closed in the last 7 days (a late approval must surface as requiresManualRefund, every hour).
CREATE OR REPLACE FUNCTION public.list_production_tournament_purchases_to_reconcile(p_limit integer) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select coalesce(jsonb_agg(candidate.item order by candidate.claimed, candidate.created_at), '[]'::jsonb)
  from (
    select public.tournament_purchase_projection(purchase)
        || jsonb_build_object('lastCheckedAt',checked.last_completed_at,'lastCheckOutcome',checked.last_outcome) as item,
      coalesce(checked.last_claimed_at,'-infinity'::timestamptz) as claimed, purchase.created_at
    from public.tournament_purchases purchase
    left join public.tournament_purchase_provider_checks checked on checked.purchase_id = purchase.id
    where purchase.provider = 'MERCADO_PAGO' and purchase.provider_environment = 'production'
      and purchase.provider_preference_id is not null
      and (
        (purchase.status in ('preference_created','pending') and purchase.updated_at < now() - interval '2 minutes'
          and coalesce(checked.last_claimed_at,'-infinity'::timestamptz) < now() - interval '10 minutes')
        or (purchase.status in ('approved','charged_back') and purchase.approved_at > now() - interval '200 days'
          and coalesce(checked.last_claimed_at,'-infinity'::timestamptz) < now() - interval '6 hours')
        or (purchase.status in ('expired','cancelled','rejected') and purchase.updated_at > now() - interval '7 days'
          and coalesce(checked.last_claimed_at,'-infinity'::timestamptz) < now() - interval '1 hour')
      )
    order by coalesce(checked.last_claimed_at,'-infinity'::timestamptz), purchase.created_at
    limit least(greatest(coalesce(p_limit,20),1),50)
  ) candidate;
$$;

-- Atomic throttle: claims the provider check of one production purchase unless another check claimed it less than
-- p_min_interval_seconds ago (the webhook, the cron and the buyer's refresh can never stampede Mercado Pago).
CREATE OR REPLACE FUNCTION public.claim_production_tournament_purchase_check(p_purchase_id uuid, p_min_interval_seconds integer) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_purchase public.tournament_purchases%rowtype;
  v_claimed boolean := false;
begin
  if p_min_interval_seconds is null or p_min_interval_seconds < 0 or p_min_interval_seconds > 86400 then
    raise exception using errcode = '22023', message = 'TORNEOS_CHECK_INTERVAL_INVALID';
  end if;
  select * into v_purchase from public.tournament_purchases where id = p_purchase_id;
  if v_purchase.id is null or v_purchase.provider <> 'MERCADO_PAGO' or v_purchase.provider_environment <> 'production' then
    raise exception using errcode = '22023', message = 'TORNEOS_PURCHASE_INVALID';
  end if;
  insert into public.tournament_purchase_provider_checks as checked (purchase_id,last_claimed_at,checks)
  values (p_purchase_id,now(),0)
  on conflict (purchase_id) do update set last_claimed_at = now()
    where checked.last_claimed_at < now() - pg_catalog.make_interval(secs => p_min_interval_seconds)
  returning true into v_claimed;
  return public.tournament_purchase_projection(v_purchase) || jsonb_build_object('claimed',coalesce(v_claimed,false));
end;
$$;

CREATE OR REPLACE FUNCTION public.complete_production_tournament_purchase_check(p_purchase_id uuid, p_outcome text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_checks integer;
begin
  if p_outcome is null or p_outcome !~ '^[a-z][a-z0-9_]{1,59}$' then
    raise exception using errcode = '22023', message = 'TORNEOS_CHECK_OUTCOME_INVALID';
  end if;
  update public.tournament_purchase_provider_checks set
    last_completed_at = now(),last_outcome = p_outcome,checks = checks + 1
  where purchase_id = p_purchase_id
  returning checks into v_checks;
  if v_checks is null then
    raise exception using errcode = 'P0002', message = 'TORNEOS_CHECK_NOT_CLAIMED';
  end if;
  return jsonb_build_object('purchaseId',p_purchase_id,'checks',v_checks,'outcome',p_outcome);
end;
$$;

COMMENT ON FUNCTION public.create_tournament_season_production_checkout_purchase(uuid,uuid,uuid) IS
  'COMMERCE-PRODUCTION client checkout: MERCADO_PAGO/production/torneos_premium fixed server-side, gated by the operator switch; same rules as the TEST wrapper.';
COMMENT ON FUNCTION public.get_tournament_season_purchases(uuid,uuid) IS
  'COMMERCE-PRODUCTION: purchases of one season for Mi plan (billing.manage: all; otherwise only the caller''s own). No payer data.';
COMMENT ON FUNCTION public.apply_production_tournament_payment_status(uuid,text,text,text,text,timestamp with time zone) IS
  'COMMERCE-PRODUCTION payments service: verified, server-refetched status with the provider ordering timestamp; MP-A2 policy.';
COMMENT ON FUNCTION public.apply_production_tournament_payment_reversal(uuid,text,text,text,text,timestamp with time zone) IS
  'COMMERCE-PRODUCTION payments service: verified refund / chargeback with the provider ordering timestamp; MP-A2 policy.';

-- ============================================================================ 10. ACL
DO $acl$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY array[
    'public.create_tournament_season_production_checkout_purchase(uuid,uuid,uuid)',
    'public.get_tournament_season_purchases(uuid,uuid)',
    'public.get_production_provider_tournament_purchase(text)',
    'public.record_production_tournament_purchase_preference(uuid,text,timestamp with time zone)',
    'public.apply_production_tournament_payment_status(uuid,text,text,text,text,timestamp with time zone)',
    'public.apply_production_tournament_payment_reversal(uuid,text,text,text,text,timestamp with time zone)',
    'public.list_production_tournament_purchases_to_reconcile(integer)',
    'public.claim_production_tournament_purchase_check(uuid,integer)',
    'public.complete_production_tournament_purchase_check(uuid,text)',
    'private.activate_production_tournament_purchase(uuid,text,text,text)',
    'private.unordered_production_tournament_payment_status(uuid,text,text,text,text)',
    'private.unordered_production_tournament_payment_reversal(uuid,text,text,text,text)',
    'private.order_production_tournament_payment(uuid,text,text,text,text,text,timestamp with time zone)',
    'private.enforce_tournament_purchase_payment_environment()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role, torneos_payment_service, torneos_payment_production_service', f);
  END LOOP;
END $acl$;
GRANT EXECUTE ON FUNCTION public.create_tournament_season_production_checkout_purchase(uuid,uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_tournament_season_purchases(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_production_provider_tournament_purchase(text) TO torneos_payment_production_service;
GRANT EXECUTE ON FUNCTION public.record_production_tournament_purchase_preference(uuid,text,timestamp with time zone) TO torneos_payment_production_service;
GRANT EXECUTE ON FUNCTION public.apply_production_tournament_payment_status(uuid,text,text,text,text,timestamp with time zone) TO torneos_payment_production_service;
GRANT EXECUTE ON FUNCTION public.apply_production_tournament_payment_reversal(uuid,text,text,text,text,timestamp with time zone) TO torneos_payment_production_service;
GRANT EXECUTE ON FUNCTION public.list_production_tournament_purchases_to_reconcile(integer) TO torneos_payment_production_service;
GRANT EXECUTE ON FUNCTION public.claim_production_tournament_purchase_check(uuid,integer) TO torneos_payment_production_service;
GRANT EXECUTE ON FUNCTION public.complete_production_tournament_purchase_check(uuid,text) TO torneos_payment_production_service;

-- ============================================================================ 11. postconditions
DO $post$
DECLARE
  v_bad text;
BEGIN
  SELECT string_agg(x, ', ') INTO v_bad FROM (
    SELECT 'environment CHECK' x WHERE (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'public.tournament_purchases'::regclass AND conname = 'tournament_purchases_environment_check')
      IS DISTINCT FROM 'CHECK ((((provider = ''FAKE''::text) AND (provider_environment = ANY (ARRAY[''local''::text, ''qa''::text]))) OR ((provider = ''MERCADO_PAGO''::text) AND (provider_environment = ANY (ARRAY[''test''::text, ''production''::text])))))'
    UNION ALL SELECT 'isolation trigger' WHERE NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.tournament_purchases'::regclass
      AND tgname = 'tournament_purchases_payment_environment' AND tgenabled = 'O')
    UNION ALL SELECT 'settings row' WHERE (SELECT count(*) FROM public.tournament_commerce_production_settings) <> 1
    -- TEST chain untouched
    UNION ALL SELECT 'TEST body ' || pin.signature FROM (VALUES
      ('public.create_tournament_season_checkout_purchase(uuid,uuid,uuid)', 'ce838d427a83994f51c1366100d953ea'),
      ('public.get_provider_tournament_purchase(text,text,text)', 'c14da619edde527396a8080af422f048'),
      ('public.record_tournament_purchase_preference(uuid,text,text,text,timestamp with time zone)', '6eb78b1189e03b55545aa1057aafae8d'),
      ('public.unordered_tournament_payment_status(uuid,text,text,text,text,text,text)', '503d79f692d1417e4fa07b3f810ec192'),
      ('public.unordered_tournament_payment_reversal(uuid,text,text,text,text,text,text)', '1de0dd1965670d1fc08b52586765e248'),
      ('public.order_verified_tournament_payment(uuid,text,text,text,text,text,text,text,timestamp with time zone)', 'c1b838f976de3426c01cd3f0748bb512'),
      ('public.apply_verified_tournament_payment_status(uuid,text,text,text,text,text,text,timestamp with time zone)', '77fb95399a6df295832ae4125b39a140'),
      ('public.apply_verified_tournament_payment_reversal(uuid,text,text,text,text,text,text,timestamp with time zone)', '12d260171bf19be9737712abeaab293d'),
      ('public.activate_verified_tournament_purchase(uuid,text,text,text,text,text,text)', '8a97cc62c510971331eb19de2f83326b')
    ) pin(signature, body_md5) WHERE (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = to_regprocedure(pin.signature)) IS DISTINCT FROM pin.body_md5
    -- new functions: installer-owned, fixed empty search_path, never PUBLIC; every one but the trigger is SECURITY DEFINER
    UNION ALL SELECT 'function shape ' || p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE ((n.nspname = 'public' AND p.proname IN ('create_tournament_season_production_checkout_purchase', 'get_tournament_season_purchases',
          'get_production_provider_tournament_purchase', 'record_production_tournament_purchase_preference', 'apply_production_tournament_payment_status',
          'apply_production_tournament_payment_reversal', 'list_production_tournament_purchases_to_reconcile', 'claim_production_tournament_purchase_check',
          'complete_production_tournament_purchase_check'))
        OR (n.nspname = 'private' AND p.proname IN ('activate_production_tournament_purchase', 'unordered_production_tournament_payment_status',
          'unordered_production_tournament_payment_reversal', 'order_production_tournament_payment', 'enforce_tournament_purchase_payment_environment')))
      AND ((p.prosecdef IS DISTINCT FROM (p.proname <> 'enforce_tournament_purchase_payment_environment'))
        OR p.proconfig IS DISTINCT FROM array['search_path=""'] OR p.proowner <> (SELECT oid FROM pg_roles WHERE rolname = current_user)
        OR EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0))
    -- client ACL: authenticated gains exactly the two client functions; anon and service_role gain nothing
    UNION ALL SELECT 'authenticated ' || p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname IN ('public','private') AND (p.proname ~ 'production' OR p.proname = 'get_tournament_season_purchases')
        AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
        AND p.oid NOT IN ('public.create_tournament_season_production_checkout_purchase(uuid,uuid,uuid)'::regprocedure, 'public.get_tournament_season_purchases(uuid,uuid)'::regprocedure)
    UNION ALL SELECT 'authenticated missing ' || f FROM unnest(array['public.create_tournament_season_production_checkout_purchase(uuid,uuid,uuid)',
        'public.get_tournament_season_purchases(uuid,uuid)']) f WHERE NOT has_function_privilege('authenticated', f, 'EXECUTE')
    UNION ALL SELECT role_name || ' ' || p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      CROSS JOIN unnest(array['anon','service_role']) role_name
      WHERE n.nspname IN ('public','private') AND (p.proname ~ 'production' OR p.proname = 'get_tournament_season_purchases')
        AND has_function_privilege(role_name, p.oid, 'EXECUTE')
    -- TEST role: still exactly its four
    UNION ALL SELECT 'torneos_payment_service executes ' || p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname IN ('public','private') AND has_function_privilege('torneos_payment_service', p.oid, 'EXECUTE')
        AND p.oid NOT IN ('public.get_provider_tournament_purchase(text,text,text)'::regprocedure,
          'public.record_tournament_purchase_preference(uuid,text,text,text,timestamp with time zone)'::regprocedure,
          'public.apply_verified_tournament_payment_status(uuid,text,text,text,text,text,text,timestamp with time zone)'::regprocedure,
          'public.apply_verified_tournament_payment_reversal(uuid,text,text,text,text,text,text,timestamp with time zone)'::regprocedure)
    -- production role: exactly its seven, no relation or sequence privilege, safe attributes
    UNION ALL SELECT 'torneos_payment_production_service executes ' || p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname IN ('public','private') AND has_function_privilege('torneos_payment_production_service', p.oid, 'EXECUTE')
        AND p.oid NOT IN ('public.get_production_provider_tournament_purchase(text)'::regprocedure,
          'public.record_production_tournament_purchase_preference(uuid,text,timestamp with time zone)'::regprocedure,
          'public.apply_production_tournament_payment_status(uuid,text,text,text,text,timestamp with time zone)'::regprocedure,
          'public.apply_production_tournament_payment_reversal(uuid,text,text,text,text,timestamp with time zone)'::regprocedure,
          'public.list_production_tournament_purchases_to_reconcile(integer)'::regprocedure,
          'public.claim_production_tournament_purchase_check(uuid,integer)'::regprocedure,
          'public.complete_production_tournament_purchase_check(uuid,text)'::regprocedure)
    UNION ALL SELECT 'torneos_payment_production_service lacks ' || f FROM unnest(array['public.get_production_provider_tournament_purchase(text)',
        'public.record_production_tournament_purchase_preference(uuid,text,timestamp with time zone)',
        'public.apply_production_tournament_payment_status(uuid,text,text,text,text,timestamp with time zone)',
        'public.apply_production_tournament_payment_reversal(uuid,text,text,text,text,timestamp with time zone)',
        'public.list_production_tournament_purchases_to_reconcile(integer)', 'public.claim_production_tournament_purchase_check(uuid,integer)',
        'public.complete_production_tournament_purchase_check(uuid,text)']) f
      WHERE NOT has_function_privilege('torneos_payment_production_service', f, 'EXECUTE')
    UNION ALL SELECT 'torneos_payment_production_service relation ' || c.oid::regclass::text FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname IN ('public','private') AND c.relkind IN ('r','v','m','p')
        AND (has_table_privilege('torneos_payment_production_service', c.oid, 'SELECT') OR has_table_privilege('torneos_payment_production_service', c.oid, 'INSERT')
          OR has_table_privilege('torneos_payment_production_service', c.oid, 'UPDATE') OR has_table_privilege('torneos_payment_production_service', c.oid, 'DELETE')
          OR has_table_privilege('torneos_payment_production_service', c.oid, 'TRUNCATE'))
    UNION ALL SELECT 'torneos_payment_production_service sequence ' || c.oid::regclass::text FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname IN ('public','private') AND c.relkind = 'S'
        AND (has_sequence_privilege('torneos_payment_production_service', c.oid, 'USAGE') OR has_sequence_privilege('torneos_payment_production_service', c.oid, 'UPDATE'))
    UNION ALL SELECT 'torneos_payment_production_service attributes' WHERE NOT EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname = 'torneos_payment_production_service'
      AND NOT r.rolcanlogin AND NOT r.rolinherit AND NOT r.rolsuper AND NOT r.rolcreaterole AND NOT r.rolcreatedb AND NOT r.rolbypassrls AND NOT r.rolreplication
      AND NOT EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member = r.oid))
    -- the switch and bookkeeping tables are nobody's but the installer's
    UNION ALL SELECT role_name || ' on ' || t FROM unnest(array['public.tournament_commerce_production_settings', 'public.tournament_commerce_production_allowlist',
        'public.tournament_purchase_provider_checks']) t
      CROSS JOIN unnest(array['anon','authenticated','service_role','torneos_payment_service','torneos_payment_production_service']) role_name
      WHERE has_table_privilege(role_name, t, 'SELECT') OR has_table_privilege(role_name, t, 'INSERT') OR has_table_privilege(role_name, t, 'UPDATE')
        OR has_table_privilege(role_name, t, 'DELETE')
  ) s;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION USING errcode = '55000', message = 'TORNEOS_MP_PRODUCTION_POSTCONDITION_FAILED: ' || v_bad;
  END IF;
END $post$;

COMMIT;
