-- Migration: Fix fanout_survey_start_notifications to use UTC comparison and drop legacy triggers
-- Date: 2025-10-07

-- 1) Reaffirm unique index and survey flag
CREATE UNIQUE INDEX IF NOT EXISTS uniq_notifications_user_match_type
  ON public.notifications (user_id, match_id, type);

ALTER TABLE IF EXISTS public.partidos
  ADD COLUMN IF NOT EXISTS survey_start_notified boolean DEFAULT false;

-- 2) Drop known legacy triggers that might send admin-only notifications on partido creation
-- These DROPs are safe and idempotent. If your legacy trigger has a different name, inspect pg_trigger.
DROP TRIGGER IF EXISTS trg_notify_survey_on_partidos ON public.partidos;
DROP TRIGGER IF EXISTS trg_survey_on_partido_insert ON public.partidos;
DROP TRIGGER IF EXISTS trg_notify_on_partidos_insert ON public.partidos;

-- 3) Replace function to use UTC comparison (start_time <= now()) and process multiple partidos in a single transaction
CREATE OR REPLACE FUNCTION public.fanout_survey_start_notifications()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
DECLARE
  partido_row RECORD;
  participant_users uuid[];
  processed_ids uuid[] := array[]::uuid[];
BEGIN
  PERFORM set_config('search_path', 'public,auth,pg_catalog', true);

  FOR partido_row IN
    SELECT id AS partido_id
    FROM public.partidos
    WHERE COALESCE(survey_start_notified, false) = false
      AND start_time <= now()
      AND (status IS NULL OR status IN ('active', 'scheduled'))
  LOOP
    SELECT array_agg(DISTINCT pp.user_id) INTO participant_users
    FROM public.partido_participantes pp
    JOIN auth.users u ON u.id = pp.user_id
    WHERE pp.partido_id = partido_row.partido_id;

    IF participant_users IS NULL OR array_length(participant_users, 1) = 0 THEN
      processed_ids := array_append(processed_ids, partido_row.partido_id);
      CONTINUE;
    END IF;

    INSERT INTO public.notifications (user_id, match_id, type, message, deep_link, created_at)
    SELECT uid::uuid, partido_row.partido_id, 'survey', 'El partido comenz\u00F3. Completá la encuesta.', '/partidos/' || partido_row.partido_id || '/encuesta', now()
    FROM unnest(participant_users) AS uid
    ON CONFLICT (user_id, match_id, type) DO NOTHING;

    processed_ids := array_append(processed_ids, partido_row.partido_id);
  END LOOP;

  IF array_length(processed_ids,1) > 0 THEN
    UPDATE public.partidos SET survey_start_notified = true WHERE id = ANY(processed_ids);
  END IF;
END;
$func$;

-- 4) RLS: ensure select policy exists
ALTER TABLE IF EXISTS public.notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS users_see_own ON public.notifications;
CREATE POLICY users_see_own
  ON public.notifications
  FOR SELECT
  USING (user_id = auth.uid());

-- 5) Scheduler: advise creating Supabase Scheduler job to call this every minute
-- Supabase UI: create a scheduled SQL job that runs: CALL public.fanout_survey_start_notifications(); every 1 minute.

-- End of migration
