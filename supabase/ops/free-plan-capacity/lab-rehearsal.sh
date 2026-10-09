#!/usr/bin/env bash
# Rehearses the Free-plan capacity remediation on a disposable Supabase Postgres (same image family as Production, no
# network) loaded with Production's volumes of 2026-10-07, while pg_cron writes every second the way the real
# schedulers do. Measures, per step: wall time, the longest pause seen by the writers, WAL written and the size freed.
#   bash supabase/ops/free-plan-capacity/lab-rehearsal.sh <evidence.json>
# Nothing here reaches a remote host. The container is removed at the end.
set -euo pipefail
OUT=${1:?evidence file}
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../../.." && pwd)
DOCKER=${DOCKER:-/Applications/Docker.app/Contents/Resources/bin/docker}
IMAGE=${CAPACITY_LAB_IMAGE:-public.ecr.aws/supabase/postgres:17.6.1.143}
NAME=arma2-capacity-lab-$$
PW=$(openssl rand -hex 16)
cleanup() { "$DOCKER" rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

"$DOCKER" run -d --name "$NAME" --network none -e POSTGRES_PASSWORD="$PW" "$IMAGE" >/dev/null
for _ in $(seq 1 90); do "$DOCKER" exec "$NAME" pg_isready -U postgres -h localhost >/dev/null 2>&1 && break; sleep 2; done
sleep 5
as_admin() { "$DOCKER" exec -i -e PGPASSWORD="$PW" "$NAME" psql -h localhost -U supabase_admin -d postgres -X -A -t -q -v ON_ERROR_STOP=1 "$@"; }
as_postgres() { "$DOCKER" exec -i -e PGPASSWORD="$PW" "$NAME" psql -h localhost -U postgres -d postgres -X -A -t -q -v ON_ERROR_STOP=1 "$@"; }
now_ms() { python3 -c 'import time; print(int(time.time()*1000))'; }

# 1. Production's shape: pg_cron, the two log tables (baseline DDL + the extra indexes Production has).
as_admin <<'SQL'
create extension if not exists pg_cron;
-- What Production's postgres role holds on pg_cron (inspect-core-logs.sql privileges).
grant usage on schema cron to postgres;
grant all on all tables in schema cron to postgres;
grant all on all sequences in schema cron to postgres;
grant execute on all functions in schema cron to postgres;
SQL
as_postgres <<'SQL'
create table public.push_sender_scheduler_runs (
  id bigserial primary key,
  triggered_at timestamptz not null default now(),
  trigger_source text not null default 'cron',
  status text not null check (status in ('invoked','skipped_no_work','skipped_overlap','misconfigured','error')),
  reason text, request_id bigint, queue_snapshot jsonb not null default '{}'::jsonb);
create index idx_push_sender_scheduler_runs_status on public.push_sender_scheduler_runs (status, triggered_at desc);
create index idx_push_sender_scheduler_runs_triggered_at on public.push_sender_scheduler_runs (triggered_at desc);
create table public.notification_delivery_log (
  id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now(), partido_id bigint, user_id uuid,
  notification_type text not null, payload_json jsonb not null default '{}'::jsonb, channel text not null, status text not null default 'queued',
  error_text text, correlation_id uuid not null default gen_random_uuid(), attempt_count integer not null default 0, sent_at timestamptz,
  error_code text, next_retry_at timestamptz, last_attempt_at timestamptz, processing_started_at timestamptz, processing_by text,
  provider_message_id text, provider_response_json jsonb);
create unique index unique_delivery_per_correlation on public.notification_delivery_log (correlation_id, user_id, notification_type, channel);
create index idx_delivery_log_partido on public.notification_delivery_log (partido_id);
create index idx_delivery_log_type on public.notification_delivery_log (notification_type);
create index idx_delivery_log_status on public.notification_delivery_log (status);
create index idx_delivery_log_user on public.notification_delivery_log (user_id);
create index idx_notification_delivery_log_retention_created_status on public.notification_delivery_log (created_at, status);
create index idx_notification_delivery_log_user on public.notification_delivery_log (user_id);
SQL

# 2. Production's volumes: 1,143,332 cron runs over a year, 296,343 scheduler ticks since March, and an index-bloated
#    delivery log (many rows inserted and deleted, 16 left).
as_admin <<'SQL'
insert into cron.job_run_details (jobid, runid, job_pid, database, username, command, status, return_message, start_time, end_time)
select (g % 8) + 1, g, 1000 + (g % 5000), 'postgres', 'postgres',
       'SELECT public.process_survey_start_notifications_backend();', 'succeeded', 'SELECT 1 (1 row) in 0.012 ms ok',
       now() - interval '364 days' + (g * interval '27.5 seconds'), now() - interval '364 days' + (g * interval '27.5 seconds') + interval '20 ms'
from generate_series(1, 1143332) g;
select setval('cron.runid_seq', 1143332);
SQL
as_postgres <<'SQL'
insert into public.push_sender_scheduler_runs (triggered_at, status, reason, queue_snapshot)
select now() - interval '208 days' + (g * interval '60.6 seconds'),
       case when g % 50 = 0 then 'invoked' else 'skipped_no_work' end, 'no_pending_deliveries',
       jsonb_build_object('queued', 0, 'retryable', 0, 'processing_fresh', 0, 'processing_stale', 0, 'checked_at', now()::text)
from generate_series(1, 296343) g;
insert into public.notification_delivery_log (partido_id, user_id, notification_type, payload_json, channel, status, created_at)
select g % 400, gen_random_uuid(), (array['match_reminder','survey_start','join_request','team_invite'])[1 + g % 4],
       jsonb_build_object('title', 'Recordatorio', 'event_channel', 'push'), 'push', 'sent', now() - (g % 30) * interval '1 day'
from generate_series(1, 330000) g;
delete from public.notification_delivery_log where ctid not in (select ctid from public.notification_delivery_log limit 16);
vacuum public.notification_delivery_log;
vacuum analyze public.push_sender_scheduler_runs;
SQL
as_admin -c 'vacuum analyze cron.job_run_details;'

# 3. Writers every second, as in Production: pg_cron records each run in cron.job_run_details, one job writes a
#    scheduler tick, another writes and retires a delivery row.
as_postgres <<'SQL'
select cron.schedule('lab_push_tick', '1 seconds', $$insert into public.push_sender_scheduler_runs (status, reason) values ('skipped_no_work', 'lab')$$);
select cron.schedule('lab_delivery', '1 seconds', $$with i as (insert into public.notification_delivery_log (notification_type, channel, status) values ('lab', 'push', 'sent') returning id) delete from public.notification_delivery_log where notification_type = 'lab' and id not in (select id from i)$$);
SQL
sleep 20

report() { as_postgres -c "$(cat "$HERE/inspect-core-logs.sql")"; }
gap_sql="select json_build_object(
  'max_push_tick_gap_ms', (select coalesce(max(extract(epoch from d) * 1000)::int, 0) from (select triggered_at - lag(triggered_at) over (order by triggered_at) d from public.push_sender_scheduler_runs where reason = 'lab' and triggered_at between to_timestamp(:t0 / 1000.0) - interval '2 seconds' and to_timestamp(:t1 / 1000.0) + interval '3 seconds') x),
  'max_cron_record_gap_ms', (select coalesce(max(extract(epoch from d) * 1000)::int, 0) from (select start_time - lag(start_time) over (order by start_time) d from cron.job_run_details where command like '%lab%' and start_time between to_timestamp(:t0 / 1000.0) - interval '2 seconds' and to_timestamp(:t1 / 1000.0) + interval '3 seconds') x))::text"
step() { # name, sql file, runner
  local name=$1 file=$2 runner=$3 before after t0 t1 gaps
  before=$(report); t0=$(now_ms)
  $runner < "$file" >/dev/null
  t1=$(now_ms); sleep 4; after=$(report)
  gaps=$(echo "$gap_sql" | as_postgres -v t0="$t0" -v t1="$t1")
  python3 - "$name" "$t0" "$t1" "$before" "$after" "$gaps" <<'PY'
import json, sys
name, t0, t1, before, after, gaps = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), json.loads(sys.argv[4]), json.loads(sys.argv[5]), json.loads(sys.argv[6])
def lsn(s):
    hi, lo = s.split('/'); return (int(hi, 16) << 32) + int(lo, 16)
print(json.dumps({'step': name, 'wall_ms': t1 - t0, **gaps,
  'wal_bytes': lsn(after['wal_lsn']) - lsn(before['wal_lsn']),
  'database_bytes_before': before['database_bytes'], 'database_bytes_after': after['database_bytes'],
  'cron_rows': [before['cron_job_run_details']['rows'], after['cron_job_run_details']['rows']],
  'scheduler_rows': [before['push_sender_scheduler_runs']['rows'], after['push_sender_scheduler_runs']['rows']],
  'delivery_log_index_bytes': [before['notification_delivery_log']['indexes'], after['notification_delivery_log']['indexes']]}))
PY
}

initial=$(report)
# Order-independence: the retention migration goes in BEFORE the compaction here, so its first daily run meets the
# whole backlog; the per-run cap (20,000 rows per table) must keep that run small.
s1=$(step reindex "$HERE/01-reindex-notification-delivery-log.sql" as_postgres)
s2=$(step retention_migration "$REPO/supabase/migrations/20261009120000_core_ops_log_retention.sql" as_postgres)
RUN_SQL=$(mktemp); echo 'select public.run_ops_log_retention();' > "$RUN_SQL"
s3=$(step retention_first_run_on_full_backlog "$RUN_SQL" as_postgres)
rm -f "$RUN_SQL"
s4=$(step compact "$HERE/02-compact-operational-logs.sql" as_postgres)
retention_run=$(as_postgres -c 'select public.run_ops_log_retention()::text')
# The monthly job's exact command, run the way pg_cron runs it (one statement, its own implicit transaction).
reindex_cmd=$(as_postgres -c "select command from cron.job where jobname = 'ops_delivery_log_reindex'")
as_postgres -c "$reindex_cmd" >/dev/null
denied=$(as_postgres -c "select json_build_object('anon', has_function_privilege('anon', 'public.run_ops_log_retention(integer,integer,integer)', 'EXECUTE'), 'authenticated', has_function_privilege('authenticated', 'public.run_ops_log_retention(integer,integer,integer)', 'EXECUTE'), 'scheduled', (select schedule from cron.job where jobname = 'ops_log_retention_scheduler'), 'reindex_scheduled', (select schedule from cron.job where jobname = 'ops_delivery_log_reindex'), 'reindex_command_ran', true)::text")
final=$(report)

python3 - "$OUT" "$IMAGE" "$initial" "$s1" "$s2" "$s3" "$s4" "$retention_run" "$denied" "$final" <<'PY'
import json, sys, datetime
out, image = sys.argv[1], sys.argv[2]
initial, s1, s2, s3, s4, run, denied, final = (json.loads(x) for x in sys.argv[3:])
evidence = {'generated_at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'image': image, 'network': 'none',
  'volumes': 'Production 2026-10-07: cron 1,143,332 rows; scheduler runs 296,343; delivery log 16 live rows with bloated indexes',
  'initial': initial, 'steps': [s1, s2, s3, s4], 'retention_run_after_compaction': run, 'retention_function_acl': denied, 'final': final}
open(out, 'w').write(json.dumps(evidence, indent=1) + '\n')
mb = lambda b: round(b / 1048576, 1)
print(f"database {mb(initial['database_bytes'])} MB -> {mb(final['database_bytes'])} MB")
for s in (s1, s2, s3, s4):
    print(f"{s['step']}: {s['wall_ms']} ms, longest pause push tick {s['max_push_tick_gap_ms']} ms / cron record {s['max_cron_record_gap_ms']} ms, WAL {mb(s['wal_bytes'])} MB, size {mb(s['database_bytes_before'])} -> {mb(s['database_bytes_after'])} MB")
print('retention run', run, 'acl', denied)
PY
