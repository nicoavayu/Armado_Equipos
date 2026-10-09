-- Core only (READ ONLY): the three operational tables that make most of Core's database size, the cron jobs and the
-- privileges the compaction needs. One SELECT, one JSON row.
select json_build_object(
  'cron_job_run_details', (select json_build_object('rows', count(*), 'oldest', min(start_time),
      'last_7d', count(*) filter (where start_time >= now() - interval '7 days'),
      'bytes', pg_total_relation_size('cron.job_run_details')) from cron.job_run_details),
  'push_sender_scheduler_runs', (select json_build_object('rows', count(*), 'oldest', min(triggered_at),
      'last_7d', count(*) filter (where triggered_at >= now() - interval '7 days'),
      'skipped_no_work', count(*) filter (where status = 'skipped_no_work'),
      'bytes', pg_total_relation_size('public.push_sender_scheduler_runs')) from public.push_sender_scheduler_runs),
  'notification_delivery_log', json_build_object('rows', (select count(*) from public.notification_delivery_log),
      'heap', pg_relation_size('public.notification_delivery_log'), 'indexes', pg_indexes_size('public.notification_delivery_log')),
  'cron_jobs', (select json_agg(json_build_object('name', jobname, 'schedule', schedule, 'active', active) order by jobname) from cron.job),
  'privileges', json_build_object(
    'cron_insert', has_table_privilege('cron.job_run_details', 'INSERT'),
    'cron_truncate', has_table_privilege('cron.job_run_details', 'TRUNCATE'),
    'runs_truncate', has_table_privilege('public.push_sender_scheduler_runs', 'TRUNCATE'),
    'ndl_maintain', has_table_privilege('public.notification_delivery_log', 'MAINTAIN')),
  'database_bytes', pg_database_size(current_database()),
  'wal_lsn', pg_current_wal_lsn()::text
)::jsonb::text as report
