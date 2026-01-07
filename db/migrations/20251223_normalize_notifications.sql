-- Migration: Normalize notifications payloads and backfill partido_id and data.match_id
-- Date: 2025-12-23

BEGIN;

-- 1) Add canonical partido_id column to notifications and notifications_ext
ALTER TABLE IF EXISTS public.notifications ADD COLUMN IF NOT EXISTS partido_id bigint;
ALTER TABLE IF EXISTS public.notifications_ext ADD COLUMN IF NOT EXISTS partido_id bigint;

-- 2) Backfill partido_id from common JSON keys if possible (matchId, match_id, match_id_text)
-- Use regex check to avoid casting non-numeric values

UPDATE public.notifications
SET partido_id = (data->>'matchId')::bigint
WHERE partido_id IS NULL AND (data->>'matchId') IS NOT NULL AND (data->>'matchId') ~ '^\\d+$';

UPDATE public.notifications
SET partido_id = (data->>'match_id')::bigint
WHERE partido_id IS NULL AND (data->>'match_id') IS NOT NULL AND (data->>'match_id') ~ '^\\d+$';

UPDATE public.notifications
SET partido_id = (data->>'match_id_text')::bigint
WHERE partido_id IS NULL AND (data->>'match_id_text') IS NOT NULL AND (data->>'match_id_text') ~ '^\\d+$';

-- notifications_ext
UPDATE public.notifications_ext
SET partido_id = (data->>'matchId')::bigint
WHERE partido_id IS NULL AND (data->>'matchId') IS NOT NULL AND (data->>'matchId') ~ '^\\d+$';

UPDATE public.notifications_ext
SET partido_id = (data->>'match_id')::bigint
WHERE partido_id IS NULL AND (data->>'match_id') IS NOT NULL AND (data->>'match_id') ~ '^\\d+$';

UPDATE public.notifications_ext
SET partido_id = (data->>'match_id_text')::bigint
WHERE partido_id IS NULL AND (data->>'match_id_text') IS NOT NULL AND (data->>'match_id_text') ~ '^\\d+$';

-- 3) Ensure canonical data.match_id exists (string) for notifications with partido_id
UPDATE public.notifications
SET data = jsonb_set(data, '{match_id}', to_jsonb(COALESCE(data->>'match_id', data->>'matchId', data->>'match_id_text', (partido_id)::text)), true)
WHERE (data->>'match_id') IS NULL AND partido_id IS NOT NULL;

UPDATE public.notifications_ext
SET data = jsonb_set(data, '{match_id}', to_jsonb(COALESCE(data->>'match_id', data->>'matchId', data->>'match_id_text', (partido_id)::text)), true)
WHERE (data->>'match_id') IS NULL AND partido_id IS NOT NULL;

-- 4) Add indexes to speed lookups by partido_id
CREATE INDEX IF NOT EXISTS idx_notifications_partido_id ON public.notifications (partido_id);
CREATE INDEX IF NOT EXISTS idx_notifications_ext_partido_id ON public.notifications_ext (partido_id);

COMMIT;

-- IMPORTANT: The DB-side fanout is implemented in function public.fanout_survey_start_notifications().
-- After applying this migration, schedule a periodic job that executes:
--   CALL public.fanout_survey_start_notifications();
-- Suggested frequency: every 1 minute.
--
-- If your DB supports pg_cron and it is enabled, you can create the schedule with:
-- SELECT cron.schedule('fanout_survey_start_notifications_every_min', '* * * * *', $$CALL public.fanout_survey_start_notifications();$$);
--
-- Alternatively, use the Supabase UI "Scheduled SQL" job and set it to run:
--   CALL public.fanout_survey_start_notifications();
-- every 1 minute.
