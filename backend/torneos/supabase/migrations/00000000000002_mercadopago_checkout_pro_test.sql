-- Arma2 Torneos — MP-A2: Mercado Pago Checkout Pro TEST commercial DB delta (hybrid stack). Applies after
-- 00000000000000_torneos_baseline_v1.sql and 00000000000001_staging_v1_rpc_exposure.sql.
--
-- Scope (database only; no provider HTTP, webhook, gateway route or frontend here):
--   * tournament_purchases CHECKs: provider FAKE | MERCADO_PAGO; environment FAKE+local, FAKE+qa or
--     MERCADO_PAGO+test only. There is no production/live environment for Mercado Pago.
--   * create_tournament_season_checkout_purchase: the only client entry point. Product, provider,
--     environment and price are fixed server-side (torneos_premium / MERCADO_PAGO / test / current offer);
--     it requires identity, season access and billing.manage, refuses the season while a purchased grant is
--     not definitively revoked (effective → TORNEOS_SEASON_ALREADY_PREMIUM; suspended by a chargeback in
--     dispute, which can still be restored → TORNEOS_SEASON_PREMIUM_SUSPENDED), expires stale open
--     purchases (preference_created → expired, created → cancelled once preference_expires_at + 15 min has
--     passed; pending, or any purchase with a still-open payment, never expires) and delegates to the
--     baseline create_tournament_season_purchase (advisory lock, (buyer, idempotency_key) idempotency and
--     open-purchase uniqueness unchanged).
--   * Service RPCs for the payments service, ported from the legacy Core migration 20260827001443 with the
--     MP-A1 corrections: get_provider_tournament_purchase, apply_verified_tournament_payment_status,
--     apply_verified_tournament_payment_reversal.
--       - rejected / cancelled / expired are payment ATTEMPT outcomes (payment.attempt_*): the purchase stays
--         open on its preference and a later approved payment on the same preference activates Premium. A
--         pending purchase returns to preference_created only when no known payment is still open (every
--         payment.pending has its own attempt_* or payment.approved); an ended payment never reopens;
--       - a duplicate approved never errors: same payment → payment.approved_duplicate; another payment on an
--         activated purchase → payment.approved_duplicate_payment with requiresManualRefund;
--       - approved on a closed purchase (expired / cancelled / rejected) → payment.approved_after_close with
--         requiresManualRefund, no Premium;
--       - a reversal without activation, of another payment, after revocation, or refused by the state
--         machine is recorded (payment.reversal_*) and answered without a transient error;
--       - pending / rejected / cancelled / expired after activation never degrade it (stale_status_ignored).
--     Activation stays activate_verified_tournament_purchase; reversals stay apply_tournament_purchase_reversal.
--     Every anomaly event is recorded once per (event, payment, status): provider retries add nothing.
--     22023 errors are permanent input errors; 55000 TORNEOS_PURCHASE_NOT_READY (no preference recorded yet)
--     is the only retryable outcome.
--   * State machine: the single new edge pending → preference_created (the last open payment attempt ended).
--   * tournament_season_plan_grant_events becomes append-only like the other commercial event tables.
--   * Role torneos_payment_service: NOLOGIN NOINHERIT, no table privilege, EXECUTE on exactly the three
--     service RPCs plus the baseline record_tournament_purchase_preference. Its members (logins) are created
--     by each environment's bootstrap, never here.
--   * ACL: authenticated gains the wrapper and get_tournament_purchase (entitlements already granted) and
--     loses create_tournament_season_purchase / create_fake_tournament_season_purchase (cancel stays revoked
--     by 0001). anon gains nothing; service_role keeps what it had and receives nothing new. The staging v1
--     gateway allowlist is not touched: the gateway still refuses every commercial RPC.
--
-- Fail-closed: the preconditions accept exactly the certified 0000 + 0001 state or the state this migration
-- leaves (re-apply is a no-op); anything else aborts with TORNEOS_MP_A2_PRECONDITION_FAILED before any change.
-- Postconditions re-verify the resulting schema and ACL inside the same transaction.
BEGIN;

-- ============================================================================ 1. preconditions
DO $pre$
DECLARE
  v_missing text;
  v_provider_def text;
  v_environment_def text;
  v_transition_md5 text;
  v_new_functions integer;
  v_role_ok boolean;
  v_role_exists boolean;
  v_trigger boolean;
  v_pre text[] := array[]::text[];
  v_post text[] := array[]::text[];
BEGIN
  SELECT string_agg(f, ', ') INTO v_missing FROM unnest(array[
    'public.create_tournament_season_purchase(uuid,uuid,text,uuid,text,text)',
    'public.create_fake_tournament_season_purchase(uuid,uuid,text,uuid,text)',
    'public.cancel_tournament_purchase(uuid)',
    'public.get_tournament_purchase(uuid)',
    'public.get_effective_tournament_season_entitlements(uuid,uuid)',
    'public.record_tournament_purchase_preference(uuid,text,text,text,timestamp with time zone)',
    'public.activate_verified_tournament_purchase(uuid,text,text,text,text,text,text)',
    'public.apply_tournament_purchase_reversal(uuid,text,text)',
    'public.grant_tournament_season_premium(uuid,uuid,uuid,text)',
    'public.is_tournament_season_plan_grant_effective(uuid)',
    'public.tournament_purchase_projection(public.tournament_purchases)',
    'public.has_tournament_organization_capability(uuid,text)',
    'public.has_tournament_season_access(uuid,uuid)',
    'public.has_tournament_season_capability(uuid,uuid,text)',
    'public.reject_append_only_tournament_commercial_mutation()',
    'public.enforce_tournament_purchase_transition()',
    'public.auto_schedule_tournament_matches(uuid,uuid)',
    'private.current_identity_id()'
  ]) f WHERE to_regprocedure(f) IS NULL;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION USING errcode = '55000', message = 'TORNEOS_MP_A2_PRECONDITION_FAILED: missing function(s) ' || v_missing;
  END IF;
  SELECT string_agg(r, ', ') INTO v_missing FROM unnest(array[
    'public.tournament_purchases', 'public.tournament_purchase_events', 'public.tournament_season_plan_grants',
    'public.tournament_season_plan_grant_events', 'public.tournament_commercial_products', 'public.tournament_commercial_offers',
    'public.tournament_seasons'
  ]) r WHERE to_regclass(r) IS NULL;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION USING errcode = '55000', message = 'TORNEOS_MP_A2_PRECONDITION_FAILED: missing table(s) ' || v_missing;
  END IF;
  -- Structural guarantees this delta relies on (open-purchase uniqueness, idempotency, payment/preference
  -- uniqueness, one grant per purchase, snapshot/state-machine/scope triggers, append-only purchase events).
  SELECT string_agg(x, ', ') INTO v_missing FROM (
    SELECT 'index tournament_purchases_open_season_product_unique' x WHERE NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'tournament_purchases_open_season_product_unique'
      AND indexdef = 'CREATE UNIQUE INDEX tournament_purchases_open_season_product_unique ON public.tournament_purchases USING btree (organization_id, season_id, product_code) WHERE (status = ANY (ARRAY[''created''::text, ''preference_created''::text, ''pending''::text]))')
    UNION ALL SELECT 'index tournament_purchases_buyer_idempotency_unique' WHERE NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'tournament_purchases_buyer_idempotency_unique'
      AND indexdef = 'CREATE UNIQUE INDEX tournament_purchases_buyer_idempotency_unique ON public.tournament_purchases USING btree (buyer_user_id, idempotency_key)')
    UNION ALL SELECT 'index tournament_purchases_provider_payment_unique' WHERE NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'tournament_purchases_provider_payment_unique')
    UNION ALL SELECT 'index tournament_purchases_provider_preference_unique' WHERE NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'tournament_purchases_provider_preference_unique')
    UNION ALL SELECT 'constraint tournament_season_plan_grants_origin_purchase_unique' WHERE NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.tournament_season_plan_grants'::regclass AND conname = 'tournament_season_plan_grants_origin_purchase_unique' AND contype = 'u')
    UNION ALL SELECT 'trigger ' || t FROM unnest(array['tournament_purchases_protect_snapshots', 'tournament_purchases_season_scope', 'tournament_purchases_state_machine']) t
      WHERE NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.tournament_purchases'::regclass AND tgname = t AND tgenabled = 'O')
    UNION ALL SELECT 'trigger tournament_purchase_events_append_only' WHERE NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.tournament_purchase_events'::regclass AND tgname = 'tournament_purchase_events_append_only' AND tgenabled = 'O')
    UNION ALL SELECT 'product torneos_premium (PREMIUM, season, one_time, active)' WHERE NOT EXISTS (SELECT 1 FROM public.tournament_commercial_products WHERE product_code = 'torneos_premium' AND plan_code = 'PREMIUM' AND scope = 'season' AND billing_model = 'one_time' AND status = 'active')
    UNION ALL SELECT 'staging v1 gate 00000000000001 (cancel_tournament_purchase / auto_schedule_tournament_matches client EXECUTE)'
      WHERE has_function_privilege('authenticated', 'public.cancel_tournament_purchase(uuid)', 'EXECUTE') OR has_function_privilege('anon', 'public.cancel_tournament_purchase(uuid)', 'EXECUTE')
        OR has_function_privilege('authenticated', 'public.auto_schedule_tournament_matches(uuid,uuid)', 'EXECUTE')
    UNION ALL SELECT 'owner of the purchase state machine is not the installer' WHERE (SELECT proowner FROM pg_proc WHERE oid = 'public.enforce_tournament_purchase_transition()'::regprocedure) <> (SELECT oid FROM pg_roles WHERE rolname = current_user)
  ) s;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION USING errcode = '55000', message = 'TORNEOS_MP_A2_PRECONDITION_FAILED: ' || v_missing;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO v_provider_def FROM pg_constraint WHERE conrelid = 'public.tournament_purchases'::regclass AND conname = 'tournament_purchases_provider_check';
  SELECT pg_get_constraintdef(oid) INTO v_environment_def FROM pg_constraint WHERE conrelid = 'public.tournament_purchases'::regclass AND conname = 'tournament_purchases_environment_check';
  SELECT md5(prosrc) INTO v_transition_md5 FROM pg_proc WHERE oid = 'public.enforce_tournament_purchase_transition()'::regprocedure;
  SELECT count(*) INTO v_new_functions FROM unnest(array[
    'public.create_tournament_season_checkout_purchase(uuid,uuid,uuid)',
    'public.get_provider_tournament_purchase(text,text,text)',
    'public.apply_verified_tournament_payment_status(uuid,text,text,text,text,text,text)',
    'public.apply_verified_tournament_payment_reversal(uuid,text,text,text,text,text,text)'
  ]) f WHERE to_regprocedure(f) IS NOT NULL;
  SELECT count(*) > 0 INTO v_role_exists FROM pg_roles WHERE rolname = 'torneos_payment_service';
  SELECT count(*) = 1 INTO v_role_ok FROM pg_roles r WHERE r.rolname = 'torneos_payment_service' AND NOT r.rolcanlogin AND NOT r.rolinherit AND NOT r.rolsuper
    AND NOT r.rolcreaterole AND NOT r.rolcreatedb AND NOT r.rolbypassrls AND NOT r.rolreplication
    AND NOT EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member = r.oid);
  SELECT count(*) = 1 INTO v_trigger FROM pg_trigger WHERE tgrelid = 'public.tournament_season_plan_grant_events'::regclass AND tgname = 'tournament_season_plan_grant_events_append_only';

  -- Certified 0000 + 0001 state (first application).
  IF v_provider_def IS DISTINCT FROM 'CHECK ((provider = ''FAKE''::text))' THEN v_pre := v_pre || 'provider CHECK'::text; END IF;
  IF v_environment_def IS DISTINCT FROM 'CHECK ((provider_environment = ANY (ARRAY[''local''::text, ''qa''::text])))' THEN v_pre := v_pre || 'environment CHECK'::text; END IF;
  IF v_transition_md5 IS DISTINCT FROM 'a211b949dd334c81db761eb517a36995' THEN v_pre := v_pre || 'purchase state machine'::text; END IF;
  IF v_new_functions <> 0 THEN v_pre := v_pre || 'MP-A2 functions already present'::text; END IF;
  IF v_role_exists THEN v_pre := v_pre || 'torneos_payment_service already exists'::text; END IF;
  IF v_trigger THEN v_pre := v_pre || 'season grant events already append-only'::text; END IF;
  IF has_function_privilege('authenticated', 'public.get_tournament_purchase(uuid)', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'public.create_tournament_season_purchase(uuid,uuid,text,uuid,text,text)', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'public.create_fake_tournament_season_purchase(uuid,uuid,text,uuid,text)', 'EXECUTE') THEN
    v_pre := v_pre || 'commercial ACL'::text;
  END IF;
  -- State left by this migration (re-application).
  IF v_provider_def IS DISTINCT FROM 'CHECK ((provider = ANY (ARRAY[''FAKE''::text, ''MERCADO_PAGO''::text])))' THEN v_post := v_post || 'provider CHECK'::text; END IF;
  IF v_environment_def IS DISTINCT FROM 'CHECK ((((provider = ''FAKE''::text) AND (provider_environment = ANY (ARRAY[''local''::text, ''qa''::text]))) OR ((provider = ''MERCADO_PAGO''::text) AND (provider_environment = ''test''::text))))' THEN v_post := v_post || 'environment CHECK'::text; END IF;
  IF v_transition_md5 IS DISTINCT FROM '2876e51dba7cc935ea2f0449d1b925aa' THEN v_post := v_post || 'purchase state machine'::text; END IF;
  IF v_new_functions <> 4 THEN v_post := v_post || 'MP-A2 functions'::text; END IF;
  IF NOT v_role_ok THEN v_post := v_post || 'torneos_payment_service attributes'::text; END IF;
  IF NOT v_trigger THEN v_post := v_post || 'season grant events append-only trigger'::text; END IF;

  IF cardinality(v_pre) > 0 AND cardinality(v_post) > 0 THEN
    RAISE EXCEPTION USING errcode = '55000', message = 'TORNEOS_MP_A2_PRECONDITION_FAILED: not the certified 0000+0001 state (' || array_to_string(v_pre, ', ')
      || ') nor the MP-A2 state (' || array_to_string(v_post, ', ') || ')';
  END IF;
END $pre$;

-- ============================================================================ 2. payment service role
DO $role$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'torneos_payment_service') THEN
    CREATE ROLE torneos_payment_service NOLOGIN NOINHERIT;
  END IF;
END $role$;
GRANT USAGE ON SCHEMA public TO torneos_payment_service;

-- ============================================================================ 3. provider / environment CHECKs
ALTER TABLE public.tournament_purchases
  DROP CONSTRAINT tournament_purchases_provider_check,
  DROP CONSTRAINT tournament_purchases_environment_check;
ALTER TABLE public.tournament_purchases
  ADD CONSTRAINT tournament_purchases_provider_check CHECK (provider IN ('FAKE','MERCADO_PAGO')),
  ADD CONSTRAINT tournament_purchases_environment_check CHECK (
    (provider = 'FAKE' AND provider_environment IN ('local','qa'))
    OR (provider = 'MERCADO_PAGO' AND provider_environment = 'test')
  );

-- ============================================================================ 4. state machine: an ended pending attempt reopens the preference
CREATE OR REPLACE FUNCTION public.enforce_tournament_purchase_transition() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if new.status = old.status then return new; end if;
  if not (
    (old.status = 'created' and new.status in ('preference_created','cancelled'))
    or (old.status = 'preference_created' and new.status in ('pending','approved','rejected','cancelled','expired'))
    or (old.status = 'pending' and new.status in ('preference_created','approved','rejected','cancelled','expired'))
    or (old.status = 'approved' and new.status in ('refunded','charged_back'))
    or (old.status = 'charged_back' and new.status = 'approved')
  ) then
    raise exception using errcode = '55000', message = 'TORNEOS_PURCHASE_TRANSITION_INVALID';
  end if;
  return new;
end;
$$;

-- ============================================================================ 5. season grant events are append-only
DROP TRIGGER IF EXISTS tournament_season_plan_grant_events_append_only ON public.tournament_season_plan_grant_events;
CREATE TRIGGER tournament_season_plan_grant_events_append_only BEFORE DELETE OR UPDATE ON public.tournament_season_plan_grant_events
  FOR EACH ROW EXECUTE FUNCTION public.reject_append_only_tournament_commercial_mutation();

-- ============================================================================ 6. client checkout wrapper
CREATE OR REPLACE FUNCTION public.create_tournament_season_checkout_purchase(p_organization_id uuid, p_season_id uuid, p_idempotency_key uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_expired integer := 0;
  v_blocked text;
  v_result jsonb;
begin
  if private.current_identity_id() is null then
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
  -- The lock create_tournament_season_purchase takes: the stale sweep and create/reuse are one critical section.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_organization_id::text || ':' || p_season_id::text || ':' || 'torneos_premium',79)
  );
  -- A purchased season grant blocks a new purchase until it is definitively revoked (refund / chargeback
  -- lost). The baseline creator only refuses effective grants; a suspended one (chargeback in dispute) can
  -- still be restored, and a second purchase would then leave two effective grants for the season.
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
  with stale as (
    update public.tournament_purchases purchase set
      status = case purchase.status when 'preference_created' then 'expired' else 'cancelled' end,
      cancelled_at = coalesce(purchase.cancelled_at,now()),
      last_verified_at = now()
    where purchase.organization_id = p_organization_id and purchase.season_id = p_season_id
      and purchase.product_code = 'torneos_premium'
      and purchase.status in ('created','preference_created')
      and purchase.preference_expires_at + interval '15 minutes' < now()
      -- Never while a known payment is still open (the purchase would then be pending anyway).
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
  v_result := public.create_tournament_season_purchase(
    p_organization_id,p_season_id,'torneos_premium',p_idempotency_key,'MERCADO_PAGO','test'
  );
  return v_result || jsonb_build_object('expiredStalePurchases',v_expired);
end;
$$;

-- ============================================================================ 7. service RPCs (payments service only)
CREATE OR REPLACE FUNCTION public.get_provider_tournament_purchase(p_external_reference text, p_provider text, p_provider_environment text) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_purchase public.tournament_purchases%rowtype;
begin
  if p_provider is distinct from 'MERCADO_PAGO' or p_provider_environment is distinct from 'test' then
    raise exception using errcode = '22023', message = 'TORNEOS_PROVIDER_INVALID';
  end if;
  select * into v_purchase from public.tournament_purchases
  where external_reference = p_external_reference
    and provider = p_provider and provider_environment = p_provider_environment;
  if v_purchase.id is null then
    raise exception using errcode = 'P0002', message = 'TORNEOS_PURCHASE_NOT_FOUND';
  end if;
  return public.tournament_purchase_projection(v_purchase);
end;
$$;

CREATE OR REPLACE FUNCTION public.apply_verified_tournament_payment_status(p_purchase_id uuid, p_provider text, p_provider_environment text, p_status text, p_provider_status text, p_provider_status_detail text DEFAULT NULL::text, p_provider_payment_id text DEFAULT NULL::text) RETURNS jsonb
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
  if p_provider is distinct from 'MERCADO_PAGO' or p_provider_environment is distinct from 'test' then
    raise exception using errcode = '22023', message = 'TORNEOS_PROVIDER_INVALID';
  end if;
  if p_status is null or p_status not in ('approved','pending','rejected','cancelled','expired') then
    raise exception using errcode = '22023', message = 'TORNEOS_PROVIDER_STATUS_INVALID';
  end if;
  if v_payment is null or char_length(v_payment) > 80 then
    raise exception using errcode = '22023', message = 'TORNEOS_PAYMENT_INVALID';
  end if;
  if char_length(v_provider_status) < 2 then v_provider_status := p_status; end if;
  select * into v_purchase from public.tournament_purchases where id = p_purchase_id for update;
  if v_purchase.id is null or v_purchase.provider <> 'MERCADO_PAGO' or v_purchase.provider_environment <> 'test' then
    raise exception using errcode = '22023', message = 'TORNEOS_PURCHASE_INVALID';
  end if;
  if v_purchase.status = 'created' then
    -- The preference is not recorded yet: retryable.
    raise exception using errcode = '55000', message = 'TORNEOS_PURCHASE_NOT_READY';
  end if;
  v_from := v_purchase.status;
  v_target := v_purchase.status;

  if p_status = 'approved' and v_purchase.status in ('preference_created','pending') then
    if exists (
      select 1 from public.tournament_purchases other
      where other.provider = 'MERCADO_PAGO' and other.provider_environment = 'test'
        and other.approved_provider_payment_id = v_payment and other.id <> v_purchase.id
    ) then
      raise exception using errcode = '22023', message = 'TORNEOS_PAYMENT_CONFLICT';
    end if;
    v_result := public.activate_verified_tournament_purchase(
      v_purchase.id,'MERCADO_PAGO','test',v_provider_status,v_detail,v_payment,null
    );
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
    -- Never degrade an activated purchase nor reopen a closed one.
    v_outcome := 'stale_ignored'; v_event := 'payment.stale_status_ignored';
  elsif p_status = 'pending' then
    -- A payment that already ended never reopens (late or replayed pending).
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
    -- pending → preference_created only once no known payment is still open. The open set is derived from
    -- every payment.pending of the purchase: a payment is open until it has its own terminal event (an
    -- ended attempt or payment.approved); this notification ends v_payment. Money still pending on another
    -- payment keeps the purchase pending, so the stale sweep can never expire it.
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

  -- One record per (event, payment, status): provider retries are logical successes that add nothing.
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

CREATE OR REPLACE FUNCTION public.apply_verified_tournament_payment_reversal(p_purchase_id uuid, p_provider text, p_provider_environment text, p_action text, p_provider_status text, p_provider_status_detail text, p_provider_payment_id text) RETURNS jsonb
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
  if p_provider is distinct from 'MERCADO_PAGO' or p_provider_environment is distinct from 'test' then
    raise exception using errcode = '22023', message = 'TORNEOS_PROVIDER_INVALID';
  end if;
  if p_action is null or p_action not in ('refund','chargeback_disputed','chargeback_restored','chargeback_buyer_won') then
    raise exception using errcode = '22023', message = 'TORNEOS_REVERSAL_INVALID';
  end if;
  if v_payment is null or char_length(v_payment) > 80 then
    raise exception using errcode = '22023', message = 'TORNEOS_PAYMENT_INVALID';
  end if;
  if char_length(v_provider_status) < 2 then v_provider_status := p_action; end if;
  select * into v_purchase from public.tournament_purchases where id = p_purchase_id for update;
  if v_purchase.id is null or v_purchase.provider <> 'MERCADO_PAGO' or v_purchase.provider_environment <> 'test' then
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
      -- A revocation (refund / buyer won) is final for this purchase.
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

COMMENT ON FUNCTION public.create_tournament_season_checkout_purchase(uuid,uuid,uuid) IS
  'MP-A2 client checkout: MERCADO_PAGO/test/torneos_premium fixed server-side; expires stale open purchases; delegates to create_tournament_season_purchase.';
COMMENT ON FUNCTION public.get_provider_tournament_purchase(text,text,text) IS
  'MP-A2 payments service: MERCADO_PAGO/test purchase lookup by external reference, used after an independently verified provider response.';
COMMENT ON FUNCTION public.apply_verified_tournament_payment_status(uuid,text,text,text,text,text,text) IS
  'MP-A2 payments service: verified payment status → attempt events, activation through activate_verified_tournament_purchase, idempotent anomalies (duplicate / after-close / stale).';
COMMENT ON FUNCTION public.apply_verified_tournament_payment_reversal(uuid,text,text,text,text,text,text) IS
  'MP-A2 payments service: verified refund/chargeback → apply_tournament_purchase_reversal when an activation exists; otherwise an idempotent anomaly event.';

-- ============================================================================ 8. ACL
REVOKE ALL ON FUNCTION public.create_tournament_season_checkout_purchase(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated, service_role, torneos_payment_service;
REVOKE ALL ON FUNCTION public.get_provider_tournament_purchase(text,text,text) FROM PUBLIC, anon, authenticated, service_role, torneos_payment_service;
REVOKE ALL ON FUNCTION public.apply_verified_tournament_payment_status(uuid,text,text,text,text,text,text) FROM PUBLIC, anon, authenticated, service_role, torneos_payment_service;
REVOKE ALL ON FUNCTION public.apply_verified_tournament_payment_reversal(uuid,text,text,text,text,text,text) FROM PUBLIC, anon, authenticated, service_role, torneos_payment_service;
GRANT EXECUTE ON FUNCTION public.create_tournament_season_checkout_purchase(uuid,uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_tournament_purchase(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.create_tournament_season_purchase(uuid,uuid,text,uuid,text,text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_fake_tournament_season_purchase(uuid,uuid,text,uuid,text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cancel_tournament_purchase(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_provider_tournament_purchase(text,text,text) TO torneos_payment_service;
GRANT EXECUTE ON FUNCTION public.apply_verified_tournament_payment_status(uuid,text,text,text,text,text,text) TO torneos_payment_service;
GRANT EXECUTE ON FUNCTION public.apply_verified_tournament_payment_reversal(uuid,text,text,text,text,text,text) TO torneos_payment_service;
GRANT EXECUTE ON FUNCTION public.record_tournament_purchase_preference(uuid,text,text,text,timestamp with time zone) TO torneos_payment_service;

-- ============================================================================ 9. postconditions
DO $post$
DECLARE
  v_bad text;
BEGIN
  SELECT string_agg(x, ', ') INTO v_bad FROM (
    -- CHECKs
    SELECT 'provider CHECK' x WHERE (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'public.tournament_purchases'::regclass AND conname = 'tournament_purchases_provider_check')
      IS DISTINCT FROM 'CHECK ((provider = ANY (ARRAY[''FAKE''::text, ''MERCADO_PAGO''::text])))'
    UNION ALL SELECT 'environment CHECK' WHERE (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'public.tournament_purchases'::regclass AND conname = 'tournament_purchases_environment_check')
      IS DISTINCT FROM 'CHECK ((((provider = ''FAKE''::text) AND (provider_environment = ANY (ARRAY[''local''::text, ''qa''::text]))) OR ((provider = ''MERCADO_PAGO''::text) AND (provider_environment = ''test''::text))))'
    UNION ALL SELECT 'purchase state machine' WHERE (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.enforce_tournament_purchase_transition()'::regprocedure) IS DISTINCT FROM '2876e51dba7cc935ea2f0449d1b925aa'
    UNION ALL SELECT 'season grant events append-only trigger' WHERE NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.tournament_season_plan_grant_events'::regclass AND tgname = 'tournament_season_plan_grant_events_append_only' AND tgenabled = 'O')
    -- new functions: SECURITY DEFINER, fixed empty search_path, installer-owned, never PUBLIC
    UNION ALL SELECT 'function shape ' || p.oid::regprocedure::text FROM pg_proc p
      WHERE p.oid IN ('public.create_tournament_season_checkout_purchase(uuid,uuid,uuid)'::regprocedure, 'public.get_provider_tournament_purchase(text,text,text)'::regprocedure,
        'public.apply_verified_tournament_payment_status(uuid,text,text,text,text,text,text)'::regprocedure, 'public.apply_verified_tournament_payment_reversal(uuid,text,text,text,text,text,text)'::regprocedure)
        AND (NOT p.prosecdef OR p.proconfig IS DISTINCT FROM array['search_path=""'] OR p.proowner <> (SELECT oid FROM pg_roles WHERE rolname = current_user)
          OR EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0))
    -- client ACL
    UNION ALL SELECT 'anon ' || f FROM unnest(array['public.create_tournament_season_checkout_purchase(uuid,uuid,uuid)', 'public.get_provider_tournament_purchase(text,text,text)',
        'public.apply_verified_tournament_payment_status(uuid,text,text,text,text,text,text)', 'public.apply_verified_tournament_payment_reversal(uuid,text,text,text,text,text,text)',
        'public.get_tournament_purchase(uuid)', 'public.get_effective_tournament_season_entitlements(uuid,uuid)', 'public.create_tournament_season_purchase(uuid,uuid,text,uuid,text,text)',
        'public.create_fake_tournament_season_purchase(uuid,uuid,text,uuid,text)', 'public.cancel_tournament_purchase(uuid)', 'public.record_tournament_purchase_preference(uuid,text,text,text,timestamp with time zone)']) f
      WHERE has_function_privilege('anon', f, 'EXECUTE')
    UNION ALL SELECT 'authenticated missing ' || f FROM unnest(array['public.create_tournament_season_checkout_purchase(uuid,uuid,uuid)', 'public.get_tournament_purchase(uuid)',
        'public.get_effective_tournament_season_entitlements(uuid,uuid)']) f WHERE NOT has_function_privilege('authenticated', f, 'EXECUTE')
    UNION ALL SELECT 'authenticated keeps ' || f FROM unnest(array['public.create_tournament_season_purchase(uuid,uuid,text,uuid,text,text)', 'public.create_fake_tournament_season_purchase(uuid,uuid,text,uuid,text)',
        'public.cancel_tournament_purchase(uuid)', 'public.get_provider_tournament_purchase(text,text,text)', 'public.apply_verified_tournament_payment_status(uuid,text,text,text,text,text,text)',
        'public.apply_verified_tournament_payment_reversal(uuid,text,text,text,text,text,text)', 'public.record_tournament_purchase_preference(uuid,text,text,text,timestamp with time zone)',
        'public.activate_verified_tournament_purchase(uuid,text,text,text,text,text,text)', 'public.apply_tournament_purchase_reversal(uuid,text,text)']) f
      WHERE has_function_privilege('authenticated', f, 'EXECUTE')
    -- service_role: nothing new
    UNION ALL SELECT 'service_role new ' || f FROM unnest(array['public.create_tournament_season_checkout_purchase(uuid,uuid,uuid)', 'public.get_provider_tournament_purchase(text,text,text)',
        'public.apply_verified_tournament_payment_status(uuid,text,text,text,text,text,text)', 'public.apply_verified_tournament_payment_reversal(uuid,text,text,text,text,text,text)']) f
      WHERE has_function_privilege('service_role', f, 'EXECUTE')
    -- payment service role: exactly its four functions, no relation privilege, safe attributes
    UNION ALL SELECT 'torneos_payment_service executes ' || p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname IN ('public','private') AND has_function_privilege('torneos_payment_service', p.oid, 'EXECUTE')
        AND p.oid NOT IN ('public.get_provider_tournament_purchase(text,text,text)'::regprocedure, 'public.apply_verified_tournament_payment_status(uuid,text,text,text,text,text,text)'::regprocedure,
          'public.apply_verified_tournament_payment_reversal(uuid,text,text,text,text,text,text)'::regprocedure, 'public.record_tournament_purchase_preference(uuid,text,text,text,timestamp with time zone)'::regprocedure)
    UNION ALL SELECT 'torneos_payment_service lacks ' || f FROM unnest(array['public.get_provider_tournament_purchase(text,text,text)', 'public.apply_verified_tournament_payment_status(uuid,text,text,text,text,text,text)',
        'public.apply_verified_tournament_payment_reversal(uuid,text,text,text,text,text,text)', 'public.record_tournament_purchase_preference(uuid,text,text,text,timestamp with time zone)']) f
      WHERE NOT has_function_privilege('torneos_payment_service', f, 'EXECUTE')
    UNION ALL SELECT 'torneos_payment_service relation ' || c.oid::regclass::text FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname IN ('public','private') AND c.relkind IN ('r','v','m','p')
        AND (has_table_privilege('torneos_payment_service', c.oid, 'SELECT') OR has_table_privilege('torneos_payment_service', c.oid, 'INSERT')
          OR has_table_privilege('torneos_payment_service', c.oid, 'UPDATE') OR has_table_privilege('torneos_payment_service', c.oid, 'DELETE')
          OR has_table_privilege('torneos_payment_service', c.oid, 'TRUNCATE'))
    UNION ALL SELECT 'torneos_payment_service sequence ' || c.oid::regclass::text FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname IN ('public','private') AND c.relkind = 'S'
        AND (has_sequence_privilege('torneos_payment_service', c.oid, 'USAGE') OR has_sequence_privilege('torneos_payment_service', c.oid, 'UPDATE'))
    UNION ALL SELECT 'torneos_payment_service attributes' WHERE NOT EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname = 'torneos_payment_service' AND NOT r.rolcanlogin AND NOT r.rolinherit
      AND NOT r.rolsuper AND NOT r.rolcreaterole AND NOT r.rolcreatedb AND NOT r.rolbypassrls AND NOT r.rolreplication AND NOT EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member = r.oid))
  ) s;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION USING errcode = '55000', message = 'TORNEOS_MP_A2_POSTCONDITION_FAILED: ' || v_bad;
  END IF;
END $post$;

COMMIT;
