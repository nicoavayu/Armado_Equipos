-- Core: only the organizer and the people of a match may send its notifications.
--
-- In Core Production, public.enqueue_partido_notification and
-- public.enqueue_match_participant_notification are SECURITY DEFINER, executable by anon and
-- authenticated, and check nobody: anyone could send a notification with any title and text
-- to every player (and the organizer) of any match id. Nico authorized closing it (2026-10-09)
-- after this review of their callers:
--   * web on main: calls the *_as_actor variants (absent in Production) and falls back to a
--     direct insert; it does not call these two;
--   * installed 1.1.21 (dad2a0b9), always with a session (anonymous sign-ins are off):
--       - organizer: match_deleted (deletePartidoWithNotification), survey_start (finishing),
--         match_update from the admin panel (player joined/left);
--       - requester: match_join_request to the organizer (PartidoInvitacion);
--       - a player who joined: match_update to the roster (enqueue_match_participant_notification,
--         falls back to the organizer alone);
--       - a player who left (after deleting its own row): match_update to the organizer;
--   * edge functions join-match-guest and accept-invite: service role;
--   * SECURITY DEFINER functions (cancel_partido_with_notification,
--     leave_owned_match_with_transfer, process_*_notifications_backend) and pg_cron: they run as
--     the owner.
-- Change:
--   * the original functions move unchanged (same body and oid) to
--     app_private.<name>_unchecked; a SECURITY INVOKER wrapper with the same name, arguments and
--     defaults takes their place. Called through the API (current_user anon/authenticated) it
--     asks app_private.assert_match_notification_allowed; called by the owner (definer callers,
--     pg_cron) or the service role it goes straight through, as today;
--   * the organizer (creado_por/admin_id) sends everything, as today. Anyone else only
--     match_join_request or match_update to the organizer (the function sends those types to
--     the organizer alone), and only if involved in the match (request, invitation or other
--     notice, roster, validated guest link); the fan-out to the roster only match_update from a
--     player of that roster;
--   * anon loses EXECUTE on both and on add_creator_to_match (nothing calls them as anon);
--     authenticated and service_role keep what they had.
-- Every ACL is saved first (production_alignment_log, 119000); the rollback restores the
-- functions and their grants exactly.

create or replace function app_private.assert_match_notification_allowed(
  p_partido_id bigint,
  p_type text,
  p_fanout boolean
)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_type text := lower(btrim(coalesce(p_type, '')));
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'match notifications need a signed-in account';
  end if;
  if app_private.is_match_admin(p_partido_id, v_uid) then
    return;
  end if;
  if p_fanout then
    if v_type = 'match_update'
       and exists (select 1 from public.jugadores j where j.partido_id = p_partido_id and j.usuario_id = v_uid) then
      return;
    end if;
  elsif v_type in ('match_join_request', 'match_update')
        and (app_private.match_involves_user(p_partido_id, v_uid)
             or exists (select 1 from app_private.match_link_access a where a.partido_id = p_partido_id and a.user_id = v_uid)) then
    return;
  end if;
  raise exception using errcode = '42501', message = 'not allowed to send this notification for this match';
end;
$function$;
revoke all on function app_private.assert_match_notification_allowed(bigint, text, boolean) from public, anon;
grant execute on function app_private.assert_match_notification_allowed(bigint, text, boolean) to authenticated, service_role;

do $wrap$
declare
  v_had_auth boolean;
  v_had_service boolean;
begin
  -- enqueue_partido_notification
  if to_regprocedure('public.enqueue_partido_notification(bigint,text,text,text,jsonb)') is not null
     and to_regprocedure('app_private.enqueue_partido_notification_unchecked(bigint,text,text,text,jsonb)') is null then
    perform app_private.alignment_save_function_acl('public.enqueue_partido_notification(bigint,text,text,text,jsonb)'::regprocedure);
    v_had_auth := has_function_privilege('authenticated', 'public.enqueue_partido_notification(bigint,text,text,text,jsonb)', 'execute');
    v_had_service := has_function_privilege('service_role', 'public.enqueue_partido_notification(bigint,text,text,text,jsonb)', 'execute');
    alter function public.enqueue_partido_notification(bigint, text, text, text, jsonb) set schema app_private;
    alter function app_private.enqueue_partido_notification(bigint, text, text, text, jsonb) rename to enqueue_partido_notification_unchecked;
    execute $f$
      create function public.enqueue_partido_notification(
        p_partido_id bigint, p_type text, p_title text default null::text,
        p_message text default null::text, p_payload jsonb default '{}'::jsonb)
      returns jsonb
      language plpgsql
      security invoker
      as $body$
      begin
        -- Through the API: only the organizer and the people of the match (20261010145000).
        if current_user in ('anon', 'authenticated') then
          perform app_private.assert_match_notification_allowed(p_partido_id, p_type, false);
        end if;
        return app_private.enqueue_partido_notification_unchecked(p_partido_id, p_type, p_title, p_message, p_payload);
      end;
      $body$ $f$;
    revoke all on function public.enqueue_partido_notification(bigint, text, text, text, jsonb) from public, anon, authenticated, service_role;
    revoke all on function app_private.enqueue_partido_notification_unchecked(bigint, text, text, text, jsonb) from public, anon, authenticated, service_role;
    if v_had_auth then
      grant execute on function public.enqueue_partido_notification(bigint, text, text, text, jsonb) to authenticated;
      grant execute on function app_private.enqueue_partido_notification_unchecked(bigint, text, text, text, jsonb) to authenticated;
    end if;
    if v_had_service then
      grant execute on function public.enqueue_partido_notification(bigint, text, text, text, jsonb) to service_role;
      grant execute on function app_private.enqueue_partido_notification_unchecked(bigint, text, text, text, jsonb) to service_role;
    end if;
    insert into app_private.production_alignment_log (kind, object_name)
    values ('wrapped_function', 'public.enqueue_partido_notification(bigint,text,text,text,jsonb)');
  end if;

  -- enqueue_match_participant_notification
  if to_regprocedure('public.enqueue_match_participant_notification(bigint,text,text,text,jsonb,uuid,boolean)') is not null
     and to_regprocedure('app_private.enqueue_match_participant_notification_unchecked(bigint,text,text,text,jsonb,uuid,boolean)') is null then
    perform app_private.alignment_save_function_acl('public.enqueue_match_participant_notification(bigint,text,text,text,jsonb,uuid,boolean)'::regprocedure);
    v_had_auth := has_function_privilege('authenticated', 'public.enqueue_match_participant_notification(bigint,text,text,text,jsonb,uuid,boolean)', 'execute');
    v_had_service := has_function_privilege('service_role', 'public.enqueue_match_participant_notification(bigint,text,text,text,jsonb,uuid,boolean)', 'execute');
    alter function public.enqueue_match_participant_notification(bigint, text, text, text, jsonb, uuid, boolean) set schema app_private;
    alter function app_private.enqueue_match_participant_notification(bigint, text, text, text, jsonb, uuid, boolean)
      rename to enqueue_match_participant_notification_unchecked;
    execute $f$
      create function public.enqueue_match_participant_notification(
        p_partido_id bigint, p_type text, p_title text default null::text,
        p_message text default null::text, p_payload jsonb default '{}'::jsonb,
        p_exclude_user_id uuid default null::uuid, p_include_admin boolean default true)
      returns jsonb
      language plpgsql
      security invoker
      as $body$
      begin
        -- Through the API: the organizer, or a player of the roster announcing an update (20261010145000).
        if current_user in ('anon', 'authenticated') then
          perform app_private.assert_match_notification_allowed(p_partido_id, p_type, true);
        end if;
        return app_private.enqueue_match_participant_notification_unchecked(
          p_partido_id, p_type, p_title, p_message, p_payload, p_exclude_user_id, p_include_admin);
      end;
      $body$ $f$;
    revoke all on function public.enqueue_match_participant_notification(bigint, text, text, text, jsonb, uuid, boolean) from public, anon, authenticated, service_role;
    revoke all on function app_private.enqueue_match_participant_notification_unchecked(bigint, text, text, text, jsonb, uuid, boolean) from public, anon, authenticated, service_role;
    if v_had_auth then
      grant execute on function public.enqueue_match_participant_notification(bigint, text, text, text, jsonb, uuid, boolean) to authenticated;
      grant execute on function app_private.enqueue_match_participant_notification_unchecked(bigint, text, text, text, jsonb, uuid, boolean) to authenticated;
    end if;
    if v_had_service then
      grant execute on function public.enqueue_match_participant_notification(bigint, text, text, text, jsonb, uuid, boolean) to service_role;
      grant execute on function app_private.enqueue_match_participant_notification_unchecked(bigint, text, text, text, jsonb, uuid, boolean) to service_role;
    end if;
    insert into app_private.production_alignment_log (kind, object_name)
    values ('wrapped_function', 'public.enqueue_match_participant_notification(bigint,text,text,text,jsonb,uuid,boolean)');
  end if;

  -- add_creator_to_match: no caller as anon (nor in the clients at all); anon loses EXECUTE.
  if to_regprocedure('public.add_creator_to_match(uuid)') is not null
     and has_function_privilege('anon', 'public.add_creator_to_match(uuid)', 'execute') then
    perform app_private.alignment_save_function_acl('public.add_creator_to_match(uuid)'::regprocedure);
    revoke execute on function public.add_creator_to_match(uuid) from public, anon;
    if has_function_privilege('anon', 'public.add_creator_to_match(uuid)', 'execute') then
      raise exception 'add_creator_to_match is still executable by anon';
    end if;
  end if;
end
$wrap$;

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array['public.enqueue_partido_notification(bigint,text,text,text,jsonb)',
                              'public.enqueue_match_participant_notification(bigint,text,text,text,jsonb,uuid,boolean)'] loop
    if to_regprocedure(v_fn) is null then
      continue;
    end if;
    if has_function_privilege('anon', v_fn, 'execute') then
      raise exception '% is still executable by anon', v_fn;
    end if;
    if (select prosecdef from pg_proc where oid = to_regprocedure(v_fn))
       or (select prosrc !~ 'assert_match_notification_allowed' from pg_proc where oid = to_regprocedure(v_fn)) then
      raise exception '% is not the checked wrapper', v_fn;
    end if;
  end loop;
end;
$$;
