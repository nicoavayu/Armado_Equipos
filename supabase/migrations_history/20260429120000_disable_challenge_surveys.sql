BEGIN;

CREATE OR REPLACE FUNCTION public.is_team_match_partido(
  p_partido_id bigint
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.team_matches tm
    WHERE tm.partido_id = p_partido_id
  );
$$;

CREATE OR REPLACE FUNCTION public.prevent_challenge_survey_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type text := lower(trim(COALESCE(NEW.type, '')));
  v_match_ref text;
  v_partido_id bigint;
BEGIN
  IF v_type NOT IN (
    'survey',
    'survey_start',
    'post_match_survey',
    'survey_reminder',
    'survey_reminder_12h',
    'survey_results',
    'survey_results_ready',
    'awards_ready',
    'award_won',
    'survey_finished'
  ) THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.data, '{}'::jsonb) ? 'team_match_id'
     OR COALESCE(NEW.data, '{}'::jsonb) ? 'teamMatchId'
     OR COALESCE(NEW.data, '{}'::jsonb) ? 'challenge_id'
     OR COALESCE(NEW.data, '{}'::jsonb) ? 'challengeId'
     OR lower(trim(COALESCE(NEW.data ->> 'source', ''))) = 'team_challenge'
     OR lower(trim(COALESCE(NEW.data ->> 'origin_type', NEW.data ->> 'originType', ''))) = 'challenge' THEN
    RETURN NULL;
  END IF;

  v_match_ref := COALESCE(
    NEW.partido_id::text,
    NEW.data ->> 'partido_id',
    NEW.data ->> 'partidoId',
    NEW.data ->> 'match_id',
    NEW.data ->> 'matchId'
  );

  IF v_match_ref ~ '^[0-9]+$' THEN
    v_partido_id := v_match_ref::bigint;
    IF public.is_team_match_partido(v_partido_id) THEN
      RETURN NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_challenge_survey_notifications ON public.notifications;
CREATE TRIGGER trg_prevent_challenge_survey_notifications
BEFORE INSERT ON public.notifications
FOR EACH ROW
EXECUTE FUNCTION public.prevent_challenge_survey_notifications();

CREATE OR REPLACE FUNCTION public.prevent_challenge_post_match_survey_rows()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_team_match_partido(NEW.partido_id) THEN
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_challenge_post_match_surveys ON public.post_match_surveys;
CREATE TRIGGER trg_prevent_challenge_post_match_surveys
BEFORE INSERT OR UPDATE ON public.post_match_surveys
FOR EACH ROW
EXECUTE FUNCTION public.prevent_challenge_post_match_survey_rows();

CREATE OR REPLACE FUNCTION public.prevent_challenge_survey_results_rows()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_team_match_partido(NEW.partido_id) THEN
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_challenge_survey_results ON public.survey_results;
CREATE TRIGGER trg_prevent_challenge_survey_results
BEFORE INSERT OR UPDATE ON public.survey_results
FOR EACH ROW
EXECUTE FUNCTION public.prevent_challenge_survey_results_rows();

CREATE OR REPLACE FUNCTION public.prevent_challenge_survey_awards_rows()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_team_match_partido(NEW.partido_id) THEN
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_challenge_survey_awards ON public.player_awards;
CREATE TRIGGER trg_prevent_challenge_survey_awards
BEFORE INSERT OR UPDATE ON public.player_awards
FOR EACH ROW
EXECUTE FUNCTION public.prevent_challenge_survey_awards_rows();

COMMIT;
