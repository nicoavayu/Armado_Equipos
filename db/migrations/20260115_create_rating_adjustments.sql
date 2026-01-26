-- Migration: create rating_adjustments table
-- Adds a table to record rating adjustments and guard against duplicate penalty/recovery applications

CREATE TABLE IF NOT EXISTS public.rating_adjustments (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL,
  partido_id bigint NOT NULL,
  type text NOT NULL,
  amount numeric NOT NULL,
  meta jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Unique constraint to prevent duplicate adjustments for same match/user/type
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE c.contype = 'u'
      AND t.relname = 'rating_adjustments'
      AND array_to_string(c.conkey, ',') IS NOT NULL
  ) THEN
    ALTER TABLE public.rating_adjustments
    ADD CONSTRAINT rating_adjustments_unique_partido_user_type UNIQUE (partido_id, user_id, type);
  END IF;
EXCEPTION WHEN others THEN
  -- ignore if constraint exists or cannot be added
  RAISE NOTICE 'Could not add unique constraint for rating_adjustments: %', SQLERRM;
END$$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_rating_adjustments_user_created_at ON public.rating_adjustments (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rating_adjustments_partido ON public.rating_adjustments (partido_id);

-- End of migration
