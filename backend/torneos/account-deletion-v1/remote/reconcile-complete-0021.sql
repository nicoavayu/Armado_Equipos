-- ACCOUNT ERASURE 0021 — operator COMPLETION of ONE reconciled erasure (a write: with Nico's GO, as the installer).
-- Use it ONLY after checking in Core (read only) that the Core user of this row NO LONGER exists:
--   Core SQL editor:  select count(*) from auth.users where encode(sha256(convert_to(id::text, 'UTF8')), 'hex') = '<core_user_sha256>';
--   → 0: Core finished, only its confirmation was lost → run this file with the row's erasure_id.
--   → 1: the Core account still exists → do NOT run this; see ../README.md «Reconciliación» (the person retries).
-- Replace <erasure_id> (one uuid from reconcile-0021.sql). One transaction:
--   1. if an identity for the same Core user was re-created in Torneos after the erasure, it is erased now (the same
--      confirmation function Core calls; the Core user id is read from that identity row, never typed by hand);
--   2. the row moves to core_confirmed, by 'operator'. Nothing else changes; a second run changes nothing.
BEGIN;
SET LOCAL statement_timeout = '30s';
DO $complete$
DECLARE
  v_core uuid;
  v_request uuid;
BEGIN
  -- Read first, then call (the erasure alters torneos_identity: no query on it may still be open in this session).
  SELECT i.core_user_id, e.request_id INTO v_core, v_request
  FROM private.tournament_account_erasures e
  JOIN public.torneos_identity i ON encode(sha256(convert_to(i.core_user_id::text, 'UTF8')), 'hex') = e.core_user_sha256
  WHERE e.id = '<erasure_id>'::uuid AND e.state = 'torneos_erased';
  IF v_core IS NOT NULL THEN
    PERFORM private.confirm_tournament_account_erasure(v_core, v_request);
  END IF;
END
$complete$;
update private.tournament_account_erasures
set state = 'core_confirmed', core_confirmed_at = now(), core_confirmed_by = 'operator'
where id = '<erasure_id>'::uuid and state = 'torneos_erased';
COMMIT;
