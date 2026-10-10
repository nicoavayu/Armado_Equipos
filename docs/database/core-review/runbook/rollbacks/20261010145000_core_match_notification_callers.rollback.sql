-- Rollback of 20261010145000 (match notifications only from the organizer and the people of
-- the match). Run as postgres, in one transaction, FIRST (before the rollback of 143000).
-- Data: none. Effect: back to Production as it was — anyone, anon included, can send any
-- notification to every player of any match through these two functions, and anon can execute
-- add_creator_to_match.
-- The original functions come back unchanged (same body and oid: they were only moved), and
-- every grant exactly as saved before the change.
do $rollback$
begin
  if to_regprocedure('app_private.enqueue_partido_notification_unchecked(bigint,text,text,text,jsonb)') is not null then
    drop function if exists public.enqueue_partido_notification(bigint, text, text, text, jsonb);
    alter function app_private.enqueue_partido_notification_unchecked(bigint, text, text, text, jsonb)
      rename to enqueue_partido_notification;
    alter function app_private.enqueue_partido_notification(bigint, text, text, text, jsonb) set schema public;
    perform app_private.alignment_restore_function_acl('public.enqueue_partido_notification(bigint,text,text,text,jsonb)'::regprocedure);
  end if;
  if to_regprocedure('app_private.enqueue_match_participant_notification_unchecked(bigint,text,text,text,jsonb,uuid,boolean)') is not null then
    drop function if exists public.enqueue_match_participant_notification(bigint, text, text, text, jsonb, uuid, boolean);
    alter function app_private.enqueue_match_participant_notification_unchecked(bigint, text, text, text, jsonb, uuid, boolean)
      rename to enqueue_match_participant_notification;
    alter function app_private.enqueue_match_participant_notification(bigint, text, text, text, jsonb, uuid, boolean) set schema public;
    perform app_private.alignment_restore_function_acl('public.enqueue_match_participant_notification(bigint,text,text,text,jsonb,uuid,boolean)'::regprocedure);
  end if;
  if to_regprocedure('public.add_creator_to_match(uuid)') is not null then
    perform app_private.alignment_restore_function_acl('public.add_creator_to_match(uuid)'::regprocedure);
  end if;
  delete from app_private.production_alignment_log where kind = 'wrapped_function';
end
$rollback$;
drop function if exists app_private.assert_match_notification_allowed(bigint, text, boolean);
delete from supabase_migrations.schema_migrations where version = '20261010145000';
