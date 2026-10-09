-- Core — keeps the two operational logs that grew without limit at 7 days, so the database stays inside the Free plan.
--
-- In Production (2026-10-07) they were 384 of Core's 515 MB:
--   * cron.job_run_details (pg_cron's history of every run, ~5,300 rows a day, never deleted);
--   * public.push_sender_scheduler_runs (one row per push scheduler tick, ~1,440 a day).
-- notifications and notification_delivery_log already have their own retention (run_notifications_retention_cleanup).
--
-- public.run_ops_log_retention() deletes rows older than p_keep_days in small batches and never more than
-- p_max_rows_per_table per table and run: a normal day is ~5,300 + ~1,440 rows, so even before the one-time compaction
-- (supabase/ops/free-plan-capacity/02-compact-operational-logs.sql) a run cannot write a WAL burst on the 1 GB Free disk.
-- It runs once a day from pg_cron, as postgres. No product table is touched; no client role can execute it.
-- A second job rebuilds notification_delivery_log's indexes once a month (REINDEX ... CONCURRENTLY: no row changes, reads
-- and writes keep going): its own daily retention empties pages its indexes never give back (67 MB for 16 rows in
-- Production on 2026-10-07). One statement, so pg_cron runs it outside a transaction block, as CONCURRENTLY requires.
begin;

create or replace function public.run_ops_log_retention(
  p_keep_days integer default 7,
  p_batch integer default 5000,
  p_max_rows_per_table integer default 20000
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_cutoff timestamptz;
  v_cron bigint := 0;
  v_runs bigint := 0;
  v_n bigint;
begin
  if p_keep_days is null or p_keep_days < 1
     or p_batch is null or p_batch < 1
     or p_max_rows_per_table is null or p_max_rows_per_table < p_batch then
    raise exception 'OPS_LOG_RETENTION_ARGUMENTS' using errcode = '22023';
  end if;
  v_cutoff := now() - make_interval(days => p_keep_days);

  loop
    delete from cron.job_run_details
    where runid in (
      select runid from cron.job_run_details where start_time < v_cutoff order by runid limit p_batch
    );
    get diagnostics v_n = row_count;
    v_cron := v_cron + v_n;
    exit when v_n < p_batch or v_cron >= p_max_rows_per_table;
  end loop;

  loop
    delete from public.push_sender_scheduler_runs
    where id in (
      select id from public.push_sender_scheduler_runs where triggered_at < v_cutoff order by id limit p_batch
    );
    get diagnostics v_n = row_count;
    v_runs := v_runs + v_n;
    exit when v_n < p_batch or v_runs >= p_max_rows_per_table;
  end loop;

  return jsonb_build_object(
    'cutoff', v_cutoff,
    'cron_job_run_details', v_cron,
    'push_sender_scheduler_runs', v_runs
  );
end;
$$;

revoke all on function public.run_ops_log_retention(integer, integer, integer) from public, anon, authenticated, service_role;

do $schedule$
declare
  v_job record;
begin
  for v_job in select jobid from cron.job where jobname in ('ops_log_retention_scheduler', 'ops_delivery_log_reindex') loop
    perform cron.unschedule(v_job.jobid);
  end loop;
  perform cron.schedule('ops_log_retention_scheduler', '41 3 * * *', 'select public.run_ops_log_retention();');
  perform cron.schedule('ops_delivery_log_reindex', '11 4 1 * *', 'reindex table concurrently public.notification_delivery_log');
end
$schedule$;

do $post$
begin
  if exists (
    select 1 from information_schema.routine_privileges
    where routine_schema = 'public' and routine_name = 'run_ops_log_retention'
      and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role') and privilege_type = 'EXECUTE'
  ) then
    raise exception 'CORE_OPS_LOG_RETENTION_FAILED: client EXECUTE granted';
  end if;
  if (select count(*) from cron.job where jobname in ('ops_log_retention_scheduler', 'ops_delivery_log_reindex') and active) <> 2 then
    raise exception 'CORE_OPS_LOG_RETENTION_FAILED: schedule missing';
  end if;
end
$post$;

commit;
