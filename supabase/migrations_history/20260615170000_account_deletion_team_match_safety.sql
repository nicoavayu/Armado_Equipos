-- ============================================================================
-- Account deletion safety for the teams / challenges / team_matches module
-- Date: 2026-06-15
-- Scope (additive + idempotent, safe to re-run):
--   Deleting a user (delete-account edge function -> delete usuarios row ->
--   auth.admin.deleteUser) only succeeds if EVERY foreign key that points at the
--   user is either ON DELETE SET NULL / CASCADE or detached beforehand.
--
--   The teams/challenges module relies on FK actions that are configured by
--   separately-applied migrations (20260421104500). If that drift is present in
--   an environment, a user that OWNS a team which already has played matches
--   cannot be deleted:
--     - teams.owner_user_id -> auth.users is still ON DELETE CASCADE,
--     - so deleting the auth user tries to CASCADE-delete the owned team,
--     - but team_matches.team_a_id / team_b_id -> teams are ON DELETE RESTRICT,
--     - the cascade is blocked (FK 23503) and the whole deletion aborts,
--       leaving a half-deleted account.
--
--   This migration re-asserts the safe state for every user-referencing column
--   in the module so that, once applied, account deletion is robust regardless
--   of prior drift. It deliberately does NOT touch
--   team_matches.team_a_id / team_b_id (kept ON DELETE RESTRICT) so that match
--   history is preserved: users are detached from teams/challenges, teams are
--   kept alive (owner set to NULL, is_active=false by the edge function), and
--   other users' head-to-head / per-rival history stays intact.
--
-- NOTE: Intentionally NOT applied to production by this change. Apply together
--       with the matching app build after review.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_ref record;
  v_constraint_name text;
BEGIN
  FOR v_ref IN
    SELECT *
    FROM (
      VALUES
        -- table,             column,                       foreign_schema, foreign_table, foreign_col, desired_constraint_name,                         delete_action, drop_not_null
        ('teams',                'owner_user_id',              'auth',   'users',    'id', 'teams_owner_user_id_fkey',                        'SET NULL', true),
        ('challenges',           'created_by_user_id',         'auth',   'users',    'id', 'challenges_created_by_user_id_fkey',              'SET NULL', true),
        ('challenges',           'accepted_by_user_id',        'auth',   'users',    'id', 'challenges_accepted_by_user_id_fkey',             'SET NULL', true),
        ('team_members',         'user_id',                    'public', 'usuarios', 'id', 'team_members_user_id_fkey',                       'SET NULL', true),
        ('team_chat_messages',   'user_id',                    'public', 'usuarios', 'id', 'team_chat_messages_user_id_fkey',                 'SET NULL', true),
        ('challenge_team_squad', 'selected_by',                'public', 'usuarios', 'id', 'challenge_team_squad_selected_by_fkey',           'SET NULL', true),
        ('team_matches',         'result_reported_by_team_id', 'public', 'teams',    'id', 'team_matches_result_reported_by_team_id_fkey',    'SET NULL', true)
    ) AS refs(
      table_name,
      column_name,
      foreign_schema,
      foreign_table,
      foreign_column,
      desired_constraint_name,
      delete_action,
      drop_not_null
    )
  LOOP
    -- Skip rows that do not exist in this environment (older/newer schemas).
    IF to_regclass(format('public.%I', v_ref.table_name)) IS NULL
      OR to_regclass(format('%I.%I', v_ref.foreign_schema, v_ref.foreign_table)) IS NULL
      OR NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = v_ref.table_name
          AND column_name = v_ref.column_name
      ) THEN
      CONTINUE;
    END IF;

    -- Make the user reference nullable so a detached account leaves NULL, not a
    -- constraint violation.
    IF v_ref.drop_not_null THEN
      EXECUTE format(
        'ALTER TABLE public.%I ALTER COLUMN %I DROP NOT NULL',
        v_ref.table_name,
        v_ref.column_name
      );
    END IF;

    -- Drop whatever FK currently guards this column (name-agnostic).
    FOR v_constraint_name IN
      SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
      JOIN unnest(con.conkey) fk_col(attnum) ON true
      JOIN pg_attribute att ON att.attrelid = con.conrelid
        AND att.attnum = fk_col.attnum
      WHERE nsp.nspname = 'public'
        AND rel.relname = v_ref.table_name
        AND con.contype = 'f'
        AND att.attname = v_ref.column_name
    LOOP
      EXECUTE format(
        'ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I',
        v_ref.table_name,
        v_constraint_name
      );
    END LOOP;

    -- Re-create it with the safe ON DELETE action.
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I.%I(%I) ON DELETE %s',
      v_ref.table_name,
      v_ref.desired_constraint_name,
      v_ref.column_name,
      v_ref.foreign_schema,
      v_ref.foreign_table,
      v_ref.foreign_column,
      v_ref.delete_action
    );
  END LOOP;
END $$;

COMMIT;
