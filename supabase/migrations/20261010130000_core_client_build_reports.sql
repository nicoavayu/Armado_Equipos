-- Core: evidence for privacy phase B — which app builds are actually in use.
--
-- Phase B (docs/database/core-review/phase-b-usuarios-private-columns.sql) breaks every app
-- build that reads usuarios with select('*') (1.1.21, the build in both stores today). The
-- stores only tell the owner which version they offer; device_tokens.app_version is always
-- empty (REACT_APP_VERSION was never set). This adds a measurable signal:
--   * report_client_build(platform, version, build): every client (web and native builds that
--     include phase A) reports itself once per start. One row per account and platform,
--     kept in app_private (not reachable through the API).
--   * app_private.privacy_phase_b_readiness(min Android build, min iOS build, days): over the
--     last <days>, accounts that reported a native build below the minimum, and accounts with
--     an active session that never reported (they run a client older than this migration's
--     client, i.e. 1.1.21 or earlier). Phase B is ready when both are zero (or the owner
--     accepts the residual), after the minimum builds have been in the stores for <days>.
-- Read-only for operators (SQL editor / service role). Nothing here changes what users see.

create table if not exists app_private.client_build_reports (
  user_id uuid not null references auth.users (id) on delete cascade,
  platform text not null check (platform in ('ios', 'android', 'web')),
  app_version text,
  app_build integer,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (user_id, platform)
);

revoke all on table app_private.client_build_reports from public, anon, authenticated;

create or replace function public.report_client_build(
  p_platform text,
  p_app_version text default null,
  p_app_build integer default null
)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_platform text := lower(btrim(coalesce(p_platform, '')));
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if v_platform not in ('ios', 'android', 'web') then
    return;
  end if;

  insert into app_private.client_build_reports as report (user_id, platform, app_version, app_build)
  values (
    v_uid,
    v_platform,
    nullif(left(btrim(coalesce(p_app_version, '')), 32), ''),
    case when p_app_build between 0 and 100000000 then p_app_build end
  )
  on conflict (user_id, platform) do update
  set app_version = excluded.app_version,
      app_build = excluded.app_build,
      last_seen_at = now()
  -- One write per account, platform and hour at most.
  where report.last_seen_at < now() - interval '1 hour'
     or report.app_version is distinct from excluded.app_version
     or report.app_build is distinct from excluded.app_build;
end;
$function$;

revoke all on function public.report_client_build(text, text, integer) from public, anon;
grant execute on function public.report_client_build(text, text, integer) to authenticated, service_role;

create or replace function app_private.privacy_phase_b_readiness(
  p_min_android_build integer,
  p_min_ios_build integer,
  p_days integer default 30
)
returns table (metric text, accounts bigint, detail text)
language sql
stable
security definer
set search_path to ''
as $function$
  with window_start as (
    select now() - make_interval(days => greatest(coalesce(p_days, 30), 1)) as since
  ),
  active_accounts as (
    -- An active session: the client refreshed its token inside the window.
    select distinct session_row.user_id
    from auth.sessions session_row, window_start
    where greatest(
        session_row.updated_at,
        coalesce((to_jsonb(session_row) ->> 'refreshed_at')::timestamptz, session_row.updated_at)
      ) >= window_start.since
  ),
  recent_reports as (
    select report.*
    from app_private.client_build_reports report, window_start
    where report.last_seen_at >= window_start.since
  ),
  below_minimum as (
    select report.user_id, report.platform, report.app_version, report.app_build
    from recent_reports report
    where (report.platform = 'android' and coalesce(report.app_build, 0) < p_min_android_build)
       or (report.platform = 'ios' and coalesce(report.app_build, 0) < p_min_ios_build)
  )
  select 'active_accounts', count(*), 'accounts with a session refreshed inside the window'
  from active_accounts
  union all
  select 'native_on_minimum_or_newer', count(distinct report.user_id),
    format('android >= %s, ios >= %s', p_min_android_build, p_min_ios_build)
  from recent_reports report
  where report.platform in ('android', 'ios')
    and report.user_id not in (select below_minimum.user_id from below_minimum)
  union all
  select 'native_below_minimum', count(distinct below_minimum.user_id),
    coalesce(string_agg(distinct format('%s %s (%s)', below_minimum.platform,
      coalesce(below_minimum.app_version, '?'), coalesce(below_minimum.app_build::text, '?')), ', '), 'none')
  from below_minimum
  union all
  select 'active_without_any_report', count(*),
    'active session but no client report: a client older than the reporting build (1.1.21 or earlier)'
  from active_accounts
  where active_accounts.user_id not in (select recent_reports.user_id from recent_reports)
$function$;

revoke all on function app_private.privacy_phase_b_readiness(integer, integer, integer) from public, anon, authenticated;

do $client_build_reports_check$
begin
  if has_function_privilege('anon', 'public.report_client_build(text,text,integer)', 'execute') then
    raise exception 'report_client_build must not be executable by anon';
  end if;
  if has_table_privilege('authenticated', 'app_private.client_build_reports', 'select') then
    raise exception 'client build reports must not be readable through the API';
  end if;
end
$client_build_reports_check$;
