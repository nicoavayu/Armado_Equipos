-- Core — step 2 of the Free-plan capacity remediation. Deletes OPERATIONAL LOG ROWS ONLY, no product data:
--   * cron.job_run_details: pg_cron's history of every run (Production 2026-10-07: 1,143,332 rows since 2025-10-08,
--     277 MB, nothing ever deleted it);
--   * public.push_sender_scheduler_runs: one row per push scheduler tick (296,343 rows since 2026-03-13, 107 MB, 97.7 %
--     «skipped_no_work»).
-- Both keep their last 7 days. The rest goes with TRUNCATE, which returns the space at once and writes almost no WAL:
-- a DELETE of ~1.4 M rows would write hundreds of MB of WAL on the 1 GB Free disk, and at 95 % disk the project turns
-- read-only. Each table is locked only while its last 7 days are copied back (pg_cron and the push tick wait that
-- long; measured in lab-rehearsal.sh).
-- PRECONDITION: a verified backup taken just before (scripts/ops/free-plan: pg_dump includes both tables —
-- cron.job_run_details is a pg_cron configuration table). Afterwards 20261009120000_core_ops_log_retention keeps both at
-- 7 days. Run with psql.
\set ON_ERROR_STOP on
set lock_timeout = '3s';
set statement_timeout = '120s';

begin;
lock table cron.job_run_details in access exclusive mode;
create temp table ops_keep_cron_history on commit drop as
  select * from cron.job_run_details where start_time >= now() - interval '7 days';
truncate cron.job_run_details;
insert into cron.job_run_details select * from ops_keep_cron_history;
commit;

begin;
lock table public.push_sender_scheduler_runs in access exclusive mode;
create temp table ops_keep_scheduler_runs on commit drop as
  select * from public.push_sender_scheduler_runs where triggered_at >= now() - interval '7 days';
truncate public.push_sender_scheduler_runs;
insert into public.push_sender_scheduler_runs select * from ops_keep_scheduler_runs;
commit;
