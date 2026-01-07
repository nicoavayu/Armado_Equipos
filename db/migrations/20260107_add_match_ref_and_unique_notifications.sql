-- Migration: Add canonical match_ref GENERATED column and unique index for strong idempotency
-- Date: 2026-01-07

BEGIN;

-- 1) Add a stored generated column `match_ref` which normalizes the partido reference
ALTER TABLE IF EXISTS public.notifications
  ADD COLUMN IF NOT EXISTS match_ref bigint
    GENERATED ALWAYS AS (
      COALESCE(
        partido_id,
        (data->>'match_id')::bigint,
        (data->>'matchId')::bigint
      )
    ) STORED;

-- 2) Create a UNIQUE CONSTRAINT on (user_id, match_ref, type) if it does not already exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uniq_notifications_user_matchref_type'
  ) THEN
    ALTER TABLE public.notifications
      ADD CONSTRAINT uniq_notifications_user_matchref_type
      UNIQUE (user_id, match_ref, type);
  END IF;
END$$;

-- 3) Keep an index on partido_id for fast lookups (if not present)
CREATE INDEX IF NOT EXISTS idx_notifications_partido_id ON public.notifications (partido_id);

COMMIT;

-- Fallback instructions (if your Postgres version does not support GENERATED STORED columns):
-- Instead of creating `match_ref`, you can create a unique index on an expression:
-- CREATE UNIQUE INDEX IF NOT EXISTS uniq_notifications_user_matchref_type_expr
--   ON public.notifications (user_id, ((COALESCE(partido_id, (data->>'match_id')::bigint, (data->>'matchId')::bigint))), type)
--   WHERE (COALESCE(partido_id, (data->>'match_id')::bigint, (data->>'matchId')::bigint)) IS NOT NULL;
-- This provides equivalent strong idempotency without altering the table schema.
