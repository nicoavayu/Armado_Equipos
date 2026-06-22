-- Enforce one survey per (votante_id, partido_id).
--
-- The `uq_survey_once` constraint already lives in
-- `setup_notifications_read_and_survey_constraints.sql`, but that file has no
-- 14-digit timestamp prefix so `supabase db push` skips it -> the constraint is
-- not actually applied. This timestamped migration applies it safely:
--   1) Deduplicate existing rows first (keeping one per pair) so ADD CONSTRAINT
--      cannot fail on pre-existing duplicates.
--   2) Add the unique constraint only if missing (idempotent).
--
-- Dedup uses ctid (present on every row) so it does not assume an `id` column.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.post_match_surveys') IS NULL THEN
    RAISE NOTICE 'post_match_surveys does not exist; skipping uq_survey_once.';
    RETURN;
  END IF;

  -- 1) Keep a single row per (votante_id, partido_id); drop the rest.
  --    NULL votante_id/partido_id are left untouched (UNIQUE treats NULLs as
  --    distinct, so they cannot violate the constraint).
  DELETE FROM public.post_match_surveys s
  USING public.post_match_surveys keep
  WHERE s.votante_id IS NOT NULL
    AND s.partido_id IS NOT NULL
    AND s.votante_id = keep.votante_id
    AND s.partido_id = keep.partido_id
    AND s.ctid < keep.ctid;

  -- 2) Add the unique constraint if it is not already present.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'uq_survey_once'
      AND conrelid = 'public.post_match_surveys'::regclass
  ) THEN
    ALTER TABLE public.post_match_surveys
      ADD CONSTRAINT uq_survey_once UNIQUE (votante_id, partido_id);
  END IF;
END
$$;

COMMIT;
