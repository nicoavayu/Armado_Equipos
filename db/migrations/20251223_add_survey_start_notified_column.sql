-- Migration: add survey_start_notified flag to partidos to avoid duplicate fanout
-- Date: 2025-12-23

BEGIN;

ALTER TABLE IF EXISTS public.partidos ADD COLUMN IF NOT EXISTS survey_start_notified boolean DEFAULT false;

COMMIT;
