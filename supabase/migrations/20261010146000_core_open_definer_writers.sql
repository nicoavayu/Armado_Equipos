-- Core: the remaining SECURITY DEFINER functions that anyone (anon included) could call to
-- write, without any check of the caller (Nico, 2026-10-09: all of them, after a review of
-- their consumers). Inventory and review: docs/database/core-review/DEFINER-WRITERS.md.
--
-- No client calls them (web main, 1.1.21 dad2a0b9, edge functions); only pg_cron, the service
-- role or other SECURITY DEFINER functions (which run as the owner) do. They lose EXECUTE for
-- PUBLIC, anon and authenticated; service_role keeps it:
--   compute_awards_for_match (the apps call it with partido_id, which Production's signature
--     p_partido_id never matched: their call already fails and they fall back), debug_set_surveys_sent,
--   fanout_survey_for_match, mark_match_assumed_not_played, process_awards_for_matches,
--   process_match_reminder_notifications_backend, process_survey_start_notifications_backend,
--   rpc_crear_partido_debug, update_delivery_status.
-- Called by installed 1.1.21 (and by SECURITY DEFINER functions or triggers): the original
-- moves unchanged (same body and oid) to app_private.<name>_unchecked and an INVOKER wrapper with
-- the same name, arguments and defaults takes its place; called through the API (current_user
-- anon/authenticated) it requires, as the repository's *_as_actor/_as_admin variants do:
--   send_match_kicked_notification: the organizer of the match (creado_por/admin_id);
--   sync_team_match_to_partido: a member of either team of the team match;
--   prepare_challenge_team_squad: the owner or captain of a team of the challenge.
--   Called by the owner (definer callers, triggers, pg_cron) or the service role: unchanged.
-- cancel_partido_with_notification: 20261010118000 (applied first) already lets only the
-- organizer cancel; this migration only checks it is there.
-- Every ACL is saved first (production_alignment_log); the rollback restores functions and ACLs
-- exactly.

create or replace function app_private.assert_api_caller_may(
  p_action text,
  p_partido_id bigint default null,
  p_ref uuid default null
)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_ok boolean := false;
begin
  if v_uid is not null then
    case p_action
      when 'match_organizer' then
        v_ok := app_private.is_match_admin(p_partido_id, v_uid);
      when 'team_match_member' then
        v_ok := exists (
          select 1 from public.team_matches team_match
          where team_match.id = p_ref
            and (public.team_user_is_member(team_match.team_a_id, v_uid)
                 or public.team_user_is_member(team_match.team_b_id, v_uid)));
      when 'challenge_captain' then
        v_ok := public.challenge_user_is_owner_or_captain(p_ref, v_uid);
      else
        v_ok := false;
    end case;
  end if;
  if not coalesce(v_ok, false) then
    raise exception using errcode = '42501', message = format('not allowed (%s)', p_action);
  end if;
end;
$function$;
revoke all on function app_private.assert_api_caller_may(text, bigint, uuid) from public, anon;
grant execute on function app_private.assert_api_caller_may(text, bigint, uuid) to authenticated, service_role;

-- ---------- no client caller: revoke from PUBLIC, anon and authenticated ----------
do $revoke$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.compute_awards_for_match(bigint)',
    'public.debug_set_surveys_sent(bigint,boolean)',
    'public.fanout_survey_for_match(bigint)',
    'public.mark_match_assumed_not_played(bigint,text)',
    'public.process_awards_for_matches()',
    'public.process_match_reminder_notifications_backend(integer,integer)',
    'public.process_survey_start_notifications_backend(integer,integer)',
    'public.rpc_crear_partido_debug(jsonb)',
    'public.update_delivery_status(uuid,text,text)'
  ] loop
    if to_regprocedure(v_fn) is null then
      continue;
    end if;
    if has_function_privilege('anon', v_fn, 'execute') or has_function_privilege('authenticated', v_fn, 'execute') then
      perform app_private.alignment_save_function_acl(v_fn::regprocedure);
      execute format('revoke execute on function %s from public, anon, authenticated', v_fn::regprocedure);
    end if;
  end loop;
end
$revoke$;

-- ---------- called by 1.1.21: checked wrappers ----------
do $wrap$
declare
  v_had_auth boolean;
  v_had_service boolean;
  v_fn text;
begin
  -- send_match_kicked_notification
  v_fn := 'public.send_match_kicked_notification(uuid,bigint,text,uuid,timestamp with time zone)';
  if to_regprocedure(v_fn) is not null
     and to_regprocedure('app_private.send_match_kicked_notification_unchecked(uuid,bigint,text,uuid,timestamp with time zone)') is null then
    perform app_private.alignment_save_function_acl(v_fn::regprocedure);
    v_had_auth := has_function_privilege('authenticated', v_fn, 'execute');
    v_had_service := has_function_privilege('service_role', v_fn, 'execute');
    alter function public.send_match_kicked_notification(uuid, bigint, text, uuid, timestamp with time zone) set schema app_private;
    alter function app_private.send_match_kicked_notification(uuid, bigint, text, uuid, timestamp with time zone)
      rename to send_match_kicked_notification_unchecked;
    execute $f$
      create function public.send_match_kicked_notification(
        p_user_id uuid, p_partido_id bigint, p_match_name text default null::text,
        p_kicked_by uuid default null::uuid, p_kicked_at timestamp with time zone default now())
      returns jsonb
      language plpgsql
      security invoker
      as $body$
      begin
        -- Through the API: only the organizer of the match (20261010146000).
        if current_user in ('anon', 'authenticated') then
          perform app_private.assert_api_caller_may('match_organizer', p_partido_id, null);
        end if;
        return app_private.send_match_kicked_notification_unchecked(p_user_id, p_partido_id, p_match_name, p_kicked_by, p_kicked_at);
      end;
      $body$ $f$;
    execute format('revoke all on function %s from public, anon, authenticated, service_role', v_fn);
    revoke all on function app_private.send_match_kicked_notification_unchecked(uuid, bigint, text, uuid, timestamp with time zone)
      from public, anon, authenticated, service_role;
    if v_had_auth then
      execute format('grant execute on function %s to authenticated', v_fn);
      grant execute on function app_private.send_match_kicked_notification_unchecked(uuid, bigint, text, uuid, timestamp with time zone) to authenticated;
    end if;
    if v_had_service then
      execute format('grant execute on function %s to service_role', v_fn);
      grant execute on function app_private.send_match_kicked_notification_unchecked(uuid, bigint, text, uuid, timestamp with time zone) to service_role;
    end if;
    insert into app_private.production_alignment_log (kind, object_name) values ('wrapped_function', v_fn::regprocedure::text);
  end if;

  -- sync_team_match_to_partido
  v_fn := 'public.sync_team_match_to_partido(uuid)';
  if to_regprocedure(v_fn) is not null
     and to_regprocedure('app_private.sync_team_match_to_partido_unchecked(uuid)') is null then
    perform app_private.alignment_save_function_acl(v_fn::regprocedure);
    v_had_auth := has_function_privilege('authenticated', v_fn, 'execute');
    v_had_service := has_function_privilege('service_role', v_fn, 'execute');
    alter function public.sync_team_match_to_partido(uuid) set schema app_private;
    alter function app_private.sync_team_match_to_partido(uuid) rename to sync_team_match_to_partido_unchecked;
    execute $f$
      create function public.sync_team_match_to_partido(p_team_match_id uuid)
      returns bigint
      language plpgsql
      security invoker
      as $body$
      begin
        -- Through the API: only a member of either team (20261010146000).
        if current_user in ('anon', 'authenticated') then
          perform app_private.assert_api_caller_may('team_match_member', null, p_team_match_id);
        end if;
        return app_private.sync_team_match_to_partido_unchecked(p_team_match_id);
      end;
      $body$ $f$;
    execute format('revoke all on function %s from public, anon, authenticated, service_role', v_fn);
    revoke all on function app_private.sync_team_match_to_partido_unchecked(uuid) from public, anon, authenticated, service_role;
    if v_had_auth then
      execute format('grant execute on function %s to authenticated', v_fn);
      grant execute on function app_private.sync_team_match_to_partido_unchecked(uuid) to authenticated;
    end if;
    if v_had_service then
      execute format('grant execute on function %s to service_role', v_fn);
      grant execute on function app_private.sync_team_match_to_partido_unchecked(uuid) to service_role;
    end if;
    insert into app_private.production_alignment_log (kind, object_name) values ('wrapped_function', v_fn::regprocedure::text);
  end if;

  -- prepare_challenge_team_squad
  v_fn := 'public.prepare_challenge_team_squad(uuid,boolean)';
  if to_regprocedure(v_fn) is not null
     and to_regprocedure('app_private.prepare_challenge_team_squad_unchecked(uuid,boolean)') is null then
    perform app_private.alignment_save_function_acl(v_fn::regprocedure);
    v_had_auth := has_function_privilege('authenticated', v_fn, 'execute');
    v_had_service := has_function_privilege('service_role', v_fn, 'execute');
    alter function public.prepare_challenge_team_squad(uuid, boolean) set schema app_private;
    alter function app_private.prepare_challenge_team_squad(uuid, boolean) rename to prepare_challenge_team_squad_unchecked;
    execute $f$
      create function public.prepare_challenge_team_squad(p_challenge_id uuid, p_open boolean default true)
      returns jsonb
      language plpgsql
      security invoker
      as $body$
      begin
        -- Through the API: only the owner or captain of a team of the challenge (20261010146000).
        if current_user in ('anon', 'authenticated') then
          perform app_private.assert_api_caller_may('challenge_captain', null, p_challenge_id);
        end if;
        return app_private.prepare_challenge_team_squad_unchecked(p_challenge_id, p_open);
      end;
      $body$ $f$;
    execute format('revoke all on function %s from public, anon, authenticated, service_role', v_fn);
    revoke all on function app_private.prepare_challenge_team_squad_unchecked(uuid, boolean) from public, anon, authenticated, service_role;
    if v_had_auth then
      execute format('grant execute on function %s to authenticated', v_fn);
      grant execute on function app_private.prepare_challenge_team_squad_unchecked(uuid, boolean) to authenticated;
    end if;
    if v_had_service then
      execute format('grant execute on function %s to service_role', v_fn);
      grant execute on function app_private.prepare_challenge_team_squad_unchecked(uuid, boolean) to service_role;
    end if;
    insert into app_private.production_alignment_log (kind, object_name) values ('wrapped_function', v_fn::regprocedure::text);
  end if;
end
$wrap$;

do $$
declare
  v_fn text;
begin
  -- 118000 must be there (apply-193 applies it first; it is not repeated here).
  if to_regprocedure('public.cancel_partido_with_notification(bigint,text)') is not null
     and (select prosrc !~ '20261010118000' from pg_proc where oid = 'public.cancel_partido_with_notification(bigint,text)'::regprocedure) then
    raise exception 'cancel_partido_with_notification has no organizer guard: apply 20261010118000 first';
  end if;
  foreach v_fn in array array[
    'public.compute_awards_for_match(bigint)', 'public.debug_set_surveys_sent(bigint,boolean)',
    'public.fanout_survey_for_match(bigint)', 'public.mark_match_assumed_not_played(bigint,text)',
    'public.process_awards_for_matches()', 'public.process_match_reminder_notifications_backend(integer,integer)',
    'public.process_survey_start_notifications_backend(integer,integer)', 'public.rpc_crear_partido_debug(jsonb)',
    'public.update_delivery_status(uuid,text,text)',
    'public.send_match_kicked_notification(uuid,bigint,text,uuid,timestamp with time zone)',
    'public.sync_team_match_to_partido(uuid)', 'public.prepare_challenge_team_squad(uuid,boolean)',
    'public.cancel_partido_with_notification(bigint,text)'
  ] loop
    if to_regprocedure(v_fn) is not null and has_function_privilege('anon', v_fn, 'execute') then
      raise exception '% is still executable by anon', v_fn;
    end if;
  end loop;
end;
$$;
