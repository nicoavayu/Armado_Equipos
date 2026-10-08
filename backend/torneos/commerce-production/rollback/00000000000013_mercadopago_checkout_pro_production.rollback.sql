-- Arma2 Torneos — rollback of 00000000000013 (Mercado Pago Checkout Pro PRODUCTION).
--
-- Containment of last resort, and only BEFORE any production purchase exists. Once a production purchase exists this
-- rollback refuses to run: the history (purchases, events, grants, watermarks) is never dropped. Production commerce is
-- then disabled, not removed: switch 'off' (no new purchase), gateway TORNEOS_COMMERCE_MODE unset (no checkout route),
-- frontend REACT_APP_TORNEOS_BILLING_MODE unset (no purchase UI) — while the payments service keeps receiving the
-- webhooks of payments already in flight (see docs/torneos/commerce-production/DEPLOY.md, "Desactivación").
--
-- Preconditions: exactly the 0013 state, no production purchase, no login holding the production role (drop the
-- production login first: it is the bootstrap's, never this file's). Postconditions: the 0013 objects are gone, the
-- environment CHECK is the 0002 one again and the certified TEST chain is byte-identical (pinned by md5).
BEGIN;

DO $pre$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(f, ', ') INTO v_missing FROM unnest(array[
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
  ]) f WHERE to_regprocedure(f) IS NULL;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION USING errcode = '55000', message = 'TORNEOS_MP_PRODUCTION_ROLLBACK_PRECONDITION_FAILED: missing ' || v_missing;
  END IF;
  IF EXISTS (SELECT 1 FROM public.tournament_purchases WHERE provider = 'MERCADO_PAGO' AND provider_environment = 'production') THEN
    RAISE EXCEPTION USING errcode = '55000', message = 'TORNEOS_MP_PRODUCTION_ROLLBACK_REFUSED: production purchases exist; disable production commerce instead';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid WHERE r.rolname = 'torneos_payment_production_service') THEN
    RAISE EXCEPTION USING errcode = '55000', message = 'TORNEOS_MP_PRODUCTION_ROLLBACK_REFUSED: a login still holds torneos_payment_production_service';
  END IF;
END $pre$;

DROP TRIGGER tournament_purchases_payment_environment ON public.tournament_purchases;
DROP FUNCTION public.create_tournament_season_production_checkout_purchase(uuid,uuid,uuid);
DROP FUNCTION public.get_tournament_season_purchases(uuid,uuid);
DROP FUNCTION public.get_production_provider_tournament_purchase(text);
DROP FUNCTION public.record_production_tournament_purchase_preference(uuid,text,timestamp with time zone);
DROP FUNCTION public.apply_production_tournament_payment_status(uuid,text,text,text,text,timestamp with time zone);
DROP FUNCTION public.apply_production_tournament_payment_reversal(uuid,text,text,text,text,timestamp with time zone);
DROP FUNCTION public.list_production_tournament_purchases_to_reconcile(integer);
DROP FUNCTION public.claim_production_tournament_purchase_check(uuid,integer);
DROP FUNCTION public.complete_production_tournament_purchase_check(uuid,text);
DROP FUNCTION private.order_production_tournament_payment(uuid,text,text,text,text,text,timestamp with time zone);
DROP FUNCTION private.unordered_production_tournament_payment_status(uuid,text,text,text,text);
DROP FUNCTION private.unordered_production_tournament_payment_reversal(uuid,text,text,text,text);
DROP FUNCTION private.activate_production_tournament_purchase(uuid,text,text,text);
DROP FUNCTION private.enforce_tournament_purchase_payment_environment();
DROP TABLE public.tournament_purchase_provider_checks;
DROP TABLE public.tournament_commerce_production_allowlist;
DROP TABLE public.tournament_commerce_production_settings;
REVOKE USAGE ON SCHEMA public FROM torneos_payment_production_service;
DROP ROLE torneos_payment_production_service;
ALTER TABLE public.tournament_purchases DROP CONSTRAINT tournament_purchases_environment_check;
ALTER TABLE public.tournament_purchases ADD CONSTRAINT tournament_purchases_environment_check CHECK (
  (provider = 'FAKE' AND provider_environment IN ('local','qa'))
  OR (provider = 'MERCADO_PAGO' AND provider_environment = 'test')
);

DO $post$
DECLARE
  v_bad text;
BEGIN
  SELECT string_agg(x, ', ') INTO v_bad FROM (
    SELECT 'environment CHECK' x WHERE (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'public.tournament_purchases'::regclass AND conname = 'tournament_purchases_environment_check')
      IS DISTINCT FROM 'CHECK ((((provider = ''FAKE''::text) AND (provider_environment = ANY (ARRAY[''local''::text, ''qa''::text]))) OR ((provider = ''MERCADO_PAGO''::text) AND (provider_environment = ''test''::text))))'
    UNION ALL SELECT 'role left' WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'torneos_payment_production_service')
    UNION ALL SELECT 'function left ' || p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname IN ('public','private') AND (p.proname ~ '_production_' OR p.proname IN ('get_tournament_season_purchases', 'enforce_tournament_purchase_payment_environment'))
    UNION ALL SELECT 'TEST body ' || pin.signature FROM (VALUES
      ('public.create_tournament_season_checkout_purchase(uuid,uuid,uuid)', 'ce838d427a83994f51c1366100d953ea'),
      ('public.order_verified_tournament_payment(uuid,text,text,text,text,text,text,text,timestamp with time zone)', 'c1b838f976de3426c01cd3f0748bb512'),
      ('public.record_tournament_purchase_preference(uuid,text,text,text,timestamp with time zone)', '6eb78b1189e03b55545aa1057aafae8d'),
      ('public.activate_verified_tournament_purchase(uuid,text,text,text,text,text,text)', '8a97cc62c510971331eb19de2f83326b')
    ) pin(signature, body_md5) WHERE (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = to_regprocedure(pin.signature)) IS DISTINCT FROM pin.body_md5
  ) s;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION USING errcode = '55000', message = 'TORNEOS_MP_PRODUCTION_ROLLBACK_POSTCONDITION_FAILED: ' || v_bad;
  END IF;
END $post$;

COMMIT;
