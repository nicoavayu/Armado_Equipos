-- ACCOUNT ERASURE 0021 rollback: removes exactly what 00000000000021 added (the erasure and confirmation functions, the
-- pseudonym function, the ledger, the role torneos_erasure_writer; DROP ROLE also removes the out-of-band login's
-- membership in it, the login itself is left for the operator to drop or keep, see the runbook).
-- It does NOT and cannot undo an erasure: anonymised names, cleared emails, removed memberships, revoked
-- roles, archived organizations and severed identities stay as they are (irreversible by design; the originals are not
-- kept anywhere). What the ledger records (which identities were severed, the pending storage objects) is lost with it,
-- so the rollback refuses while the ledger has rows unless the session carries
--   SET torneos.account_erasure_rollback_force = 'DISCARD ERASURE LEDGER';
-- Run it only with the gateway route disabled or the Core function not yet calling it: without the function, the route
-- answers 503 and Core keeps every account (fail-closed), which is visible but safe.
BEGIN;
DO $pre$
BEGIN
  IF to_regprocedure('private.erase_tournament_account(uuid,uuid)') IS NULL
    OR to_regprocedure('private.account_erasure_label(text,uuid,uuid)') IS NULL
    OR to_regprocedure('private.confirm_tournament_account_erasure(uuid,uuid)') IS NULL
    OR to_regclass('private.tournament_account_erasures') IS NULL
    OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'torneos_erasure_writer') THEN
    RAISE EXCEPTION 'TORNEOS_ACCOUNT_ERASURE_ROLLBACK_PRECONDITION_FAILED: 00000000000021 is not applied';
  END IF;
  IF EXISTS (SELECT 1 FROM private.tournament_account_erasures)
    AND coalesce(current_setting('torneos.account_erasure_rollback_force', true), '') <> 'DISCARD ERASURE LEDGER' THEN
    RAISE EXCEPTION 'TORNEOS_ACCOUNT_ERASURE_ROLLBACK_REFUSED: the erasure ledger has rows (force setting required)';
  END IF;
END
$pre$;
drop function private.confirm_tournament_account_erasure(uuid, uuid);
drop function private.erase_tournament_account(uuid, uuid);
drop function private.account_erasure_label(text, uuid, uuid);
drop table private.tournament_account_erasures;
revoke usage on schema private from torneos_erasure_writer;
drop role torneos_erasure_writer;
DO $post$
BEGIN
  IF to_regprocedure('private.erase_tournament_account(uuid,uuid)') IS NOT NULL
    OR to_regprocedure('private.confirm_tournament_account_erasure(uuid,uuid)') IS NOT NULL
    OR to_regprocedure('private.account_erasure_label(text,uuid,uuid)') IS NOT NULL
    OR to_regclass('private.tournament_account_erasures') IS NOT NULL
    OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'torneos_erasure_writer') THEN
    RAISE EXCEPTION 'TORNEOS_ACCOUNT_ERASURE_ROLLBACK_POSTCONDITION_FAILED';
  END IF;
  -- The guard triggers the erasure toggles are enabled (an aborted erasure can never leave them off: DDL is transactional).
  IF EXISTS (
    SELECT 1 FROM pg_trigger t
    WHERE t.tgname IN ('torneos_identity_immutable', 'tournament_organization_members_protect_owner',
      'tournament_match_squad_players_history_guard', 'tournament_squad_player_suspension_guard',
      'tournament_match_squad_players_scope_guard', 'tournament_match_operation_players_completed_guard',
      'tournament_match_operation_players_history_guard', 'tournament_operation_player_suspension_guard',
      'tournament_match_availability_scope_guard')
      AND t.tgenabled <> 'O'
  ) THEN
    RAISE EXCEPTION 'TORNEOS_ACCOUNT_ERASURE_ROLLBACK_POSTCONDITION_FAILED: a guard trigger is not enabled';
  END IF;
END
$post$;
COMMIT;
