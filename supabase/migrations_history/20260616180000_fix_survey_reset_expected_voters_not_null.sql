-- Fix: editing a challenge match's date/time failed with
--   "null value in column survey_expected_voters of relation partidos
--    violates not-null constraint"
--
-- When the schedule of a linked `partidos` row changes (e.g. the challenge edit
-- modal bridges the new fecha/hora down to the partido), the BEFORE UPDATE
-- trigger `trg_reset_survey_window_on_schedule_change` (added in
-- 20260318052000_survey_window_anchor_and_schedule_reset.sql) resets the survey
-- window. It set `NEW.survey_expected_voters := NULL`, but that column is
-- `integer NOT NULL DEFAULT 0` (added in 20260227153000), so the reset blew up
-- the NOT NULL constraint and the whole edit/save was rejected.
--
-- Resetting to 0 is semantically identical to the intended NULL reset: every
-- reader treats it as `GREATEST(COALESCE(survey_expected_voters, 0), ...)`, so
-- the expected-voter count is recomputed when the survey window reopens. This
-- only changes that single assignment; the rest of the function is unchanged.

CREATE OR REPLACE FUNCTION public.trg_reset_survey_window_on_schedule_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (NEW.fecha IS DISTINCT FROM OLD.fecha OR NEW.hora IS DISTINCT FROM OLD.hora) THEN
    IF COALESCE(NEW.result_status, 'pending') = 'pending'
      AND COALESCE(lower(NEW.estado), 'active') NOT IN ('cancelado', 'cancelled', 'deleted')
    THEN
      NEW.survey_opened_at := NULL;
      NEW.survey_closes_at := NULL;
      -- survey_expected_voters is NOT NULL DEFAULT 0; reset to 0 (not NULL).
      NEW.survey_expected_voters := 0;
      NEW.survey_status := 'open';
      NEW.surveys_sent := false;
      NEW.winner_team := NULL;
      NEW.finished_at := NULL;
      -- Keep compatibility with legacy schema variants where this column may/may not exist.
      NEW := jsonb_populate_record(NEW, jsonb_build_object('survey_deadline_at', NULL));
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
