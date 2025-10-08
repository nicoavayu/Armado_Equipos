-- Migration: Fan-out survey start notifications at match start time
-- Date: 2025-10-07
-- Purpose: Insert a "survey" notification for every registered participant exactly when a partido starts.
-- Assumptions (adjust column names if your schema differs):
--  - partidos(id, start_time timestamptz, survey_start_notified boolean default false, status text)
--  - partido_participantes(id, partido_id, user_id, role)
--  - notifications(id, user_id, match_id, type, message, deep_link, created_at, read_at)
--  - auth.users exists

-- 1) Add flag column to partidos (idempotent)
ALTER TABLE IF EXISTS public.partidos
  ADD COLUMN IF NOT EXISTS survey_start_notified boolean DEFAULT false;

-- 2) Unique index to prevent duplicate notifications per user/match/type
CREATE UNIQUE INDEX IF NOT EXISTS uniq_notifications_user_match_type
  ON public.notifications (user_id, match_id, type);

-- 3) Ensure created_at default exists on notifications (optional)
ALTER TABLE IF EXISTS public.notifications
  ALTER COLUMN created_at SET DEFAULT now();

-- 4) SECURITY DEFINER function: fanout notifications for matches that started
CREATE OR REPLACE FUNCTION public.fanout_survey_start_notifications()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
DECLARE
  partido_row RECORD;
  participant_users uuid[];
BEGIN
  -- set a tight search_path to avoid unintended schema resolution
  PERFORM set_config('search_path', 'public,auth,pg_catalog', true);

  -- Loop over matches that should be notified: not yet notified and start_time <= now() in Argentina timezone
  FOR partido_row IN
    SELECT id AS partido_id
    FROM public.partidos
    WHERE COALESCE(survey_start_notified, false) = false
      AND start_time <= (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')
      -- optionally restrict by status; remove or adjust if needed
      AND (status IS NULL OR status IN ('active', 'scheduled'))
  LOOP
    -- get distinct registered user_ids for participants of this partido, ensuring they exist in auth.users
    SELECT array_agg(DISTINCT pp.user_id) INTO participant_users
    FROM public.partido_participantes pp
    JOIN auth.users u ON u.id = pp.user_id
    WHERE pp.partido_id = partido_row.partido_id;

    -- If no participants found, still mark as notified to avoid reprocessing
    IF participant_users IS NULL OR array_length(participant_users, 1) = 0 THEN
      UPDATE public.partidos SET survey_start_notified = true WHERE id = partido_row.partido_id;
      CONTINUE;
    END IF;

    -- Insert notifications for each participant; ON CONFLICT avoids duplicates
    INSERT INTO public.notifications (user_id, match_id, type, message, deep_link, created_at)
    SELECT uid::uuid, partido_row.partido_id, 'survey', 'El partido comenz\u00F3. Completá la encuesta.', '/partidos/' || partido_row.partido_id || '/encuesta', now()
    FROM unnest(participant_users) AS uid
    ON CONFLICT (user_id, match_id, type) DO NOTHING;

    -- Mark partido as notified in the same function
    UPDATE public.partidos SET survey_start_notified = true WHERE id = partido_row.partido_id;
  END LOOP;
END;
$func$;

-- 5) RLS: enable and create SELECT policy so users see only their notifications
ALTER TABLE IF EXISTS public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS users_see_own ON public.notifications;
CREATE POLICY users_see_own
  ON public.notifications
  FOR SELECT
  USING (user_id = auth.uid());

-- NOTE: We intentionally do NOT create a permissive INSERT policy on notifications.
-- The SECURITY DEFINER function should be owned by a privileged role that can insert despite RLS.
-- If your DB allows BYPASSRLS, set the function owner to that role. Example (requires superuser):
--   CREATE ROLE notifier NOLOGIN BYPASSRLS;
--   ALTER FUNCTION public.fanout_survey_start_notifications() OWNER TO notifier;
-- If you cannot create such a role on your hosted DB, run this migration as the DB owner (service role) so
-- the SECURITY DEFINER function executes with sufficient privileges.

-- 6) Scheduler: try to create a cron job using pg_cron if available (Supabase: may need enabling)
-- This schedules the function to run every minute.
-- If pg_cron is not installed on your DB, create a scheduler job in Supabase UI instead.

-- Try to schedule with pg_cron (idempotent safe wrapper)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- schedule name: survey_fanout_every_min
    PERFORM cron.schedule('survey_fanout_every_min', '*/1 * * * *', $$CALL public.fanout_survey_start_notifications();$$);
  END IF;
EXCEPTION WHEN others THEN
  -- ignore scheduling errors; admin can create scheduler job manually
  RAISE NOTICE 'pg_cron schedule not created: %', SQLERRM;
END $$;

-- 7) Optional: lightweight view to fetch unread survey notifications for current user
DROP VIEW IF EXISTS public.unread_survey_notifications_view;
CREATE VIEW public.unread_survey_notifications_view AS
SELECT id, user_id, match_id, type, message, deep_link, created_at
FROM public.notifications
WHERE type = 'survey' AND read_at IS NULL;

GRANT SELECT ON public.unread_survey_notifications_view TO authenticated;

-- README / Testing snippet (copy to your docs):
--
-- Testing steps:
-- 1) Create a partido scheduled to start in ~1 minute (Argentina timezone):
--    INSERT INTO public.partidos (id, start_time, status) VALUES (99999, now() + interval '1 minute', 'scheduled');
-- 2) Add participants (must be valid auth.users ids):
--    INSERT INTO public.partido_participantes (partido_id, user_id, role) VALUES
--      (99999, '11111111-1111-1111-1111-111111111111', 'player'),
--      (99999, '22222222-2222-2222-2222-222222222222', 'player');
-- 3) Wait for the scheduler tick (within ~1 minute). Then check notifications:
--    SELECT * FROM public.notifications WHERE match_id = 99999 AND type = 'survey';
--    Expect: one row per participant (including creator if present), deep_link = '/partidos/99999/encuesta'
-- 4) Re-run the function manually to confirm idempotency:
--    CALL public.fanout_survey_start_notifications();
--    Expect: no additional rows due to UNIQUE index and survey_start_notified flag.
--
-- Timezone note: the function compares partidos.start_time <= now() AT TIME ZONE 'America/Argentina/Buenos_Aires'.
-- Ensure your stored start_time values are TIMESTAMPTZ or normalized appropriately. If start_time is stored in local time without TZ,
-- adjust comparisons accordingly.

-- End of migration
