-- Migration: create no_show_recovery_state table
-- Tracks recovery streaks for users after no-show penalties

CREATE TABLE IF NOT EXISTS public.no_show_recovery_state (
  user_id uuid PRIMARY KEY,
  current_streak integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_no_show_recovery_state_updated_at ON public.no_show_recovery_state (updated_at);

-- End of migration
