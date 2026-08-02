-- ===========================================================================
-- Security patch M1 (observability tables) — survey_progress (Stage A)
-- ---------------------------------------------------------------------------
-- `survey_progress` had `FOR ALL authenticated USING(true) WITH CHECK(true)`.
-- It is written ONLY by the AFTER INSERT triggers on post_match_surveys / votos
-- (check_survey_completion_from_post_match_surveys / check_survey_completion),
-- and read by nobody in the client. Those trigger functions are SECURITY
-- INVOKER today, so they need the invoking role (incl. anon during public
-- voting) to hold write access.
--
-- Fix: convert BOTH trigger functions to SECURITY DEFINER + SET search_path
-- (bodies unchanged), then revoke ALL direct access for authenticated/anon and
-- drop the permissive policy. The public survey submit KEEPS working — the
-- INSERT into post_match_surveys by anon fires the DEFINER trigger, which
-- populates survey_progress with owner rights regardless of anon's grants.
-- This is NON-BREAKING and hardens the anon path. Rollback SQL at the bottom.
-- ===========================================================================

BEGIN;

-- Observability-only trigger (post_match_surveys). Body identical to
-- 20260310183000_fix_survey_closure_single_path.sql, now SECURITY DEFINER.
CREATE OR REPLACE FUNCTION public.check_survey_completion_from_post_match_surveys()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_response_count int;
BEGIN
  INSERT INTO public.survey_progress (
    partido_id,
    enabled_at,
    first_response_at,
    response_count,
    results_notified,
    created_at,
    updated_at
  )
  VALUES (NEW.partido_id, now(), NEW.created_at, 0, false, now(), now())
  ON CONFLICT (partido_id) DO NOTHING;

  SELECT COUNT(DISTINCT s.votante_id)
  INTO v_response_count
  FROM public.post_match_surveys s
  WHERE s.partido_id = NEW.partido_id;

  UPDATE public.survey_progress
  SET
    response_count = COALESCE(v_response_count, 0),
    first_response_at = COALESCE(first_response_at, NEW.created_at, now()),
    updated_at = now()
  WHERE partido_id = NEW.partido_id;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.check_survey_completion_from_post_match_surveys()
IS 'Observability-only trigger: tracks survey_progress response_count. SECURITY DEFINER so public/anon survey submit populates survey_progress without direct grants.';

-- Legacy compatibility trigger (votos). Body identical, now SECURITY DEFINER.
CREATE OR REPLACE FUNCTION public.check_survey_completion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  INSERT INTO public.survey_progress (
    partido_id,
    enabled_at,
    first_response_at,
    response_count,
    results_notified,
    created_at,
    updated_at
  )
  VALUES (NEW.partido_id, now(), now(), 0, false, now(), now())
  ON CONFLICT (partido_id) DO NOTHING;

  UPDATE public.survey_progress
  SET
    response_count = COALESCE(response_count, 0) + 1,
    first_response_at = COALESCE(first_response_at, now()),
    updated_at = now()
  WHERE partido_id = NEW.partido_id;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.check_survey_completion()
IS 'Legacy compatibility only. SECURITY DEFINER; does not enqueue notifications or close surveys.';

-- Lock down direct access. Only the DEFINER triggers and service_role write it.
DROP POLICY IF EXISTS survey_progress_authenticated_all ON public.survey_progress;
-- (survey_progress_service_role_all is kept as-is.)

REVOKE ALL ON public.survey_progress FROM authenticated, anon;
GRANT ALL ON public.survey_progress TO service_role;

COMMIT;

-- ===========================================================================
-- ROLLBACK (Stage A)
-- ===========================================================================
-- BEGIN;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON public.survey_progress TO authenticated;
-- CREATE POLICY survey_progress_authenticated_all ON public.survey_progress
--   FOR ALL TO authenticated USING (true) WITH CHECK (true);
-- -- Re-create the two trigger functions with LANGUAGE plpgsql (no SECURITY DEFINER)
-- -- using the bodies from 20260310183000_fix_survey_closure_single_path.sql.
-- COMMIT;
