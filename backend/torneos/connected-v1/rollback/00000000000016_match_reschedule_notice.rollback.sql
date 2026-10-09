-- Rollback of PILOT 0016: removes the match notices and restores the two certified bodies (reschedule_tournament_match
-- records the same request again; get_my_torneos_notifications without match fields). Never automatic.
-- Data: the 'match.rescheduled' and 'match.postponed' notices are deleted (the reschedule history in tournament_match_reschedules stays).
BEGIN;

DO $pre$
DECLARE
  v_md5 text;
BEGIN
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc
  WHERE oid = 'public.reschedule_tournament_match(uuid,uuid,timestamptz,uuid,uuid,integer,text,boolean)'::regprocedure;
  IF v_md5 IS DISTINCT FROM '9de3463325be197e4181673784c65d90' THEN
    RAISE EXCEPTION 'TORNEOS_PILOT_0016_ROLLBACK_PRECONDITION_FAILED: reschedule_tournament_match is not the 0016 body (%)', v_md5;
  END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = 'public.get_my_torneos_notifications(boolean,integer,integer)'::regprocedure;
  IF v_md5 IS DISTINCT FROM '856cad59ae5f93019dc0c7ab2aa7bf34' THEN
    RAISE EXCEPTION 'TORNEOS_PILOT_0016_ROLLBACK_PRECONDITION_FAILED: get_my_torneos_notifications is not the 0016 body (%)', v_md5;
  END IF;
END $pre$;

DROP TRIGGER tournament_match_reschedules_notify ON public.tournament_match_reschedules;
DROP FUNCTION public.notify_tournament_match_schedule_change();
DELETE FROM public.tournament_user_notifications WHERE kind IN ('match.rescheduled', 'match.postponed');
DROP INDEX public.tournament_user_notifications_reschedule_recipient_key;
DROP INDEX public.tournament_user_notifications_match_idx;
ALTER TABLE public.tournament_user_notifications
  DROP CONSTRAINT tournament_user_notifications_match_shape_check,
  DROP CONSTRAINT tournament_user_notifications_kind_check,
  ADD CONSTRAINT tournament_user_notifications_kind_check CHECK (kind in (
    'registration.submitted', 'registration.received', 'registration.approved',
    'registration.changes_requested', 'registration.rejected'
  )),
  DROP COLUMN match_id,
  DROP COLUMN source_reschedule_id,
  DROP COLUMN previous_scheduled_at,
  DROP COLUMN scheduled_at;

CREATE OR REPLACE FUNCTION public.reschedule_tournament_match(p_organization_id uuid, p_match_id uuid, p_scheduled_at timestamp with time zone, p_venue_id uuid, p_court_id uuid, p_duration_minutes integer, p_reason text, p_override_warnings boolean DEFAULT false) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_match public.tournament_matches%rowtype;
  v_validation jsonb;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if private.current_identity_id() is null or char_length(v_reason) not between 3 and 500
    or not (public.has_tournament_organization_capability(
      p_organization_id, 'matches.reschedule'
    ) and public.has_tournament_season_access(p_organization_id, (select m.season_id from public.tournament_matches m where m.id = p_match_id and m.organization_id = p_organization_id)))
  then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;
  select match_row.* into v_match from public.tournament_matches match_row
  join public.tournament_fixture_versions version
    on version.id = match_row.fixture_version_id
    and version.status in ('draft', 'published')
    and version.invalidated_at is null
  where match_row.id = p_match_id
    and match_row.organization_id = p_organization_id
    and match_row.status in ('scheduled', 'postponed')
  for update of match_row;
  if v_match.id is null then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'torneos:schedule:court:' || p_court_id::text, 0
  ));
  perform pg_advisory_xact_lock(hashtextextended(
    'torneos:schedule:team:' || participant_id::text, 0
  ))
  from unnest(array_remove(
    array[v_match.home_participant_id, v_match.away_participant_id],
    null
  )) participant_id
  order by participant_id;
  v_validation := public.validate_tournament_match_schedule(
    p_organization_id, p_match_id, p_scheduled_at,
    p_venue_id, p_court_id, p_duration_minutes
  );
  if jsonb_array_length(v_validation->'blockers') > 0 then
    raise exception using errcode = '23514', message = 'TORNEOS_SCHEDULE_CONFLICT';
  end if;
  if jsonb_array_length(v_validation->'warnings') > 0 and (
    not p_override_warnings
    or not (public.has_tournament_organization_capability(
      p_organization_id, 'schedule_conflicts.override'
    ) and public.has_tournament_season_access(p_organization_id, (select m.season_id from public.tournament_matches m where m.id = p_match_id and m.organization_id = p_organization_id)))
  ) then
    raise exception using errcode = '23514', message = 'TORNEOS_SCHEDULE_WARNING_CONFIRMATION';
  end if;
  insert into public.tournament_match_reschedules (
    organization_id, tournament_id, category_id, fixture_version_id, match_id,
    previous_scheduled_at, previous_venue_id, previous_court_id,
    new_scheduled_at, new_venue_id, new_court_id, reason, actor_user_id,
    previous_status, new_status
  ) values (
    v_match.organization_id, v_match.tournament_id, v_match.category_id,
    v_match.fixture_version_id, v_match.id, v_match.scheduled_at,
    v_match.venue_id, v_match.court_id, p_scheduled_at, p_venue_id, p_court_id,
    v_reason, private.current_identity_id(), v_match.status, 'scheduled'
  );
  update public.tournament_matches
  set scheduled_at = p_scheduled_at, venue_id = p_venue_id, court_id = p_court_id,
      duration_minutes = p_duration_minutes, status = 'scheduled', postponed_at = null
  where id = v_match.id;
  if p_override_warnings and jsonb_array_length(v_validation->'warnings') > 0 then
    perform public.append_tournament_audit(
      p_organization_id, 'schedule_conflicts.overridden', 'match', v_match.id,
      null, v_match.tournament_id,
      jsonb_build_object('reason', v_reason, 'warnings', v_validation->'warnings')
    );
  end if;
  perform public.append_tournament_audit(
    p_organization_id, 'match.rescheduled', 'match', v_match.id,
    null, v_match.tournament_id,
    jsonb_build_object(
      'reason', v_reason,
      'previousScheduledAt', v_match.scheduled_at,
      'newScheduledAt', p_scheduled_at,
      'previousVenueId', v_match.venue_id, 'newVenueId', p_venue_id,
      'previousCourtId', v_match.court_id, 'newCourtId', p_court_id
    )
  );
  return jsonb_build_object('matchId', v_match.id, 'status', 'scheduled');
end;
$$;

create or replace function public.get_my_torneos_notifications(
  p_unread_only boolean default false, p_limit integer default 20, p_offset integer default 0
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.current_identity_id();
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_offset integer := least(greatest(coalesce(p_offset, 0), 0), 5000);
  v_result jsonb;
begin
  if v_uid is null then raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED'; end if;
  with visible as (
    select notification.*, tournament.name tournament_name, organization.name organization_name
    from public.tournament_user_notifications notification
    join public.tournaments tournament
      on tournament.id = notification.tournament_id and tournament.organization_id = notification.organization_id
    join public.tournament_organizations organization on organization.id = notification.organization_id
    where notification.recipient_user_id = v_uid
      and public.tournament_notification_visible(notification.audience, notification.organization_id, notification.tournament_id)
  ),
  page as (
    select * from visible
    where not coalesce(p_unread_only, false) or read_at is null
    order by created_at desc, id desc
    limit v_limit offset v_offset
  )
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(jsonb_build_object(
      'id', page.id,
      'kind', page.kind,
      'audience', page.audience,
      'title', page.title,
      'body', page.body,
      'message', page.message,
      'createdAt', page.created_at,
      'readAt', page.read_at,
      'organizationId', page.organization_id,
      'organizationName', page.organization_name,
      'tournamentId', page.tournament_id,
      'tournamentName', page.tournament_name,
      'teamEntryId', page.team_entry_id,
      'categoryId', page.category_id
    ) order by page.created_at desc, page.id desc) from page), '[]'::jsonb),
    'pagination', jsonb_build_object(
      'limit', v_limit, 'offset', v_offset,
      'total', (select count(*) from visible where not coalesce(p_unread_only, false) or read_at is null),
      'hasMore', (select count(*) from visible where not coalesce(p_unread_only, false) or read_at is null) > v_offset + v_limit
    ),
    'unreadCount', (select count(*) from visible where read_at is null)
  ) into v_result;
  return v_result;
end;
$$;

DO $post$
DECLARE
  v_md5 text;
BEGIN
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc
  WHERE oid = 'public.reschedule_tournament_match(uuid,uuid,timestamptz,uuid,uuid,integer,text,boolean)'::regprocedure;
  IF v_md5 IS DISTINCT FROM 'be29c4ddabcfbcdbbf750e966f211f28' THEN
    RAISE EXCEPTION 'TORNEOS_PILOT_0016_ROLLBACK_POSTCONDITION_FAILED: reschedule_tournament_match (%)', v_md5;
  END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = 'public.get_my_torneos_notifications(boolean,integer,integer)'::regprocedure;
  IF v_md5 IS DISTINCT FROM 'cddfab2dec08d3571e6b6421e04c99f7' THEN
    RAISE EXCEPTION 'TORNEOS_PILOT_0016_ROLLBACK_POSTCONDITION_FAILED: get_my_torneos_notifications (%)', v_md5;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tournament_user_notifications'
      AND column_name IN ('match_id', 'source_reschedule_id', 'previous_scheduled_at', 'scheduled_at')
  ) OR to_regprocedure('public.notify_tournament_match_schedule_change()') IS NOT NULL THEN
    RAISE EXCEPTION 'TORNEOS_PILOT_0016_ROLLBACK_POSTCONDITION_FAILED: 0016 objects remain';
  END IF;
END $post$;

COMMIT;
