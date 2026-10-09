-- Rollback of 20261010146000 (open SECURITY DEFINER writers). Run as postgres, in one
-- transaction, FIRST (before the rollback of 145000). Data: none. Effect: back to Production as
-- it was — anyone, anon included, can call these functions again (send a "kicked" notice, sync
-- a team match into a match, prepare a challenge squad, run the reminder/survey/awards jobs, mark
-- a match as not played, create a debug match…).
-- The wrapped functions come back unchanged (same body and oid: they were only moved) and every
-- function gets exactly the ACL saved before the change. cancel_partido_with_notification is not
-- touched (its guard belongs to 20261010118000).
do $rollback$
declare
  v_fn text;
begin
  if to_regprocedure('app_private.send_match_kicked_notification_unchecked(uuid,bigint,text,uuid,timestamp with time zone)') is not null then
    drop function if exists public.send_match_kicked_notification(uuid, bigint, text, uuid, timestamp with time zone);
    alter function app_private.send_match_kicked_notification_unchecked(uuid, bigint, text, uuid, timestamp with time zone)
      rename to send_match_kicked_notification;
    alter function app_private.send_match_kicked_notification(uuid, bigint, text, uuid, timestamp with time zone) set schema public;
  end if;
  if to_regprocedure('app_private.sync_team_match_to_partido_unchecked(uuid)') is not null then
    drop function if exists public.sync_team_match_to_partido(uuid);
    alter function app_private.sync_team_match_to_partido_unchecked(uuid) rename to sync_team_match_to_partido;
    alter function app_private.sync_team_match_to_partido(uuid) set schema public;
  end if;
  if to_regprocedure('app_private.prepare_challenge_team_squad_unchecked(uuid,boolean)') is not null then
    drop function if exists public.prepare_challenge_team_squad(uuid, boolean);
    alter function app_private.prepare_challenge_team_squad_unchecked(uuid, boolean) rename to prepare_challenge_team_squad;
    alter function app_private.prepare_challenge_team_squad(uuid, boolean) set schema public;
  end if;
  foreach v_fn in array array[
    'public.compute_awards_for_match(bigint)', 'public.debug_set_surveys_sent(bigint,boolean)',
    'public.fanout_survey_for_match(bigint)', 'public.mark_match_assumed_not_played(bigint,text)',
    'public.process_awards_for_matches()', 'public.process_match_reminder_notifications_backend(integer,integer)',
    'public.process_survey_start_notifications_backend(integer,integer)', 'public.rpc_crear_partido_debug(jsonb)',
    'public.update_delivery_status(uuid,text,text)',
    'public.send_match_kicked_notification(uuid,bigint,text,uuid,timestamp with time zone)',
    'public.sync_team_match_to_partido(uuid)', 'public.prepare_challenge_team_squad(uuid,boolean)'
  ] loop
    if to_regprocedure(v_fn) is not null then
      perform app_private.alignment_restore_function_acl(v_fn::regprocedure);
    end if;
  end loop;
  delete from app_private.production_alignment_log
  where kind = 'wrapped_function'
    and object_name in ('public.send_match_kicked_notification(uuid,bigint,text,uuid,timestamp with time zone)',
                        'public.sync_team_match_to_partido(uuid)', 'public.prepare_challenge_team_squad(uuid,boolean)');
end
$rollback$;
drop function if exists app_private.assert_api_caller_may(text, bigint, uuid);
delete from supabase_migrations.schema_migrations where version = '20261010146000';
