-- MP-B1.2. Provider payment date_last_updated is the authority, never receipt/webhook time.
-- Keep the MP-A2 commercial policy unchanged and private behind ordered wrappers.
BEGIN;

-- Refuse a drifted/partial 0002 contract before creating objects or renaming functions.
DO $pre$
DECLARE v_signature text; v_hash text; v_oid oid; v_expected oid[] := array[]::oid[];
BEGIN
  IF to_regclass('public.tournament_purchases') IS NULL
    OR to_regclass('public.tournament_purchase_events') IS NULL
    OR to_regclass('public.tournament_payment_provider_watermarks') IS NOT NULL
    OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='torneos_payment_service' AND NOT rolcanlogin AND NOT rolinherit AND NOT rolsuper AND NOT rolbypassrls)
  THEN
    RAISE EXCEPTION 'TORNEOS_MP_B1_2_PRECONDITION_FAILED' USING errcode='55000';
  END IF;
  FOR v_signature,v_hash IN SELECT * FROM (VALUES
    ('public.apply_verified_tournament_payment_status(uuid,text,text,text,text,text,text)', '503d79f692d1417e4fa07b3f810ec192'),
    ('public.apply_verified_tournament_payment_reversal(uuid,text,text,text,text,text,text)', '1de0dd1965670d1fc08b52586765e248')
  ) expected(signature,body_hash) LOOP
    v_oid := to_regprocedure(v_signature);
    IF v_oid IS NULL OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=v_oid AND md5(prosrc)=v_hash
      AND prosecdef AND proowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)
      AND proconfig = ARRAY['search_path=""']::text[]) THEN
      RAISE EXCEPTION 'TORNEOS_MP_B1_2_PRECONDITION_FAILED' USING errcode='55000';
    END IF;
  END LOOP;
  FOREACH v_signature IN ARRAY ARRAY[
    'public.get_provider_tournament_purchase(text,text,text)',
    'public.record_tournament_purchase_preference(uuid,text,text,text,timestamp with time zone)',
    'public.apply_verified_tournament_payment_status(uuid,text,text,text,text,text,text)',
    'public.apply_verified_tournament_payment_reversal(uuid,text,text,text,text,text,text)'
  ] LOOP
    v_oid := to_regprocedure(v_signature);
    IF v_oid IS NULL OR NOT has_function_privilege('torneos_payment_service',v_oid,'EXECUTE') THEN
      RAISE EXCEPTION 'TORNEOS_MP_B1_2_PRECONDITION_FAILED' USING errcode='55000';
    END IF;
    v_expected := array_append(v_expected,v_oid);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname IN ('public','private') AND has_function_privilege('torneos_payment_service',p.oid,'EXECUTE') AND NOT (p.oid=ANY(v_expected)))
    OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.tournament_purchase_events'::regclass
      AND tgname='tournament_purchase_events_append_only' AND tgenabled='O') THEN
    RAISE EXCEPTION 'TORNEOS_MP_B1_2_PRECONDITION_FAILED' USING errcode='55000';
  END IF;
END;
$pre$;

CREATE TABLE public.tournament_payment_provider_watermarks (
  purchase_id uuid NOT NULL REFERENCES public.tournament_purchases(id),
  provider_payment_id text NOT NULL,
  date_last_updated timestamptz NOT NULL CHECK (isfinite(date_last_updated)),
  snapshot_state jsonb NOT NULL,
  -- Preserve MP-A2 manual-action flags on equal-version replay without running business logic again.
  requires_manual_refund boolean NOT NULL,
  requires_manual_review boolean NOT NULL,
  PRIMARY KEY (purchase_id, provider_payment_id)
);
ALTER TABLE public.tournament_payment_provider_watermarks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.tournament_payment_provider_watermarks FROM PUBLIC, anon, authenticated, service_role, torneos_payment_service;

ALTER FUNCTION public.apply_verified_tournament_payment_status(uuid,text,text,text,text,text,text)
  RENAME TO unordered_tournament_payment_status;
ALTER FUNCTION public.apply_verified_tournament_payment_reversal(uuid,text,text,text,text,text,text)
  RENAME TO unordered_tournament_payment_reversal;
REVOKE ALL ON FUNCTION public.unordered_tournament_payment_status(uuid,text,text,text,text,text,text) FROM PUBLIC, anon, authenticated, service_role, torneos_payment_service;
REVOKE ALL ON FUNCTION public.unordered_tournament_payment_reversal(uuid,text,text,text,text,text,text) FROM PUBLIC, anon, authenticated, service_role, torneos_payment_service;

CREATE FUNCTION public.order_verified_tournament_payment(
  p_purchase_id uuid, p_provider text, p_provider_environment text, p_kind text,
  p_state text, p_provider_status text, p_provider_status_detail text,
  p_provider_payment_id text, p_date_last_updated timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_purchase public.tournament_purchases%rowtype;
  v_previous public.tournament_payment_provider_watermarks%rowtype;
  v_payment text := nullif(btrim(p_provider_payment_id), '');
  v_state jsonb := jsonb_build_array(p_kind,p_state);
  v_result jsonb;
  v_event text;
  v_anomaly boolean;
BEGIN
  IF p_provider IS DISTINCT FROM 'MERCADO_PAGO' OR p_provider_environment IS DISTINCT FROM 'test' THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'TORNEOS_PROVIDER_INVALID';
  END IF;
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
  -- This is also the commercial transition lock. Held until the caller commits/rolls back.
  SELECT * INTO v_purchase FROM public.tournament_purchases WHERE id = p_purchase_id FOR UPDATE;
  IF v_purchase.id IS NULL OR v_purchase.provider <> 'MERCADO_PAGO' OR v_purchase.provider_environment <> 'test' THEN
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
    -- Audit only: never mutate the purchase/grant for stale or conflicting snapshots.
    -- Deduplicate under the same purchase lock. Only whitelisted normalized states and provider time/ID;
    -- no raw payload, raw status detail, payer fields, request signature or credential.
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
    v_result := public.unordered_tournament_payment_status(p_purchase_id,p_provider,p_provider_environment,p_state,p_provider_status,p_provider_status_detail,v_payment);
  ELSIF p_kind = 'reversal' THEN
    v_result := public.unordered_tournament_payment_reversal(p_purchase_id,p_provider,p_provider_environment,p_state,p_provider_status,p_provider_status_detail,v_payment);
  ELSE
    RAISE EXCEPTION USING errcode = '22023', message = 'TORNEOS_PROVIDER_STATUS_INVALID';
  END IF;
  -- Once flagged, review cannot silently disappear on a compatible replay or a later version.
  v_result := v_result || jsonb_build_object('requiresManualReview',
    coalesce(v_previous.requires_manual_review,false) OR coalesce((v_result->>'requiresManualReview')::boolean,false));
  INSERT INTO public.tournament_payment_provider_watermarks VALUES (p_purchase_id,v_payment,p_date_last_updated,v_state,coalesce((v_result->>'requiresManualRefund')::boolean,false),coalesce((v_result->>'requiresManualReview')::boolean,false))
    ON CONFLICT (purchase_id,provider_payment_id) DO UPDATE
    SET date_last_updated = excluded.date_last_updated, snapshot_state = excluded.snapshot_state,
        requires_manual_refund = excluded.requires_manual_refund, requires_manual_review = excluded.requires_manual_review;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.order_verified_tournament_payment(uuid,text,text,text,text,text,text,text,timestamptz) FROM PUBLIC, anon, authenticated, service_role, torneos_payment_service;

CREATE FUNCTION public.apply_verified_tournament_payment_status(
  p_purchase_id uuid,p_provider text,p_provider_environment text,p_status text,p_provider_status text,
  p_provider_status_detail text,p_provider_payment_id text,p_date_last_updated timestamptz
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO '' AS $$
  SELECT public.order_verified_tournament_payment(p_purchase_id,p_provider,p_provider_environment,'status',p_status,p_provider_status,p_provider_status_detail,p_provider_payment_id,p_date_last_updated);
$$;
CREATE FUNCTION public.apply_verified_tournament_payment_reversal(
  p_purchase_id uuid,p_provider text,p_provider_environment text,p_action text,p_provider_status text,
  p_provider_status_detail text,p_provider_payment_id text,p_date_last_updated timestamptz
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO '' AS $$
  SELECT public.order_verified_tournament_payment(p_purchase_id,p_provider,p_provider_environment,'reversal',p_action,p_provider_status,p_provider_status_detail,p_provider_payment_id,p_date_last_updated);
$$;
REVOKE ALL ON FUNCTION public.apply_verified_tournament_payment_status(uuid,text,text,text,text,text,text,timestamptz) FROM PUBLIC, anon, authenticated, service_role, torneos_payment_service;
REVOKE ALL ON FUNCTION public.apply_verified_tournament_payment_reversal(uuid,text,text,text,text,text,text,timestamptz) FROM PUBLIC, anon, authenticated, service_role, torneos_payment_service;
GRANT EXECUTE ON FUNCTION public.apply_verified_tournament_payment_status(uuid,text,text,text,text,text,text,timestamptz) TO torneos_payment_service;
GRANT EXECUTE ON FUNCTION public.apply_verified_tournament_payment_reversal(uuid,text,text,text,text,text,text,timestamptz) TO torneos_payment_service;
COMMENT ON FUNCTION public.order_verified_tournament_payment(uuid,text,text,text,text,text,text,text,timestamptz) IS
  'MP-B1.2 internal: purchase lock, per-payment provider date_last_updated ordering, durable conflict review and deduplicated stale/conflict audit in the business transaction.';
COMMENT ON FUNCTION public.apply_verified_tournament_payment_status(uuid,text,text,text,text,text,text,timestamptz) IS
  'MP-B1.2 payment service: mandatory server-refetched provider timestamp; ordered MP-A2 status policy.';
COMMENT ON FUNCTION public.apply_verified_tournament_payment_reversal(uuid,text,text,text,text,text,text,timestamptz) IS
  'MP-B1.2 payment service: mandatory server-refetched provider timestamp; ordered MP-A2 reversal policy, including final revocation.';
COMMIT;
