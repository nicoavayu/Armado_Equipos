-- Create canonical tables for no-show penalties and recovery cycles.
-- These tables are consumed by src/services/db/penalties.js.

CREATE TABLE IF NOT EXISTS public.rating_adjustments (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  partido_id BIGINT NOT NULL REFERENCES public.partidos(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  amount NUMERIC(8,2) NOT NULL,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT rating_adjustments_type_check
    CHECK (type IN ('no_show_penalty', 'no_show_recovery')),
  CONSTRAINT rating_adjustments_nonzero_amount_check
    CHECK (amount <> 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS rating_adjustments_user_match_type_uidx
  ON public.rating_adjustments (user_id, partido_id, type);

CREATE INDEX IF NOT EXISTS rating_adjustments_user_id_idx
  ON public.rating_adjustments (user_id);

CREATE INDEX IF NOT EXISTS rating_adjustments_partido_id_idx
  ON public.rating_adjustments (partido_id);

CREATE INDEX IF NOT EXISTS rating_adjustments_type_idx
  ON public.rating_adjustments (type);

CREATE TABLE IF NOT EXISTS public.no_show_recovery_state (
  user_id UUID PRIMARY KEY REFERENCES public.usuarios(id) ON DELETE CASCADE,
  current_streak INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT no_show_recovery_state_streak_non_negative
    CHECK (current_streak >= 0)
);

ALTER TABLE public.rating_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.no_show_recovery_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rating_adjustments_select_authenticated ON public.rating_adjustments;
CREATE POLICY rating_adjustments_select_authenticated
ON public.rating_adjustments
FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS rating_adjustments_insert_authenticated ON public.rating_adjustments;
CREATE POLICY rating_adjustments_insert_authenticated
ON public.rating_adjustments
FOR INSERT
TO authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS no_show_recovery_state_select_authenticated ON public.no_show_recovery_state;
CREATE POLICY no_show_recovery_state_select_authenticated
ON public.no_show_recovery_state
FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS no_show_recovery_state_insert_authenticated ON public.no_show_recovery_state;
CREATE POLICY no_show_recovery_state_insert_authenticated
ON public.no_show_recovery_state
FOR INSERT
TO authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS no_show_recovery_state_update_authenticated ON public.no_show_recovery_state;
CREATE POLICY no_show_recovery_state_update_authenticated
ON public.no_show_recovery_state
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

GRANT SELECT, INSERT ON public.rating_adjustments TO authenticated;
GRANT SELECT, INSERT ON public.rating_adjustments TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.rating_adjustments_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.rating_adjustments_id_seq TO service_role;

GRANT SELECT, INSERT, UPDATE ON public.no_show_recovery_state TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.no_show_recovery_state TO service_role;

COMMENT ON TABLE public.rating_adjustments
  IS 'Immutable per-match rating deltas for no-show penalties and recoveries.';

COMMENT ON TABLE public.no_show_recovery_state
  IS 'Rolling attendance streak state used to grant periodic no-show recovery bonuses.';
