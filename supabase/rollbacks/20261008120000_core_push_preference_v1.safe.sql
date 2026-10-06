-- SAFE CONTAINMENT for 20261008120000_core_push_preference_v1.sql
-- PRECONDITION: the frontend that shows «Recibir notificaciones de Arma2 en el teléfono» is rolled back or the
--   control is hidden (otherwise the screen reports an error when saving).
-- PRESERVES: public.usuarios.push_enabled values (a pre-existing column that the main notification trigger already
--   honoured before this migration), notification_delivery_log rows (rows skipped as push_disabled stay skipped: the
--   person had opted out when they were queued), device tokens.
-- EFFECT: the targeted dispatch flows stop looking at the preference again (the behaviour before the migration) and
--   nobody can change it from the app. Nothing is sent by this script.
-- NON-REVERSIBLE ACTIONS: none. DROP FUNCTION / DELETE are out of scope (a forward migration removes them if needed).

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SELECT pg_advisory_xact_lock(hashtextextended('arma2-core-push-preference-safe-rollback', 0));

DROP TRIGGER IF EXISTS trg_notification_delivery_push_preference ON public.notification_delivery_log;

REVOKE ALL ON FUNCTION public.get_my_push_preference() FROM authenticated, anon, PUBLIC;
REVOKE ALL ON FUNCTION public.set_my_push_preference(boolean) FROM authenticated, anon, PUBLIC;

-- Postcondition: no client can read or change the preference and the queue no longer rewrites rows.
DO $rollback$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_notification_delivery_push_preference' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'CORE_PUSH_PREFERENCE_ROLLBACK_FAILED: trigger still present';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.routine_privileges
    WHERE routine_schema = 'public'
      AND routine_name IN ('get_my_push_preference', 'set_my_push_preference')
      AND grantee IN ('PUBLIC', 'anon', 'authenticated')
      AND privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'CORE_PUSH_PREFERENCE_ROLLBACK_FAILED: client EXECUTE still granted';
  END IF;
END
$rollback$;

COMMIT;
