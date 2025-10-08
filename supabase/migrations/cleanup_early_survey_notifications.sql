-- Migration: Cleanup early survey_start notifications and remove creation-time notification logic
-- Date: 2025-01-XX
-- Purpose: Ensure survey_start notifications are ONLY created by the fanout function at match time

-- ============================================================================
-- PART 1: Drop any triggers that create survey notifications on match creation
-- ============================================================================

DROP TRIGGER IF EXISTS trg_notify_survey_on_partidos ON public.partidos;
DROP TRIGGER IF EXISTS trg_survey_on_partido_insert ON public.partidos;
DROP TRIGGER IF EXISTS trg_notify_on_partidos_insert ON public.partidos;
DROP TRIGGER IF EXISTS trg_survey_start_on_insert ON public.partidos;
DROP TRIGGER IF EXISTS trg_create_survey_notification ON public.partidos;

-- Drop any functions that might have been used by these triggers
DROP FUNCTION IF EXISTS public.notify_survey_on_partido_insert() CASCADE;
DROP FUNCTION IF EXISTS public.create_survey_notification() CASCADE;
DROP FUNCTION IF EXISTS public.send_survey_start_notification() CASCADE;

-- ============================================================================
-- PART 2: Clean up early/invalid survey_start notifications
-- ============================================================================

-- Delete survey_start notifications that were created too early (before match start time)
-- These are likely from old creation-time logic and should be removed
DELETE FROM public.notifications n
USING public.partidos p
WHERE n.type = 'survey_start'
  AND (n.data->>'match_id')::bigint = p.id
  AND n.created_at < (
    -- Calculate match start time in Buenos Aires timezone, minus 10 minutes buffer
    ((p.fecha::text || ' ' || REPLACE(p.hora, '.', ':'))::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires')
    - interval '10 minutes'
  );

-- ============================================================================
-- PART 3: Documentation
-- ============================================================================

-- NOTE: Survey start notifications should ONLY be created by:
--   public.fanout_survey_start_notifications()
-- 
-- This function is triggered by a cron job that runs every minute and checks:
--   - Match start time (fecha + hora) <= current time in Buenos Aires
--   - surveys_sent = false
--
-- Any other source of survey_start notifications is incorrect and should be removed.
--
-- To verify the cleanup:
--   SELECT COUNT(*) FROM notifications WHERE type = 'survey_start';
--   SELECT * FROM notifications n 
--   JOIN partidos p ON (n.data->>'match_id')::bigint = p.id 
--   WHERE n.type = 'survey_start' 
--   ORDER BY n.created_at DESC LIMIT 10;
