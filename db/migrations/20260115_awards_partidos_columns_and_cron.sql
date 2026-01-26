-- Migration: Add awards and survey deadline fields to partidos, trigger for survey_start, and processing function
BEGIN;

-- 1) Add columns to public.partidos
ALTER TABLE IF EXISTS public.partidos
  ADD COLUMN IF NOT EXISTS awards_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS awards_resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS awards_notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS survey_deadline_at timestamptz;

-- 2) Trigger function: set partidos.survey_deadline_at on survey_start/post_match_survey notification
CREATE OR REPLACE FUNCTION public.fn_set_survey_deadline_on_survey_start()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  pid int;
BEGIN
  -- Determine partido id from multiple possible sources: explicit partido_id, legacy match_ref, or data payload
  pid := COALESCE(
    NEW.partido_id,
    -- match_ref may be populated by older code; try it first for compatibility
    (CASE WHEN NEW.match_ref IS NOT NULL THEN (NEW.match_ref::text)::int ELSE NULL END),
    NULLIF((NEW.data->>'match_id')::int, NULL),
    NULLIF((NEW.data->>'matchId')::int, NULL)
  );
  IF pid IS NULL THEN
    RETURN NEW;
  END IF;

  -- set a short deadline if not already set (2 minutes for debug/dev)
  UPDATE public.partidos
  SET survey_deadline_at = COALESCE(survey_deadline_at, now() + interval '2 minutes')
  WHERE id = pid;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_survey_deadline_on_notifications ON public.notifications;
CREATE TRIGGER trg_set_survey_deadline_on_notifications
AFTER INSERT ON public.notifications
FOR EACH ROW
WHEN (NEW.type = 'survey_start' OR NEW.type = 'post_match_survey')
EXECUTE PROCEDURE public.fn_set_survey_deadline_on_survey_start();

-- 3) Processing function: find matches whose survey_deadline passed and notify roster; compute awards when threshold met
CREATE OR REPLACE FUNCTION public.process_awards_for_matches()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  r RECORD;
  voters_count int;
  notif_type text;
  notif_title text;
  notif_message text;
BEGIN
  FOR r IN
    SELECT id FROM public.partidos
    WHERE awards_status = 'pending'
      AND survey_deadline_at IS NOT NULL
      AND now() >= survey_deadline_at
      AND awards_notified_at IS NULL
  LOOP
    SELECT COUNT(DISTINCT votante_id) INTO voters_count
    FROM public.post_match_surveys
    WHERE partido_id = r.id;

    IF voters_count >= 3 THEN
      -- compute awards via existing server-side function/RPC
      PERFORM compute_awards_for_match(r.id);
      UPDATE public.partidos SET awards_status = 'ready', awards_resolved_at = now() WHERE id = r.id;
      notif_type := 'awards_ready';
      notif_title := 'Premios listos';
      notif_message := 'Ya podés ver los premios';
    ELSE
      UPDATE public.partidos SET awards_status = 'insufficient', awards_resolved_at = now() WHERE id = r.id;
      notif_type := 'awards_insufficient_votes';
      notif_title := 'Resultados - votos insuficientes';
      notif_message := 'No alcanzaron votos para premiar';
    END IF;

    -- Notify all registered users in the match roster (idempotent using conflict target)
    INSERT INTO public.notifications (user_id, type, title, message, partido_id, data, created_at)
    SELECT j.usuario_id, notif_type, notif_title, notif_message, r.id,
           json_build_object('match_id', r.id, 'resultsUrl', CONCAT('/resultados-encuesta/', r.id, '?showAwards=1'))::jsonb,
           now()
    FROM public.jugadores j
    WHERE j.partido_id = r.id AND j.usuario_id IS NOT NULL
    ON CONFLICT (user_id, partido_id, type) DO NOTHING;

    -- mark notified
    UPDATE public.partidos SET awards_notified_at = now() WHERE id = r.id;
  END LOOP;
END;
$$;

-- Optional: schedule via pg_cron if available (uncomment to enable scheduling)
-- SELECT cron.schedule('process_awards_every_minute', '*/1 * * * *', $$ SELECT public.process_awards_for_matches(); $$);

-- BACKFILL: set partido_id from match_ref for existing notifications where partido_id is NULL
-- This helps normalize legacy rows created before partido_id was consistently populated.
-- Only attempt numeric casts to avoid failing on non-numeric match_ref values.
UPDATE public.notifications
SET partido_id = (match_ref::int)
WHERE partido_id IS NULL AND match_ref IS NOT NULL AND match_ref::text ~ '^\d+$';

COMMIT;
