-- ============================================================================
-- CRON JOB SETUP: Survey Timeout Checker
-- ============================================================================
-- This script sets up a cron job to check for survey timeouts every minute
-- Run this in Supabase SQL Editor AFTER running the main migration

-- Enable pg_cron extension if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule the survey timeout check to run every minute
SELECT cron.schedule(
  'survey-timeout-check',
  '* * * * *', -- Every minute
  $$
  SELECT public.check_survey_timeouts();
  $$
);

-- Verify the job was created
SELECT * FROM cron.job WHERE jobname = 'survey-timeout-check';

-- ============================================================================
-- To unschedule (if needed for debugging):
-- SELECT cron.unschedule('survey-timeout-check');
-- ============================================================================
