-- Migration: Setup notifications read tracking and survey constraints
-- Date: 2025-01-XX
-- Purpose: Add read columns, RLS policies, survey constraints, and auto-mark trigger

-- 1) Ensure read columns exist on notifications table
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS read boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS read_at timestamptz;

-- 2) RLS policy for users to update their own notifications
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='notifications' AND policyname='notifications_update_own'
  ) THEN
    CREATE POLICY notifications_update_own
    ON public.notifications FOR UPDATE
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());
  END IF;
END$$;

-- 3) Prevent duplicate survey responses per user/match in post_match_surveys
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_survey_once'
      AND conrelid = 'public.post_match_surveys'::regclass
  ) THEN
    ALTER TABLE public.post_match_surveys
      ADD CONSTRAINT uq_survey_once UNIQUE (votante_id, partido_id);
  END IF;
END
$$;

-- 4) Function to auto-mark survey notification as read when survey is submitted
CREATE OR REPLACE FUNCTION public.mark_survey_notif_read()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  -- Get user_id from votante_id (jugadores table)
  SELECT usuario_id INTO v_user_id
  FROM jugadores
  WHERE id = NEW.votante_id
  LIMIT 1;
  
  IF v_user_id IS NOT NULL THEN
    UPDATE public.notifications
    SET read = true, read_at = now()
    WHERE user_id = v_user_id
      AND type = 'survey_start'
      AND (data->>'match_id')::bigint = NEW.partido_id
      AND read = false;
  END IF;
  
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.mark_survey_notif_read() OWNER TO postgres;

-- 5) Trigger to execute function after survey submission
DROP TRIGGER IF EXISTS trg_mark_survey_notif_read ON public.post_match_surveys;
CREATE TRIGGER trg_mark_survey_notif_read
AFTER INSERT ON public.post_match_surveys
FOR EACH ROW EXECUTE FUNCTION public.mark_survey_notif_read();
