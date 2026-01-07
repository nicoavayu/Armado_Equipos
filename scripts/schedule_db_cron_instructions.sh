#!/bin/bash
# Instructions to schedule the DB cron job for fanout_survey_start_notifications in Supabase
# Run these commands in your Supabase SQL editor or psql connected to the DB (do not run locally unless connected).

cat <<'EOS'
-- Use Supabase UI: Go to Project -> Database -> Scheduled Jobs -> New Job
-- Name: fanout_survey_start_notifications_every_min
-- SQL: CALL public.fanout_survey_start_notifications();
-- Frequency: Every 1 minute
-- Click Save

-- Or, if you have pg_cron enabled and can run SQL:
-- SELECT cron.schedule('fanout_survey_start_notifications_every_min', '* * * * *', $$CALL public.fanout_survey_start_notifications();$$);

EOS
