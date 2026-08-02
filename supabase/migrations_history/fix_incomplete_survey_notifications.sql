-- Migration: Fix incomplete survey_start notifications
-- Date: 2025-01-XX
-- Purpose: Remove invalid notifications and normalize missing link fields

-- Delete survey_start notifications without match_id (incomplete/invalid)
DELETE FROM public.notifications
WHERE type = 'survey_start' 
  AND NOT (data ? 'match_id');

-- Normalize missing link field for valid notifications
UPDATE public.notifications
SET data = jsonb_set(data, '{link}', to_jsonb('/encuesta/' || (data->>'match_id')))
WHERE type = 'survey_start' 
  AND (data ? 'match_id') 
  AND NOT (data ? 'link');
