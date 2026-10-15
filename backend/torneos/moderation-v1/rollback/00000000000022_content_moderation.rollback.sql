-- CONTENT MODERATION 0022 rollback: removes exactly what 00000000000022 added (three triggers, fourteen functions, five
-- tables). 0022 replaced no existing function, so nothing is put back. No other function, policy, grant or row changes.
-- Run only with the frontend's moderation UI off and the gateway's CONNECTED-V1 allowlist without the moderation RPCs (the
-- RPCs disappear; the gateway would answer their calls with the database's "function not found").
--
-- Reports, their audit trail, mutes, applicant blocks and platform holds are user and moderation data. While ANY of those
-- tables holds a row this file refuses (TORNEOS_0022_ROLLBACK_REFUSED) and changes nothing. The only override, for an
-- operator who has decided to discard them, is a session setting made in the SAME psql session before this file runs:
--     SET torneos.moderation_rollback_force = 'DISCARD MODERATION ROWS';
-- (db-0022.mjs does that only with `rollback-0022` and its own force phrase). Content already moderated stays as it is
-- (neutral names, unpublished pages); a page that was under a platform hold can be published again afterwards.
BEGIN;
DO $pre$
DECLARE
  v_rows bigint;
BEGIN
  IF to_regclass('public.tournament_content_reports') IS NULL
    OR to_regclass('public.tournament_content_report_events') IS NULL
    OR to_regclass('public.tournament_communication_mutes') IS NULL
    OR to_regclass('public.tournament_applicant_blocks') IS NULL
    OR to_regclass('private.tournament_moderation_holds') IS NULL
    OR to_regprocedure('public.report_tournament_content(text,text,uuid,text,text,text,uuid)') IS NULL
    OR to_regprocedure('private.tournament_moderation_handle(uuid,text,text,text,boolean)') IS NULL THEN
    RAISE EXCEPTION 'TORNEOS_0022_ROLLBACK_PRECONDITION_FAILED: 00000000000022 is not applied';
  END IF;
  SELECT (SELECT count(*) FROM public.tournament_content_reports) + (SELECT count(*) FROM public.tournament_content_report_events)
       + (SELECT count(*) FROM public.tournament_communication_mutes) + (SELECT count(*) FROM public.tournament_applicant_blocks)
       + (SELECT count(*) FROM private.tournament_moderation_holds)
    INTO v_rows;
  IF v_rows > 0 AND coalesce(current_setting('torneos.moderation_rollback_force', true), '') <> 'DISCARD MODERATION ROWS' THEN
    RAISE EXCEPTION 'TORNEOS_0022_ROLLBACK_REFUSED: % moderation rows exist (set torneos.moderation_rollback_force to discard them)', v_rows;
  END IF;
END
$pre$;

drop trigger tournament_public_pages_moderation_hold on public.tournament_public_pages;
drop trigger tournament_team_applications_moderation_block on public.tournament_team_applications;
drop trigger tournament_announcement_deliveries_moderation_mute on public.tournament_announcement_deliveries;

drop function public.platform_handle_tournament_content_report(uuid, text, text, text);
drop function public.platform_list_tournament_content_reports(text, integer);
drop function public.get_my_tournament_communication_mutes();
drop function public.set_tournament_communications_muted(uuid, uuid, boolean);
drop function public.unblock_tournament_applicant(uuid, uuid);
drop function public.block_tournament_applicant(uuid, uuid, text);
drop function public.handle_tournament_content_report(uuid, text, text, text);
drop function public.get_tournament_content_reports(uuid, text);
drop function public.report_tournament_content(text, text, uuid, text, text, text, uuid);
drop function private.tournament_moderation_delivery_mute();
drop function private.tournament_moderation_application_block();
drop function private.tournament_moderation_public_page_hold();
drop function private.tournament_moderation_handle(uuid, text, text, text, boolean);
drop function private.tournament_moderation_is_manager(uuid);

drop table private.tournament_moderation_holds;
drop table public.tournament_content_report_events;
drop table public.tournament_applicant_blocks;
drop table public.tournament_communication_mutes;
drop table public.tournament_content_reports;

DO $post$
BEGIN
  IF to_regclass('public.tournament_content_reports') IS NOT NULL
    OR to_regclass('public.tournament_content_report_events') IS NOT NULL
    OR to_regclass('public.tournament_communication_mutes') IS NOT NULL
    OR to_regclass('public.tournament_applicant_blocks') IS NOT NULL
    OR to_regclass('private.tournament_moderation_holds') IS NOT NULL
    OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
               WHERE n.nspname IN ('public', 'private') AND (p.proname LIKE '%content_report%' OR p.proname LIKE 'tournament_moderation_%'
                 OR p.proname IN ('report_tournament_content', 'block_tournament_applicant', 'unblock_tournament_applicant',
                   'set_tournament_communications_muted', 'get_my_tournament_communication_mutes')))
    OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgname LIKE '%_moderation_%' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'TORNEOS_0022_ROLLBACK_POSTCONDITION_FAILED';
  END IF;
END
$post$;
COMMIT;
