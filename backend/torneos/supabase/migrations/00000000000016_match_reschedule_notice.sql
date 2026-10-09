-- Arma2 Torneos — PILOT 0016: the participants of a rescheduled or postponed match get a Torneos notice.
-- Independent of 00000000000012–00000000000015 (none touches these objects): any order. Rollback (documented, never
-- automatic): backend/torneos/connected-v1/rollback/00000000000016_match_reschedule_notice.rollback.sql
--
-- 0015 shows the previous time on Mis partidos, but nothing told the participants that the match moved. Now each
-- reschedule of a match in a published fixture leaves one notice in the Torneos inbox («Avisos») of every participant
-- who sees that match there: the eligible, active players of both approved rosters with a linked account and the
-- active captains and delegates of both teams (the same people get_player_tournament_matches and
-- get_managed_tournament_matches serve), except whoever rescheduled it.
--   • The notice carries the match, the previous and the new kickoff, and leads to /torneos/mis-partidos/<match>.
--     Never the organizer's reason: `message` stays null (CHECK below); venue and court are read on the match page.
--   • One reschedule → at most one notice per person: UNIQUE (source_reschedule_id, recipient_user_id).
--   • The same request again (double tap, retry) is a no-op in reschedule_tournament_match: no history row, no
--     notice, and 0015 keeps showing the real previous time. A history row that changes nothing visible is not
--     notified either.
--   • A postponement (postpone_tournament_match: no new time) leaves a 'match.postponed' notice with the time it had;
--     postponing again is refused by that RPC (the match is no longer 'scheduled'), so a retry adds nothing. When the
--     postponed match gets a new time, the 'match.rescheduled' notice says the time it had before the postponement.
--   • A return to "unscheduled" (restore_tournament_match_unscheduled) is not notified.
-- Inbox only, like 0009: no push, email or external side effect.
--
-- Two certified bodies change, each from its pinned md5: reschedule_tournament_match (one early return) and
-- get_my_torneos_notifications (three more fields). ACL, owner, SECURITY DEFINER and search_path are those of
-- CREATE OR REPLACE (unchanged).
BEGIN;

DO $pre$
DECLARE
  v_md5 text;
BEGIN
  IF to_regclass('public.tournament_user_notifications') IS NULL OR to_regclass('public.tournament_match_reschedules') IS NULL THEN
    RAISE EXCEPTION 'TORNEOS_PILOT_0016_PRECONDITION_FAILED: tournament_user_notifications or tournament_match_reschedules is missing';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tournament_user_notifications'
      AND column_name IN ('match_id', 'source_reschedule_id', 'previous_scheduled_at', 'scheduled_at')
  ) THEN
    RAISE EXCEPTION 'TORNEOS_PILOT_0016_PRECONDITION_FAILED: tournament_user_notifications already has match columns';
  END IF;
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint
      WHERE conrelid = 'public.tournament_user_notifications'::regclass AND conname = 'tournament_user_notifications_kind_check')
    IS DISTINCT FROM 'CHECK ((kind = ANY (ARRAY[''registration.submitted''::text, ''registration.received''::text, ''registration.approved''::text, ''registration.changes_requested''::text, ''registration.rejected''::text])))'
  THEN
    RAISE EXCEPTION 'TORNEOS_PILOT_0016_PRECONDITION_FAILED: the notification kinds are not the 0009 ones';
  END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc
  WHERE oid = 'public.reschedule_tournament_match(uuid,uuid,timestamptz,uuid,uuid,integer,text,boolean)'::regprocedure;
  IF v_md5 IS DISTINCT FROM 'be29c4ddabcfbcdbbf750e966f211f28' THEN
    RAISE EXCEPTION 'TORNEOS_PILOT_0016_PRECONDITION_FAILED: reschedule_tournament_match body is not the expected one (%)', v_md5;
  END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = 'public.get_my_torneos_notifications(boolean,integer,integer)'::regprocedure;
  IF v_md5 IS DISTINCT FROM 'cddfab2dec08d3571e6b6421e04c99f7' THEN
    RAISE EXCEPTION 'TORNEOS_PILOT_0016_PRECONDITION_FAILED: get_my_torneos_notifications body is not the expected one (%)', v_md5;
  END IF;
  IF to_regprocedure('public.notify_tournament_match_schedule_change()') IS NOT NULL THEN
    RAISE EXCEPTION 'TORNEOS_PILOT_0016_PRECONDITION_FAILED: notify_tournament_match_schedule_change already exists';
  END IF;
END $pre$;

ALTER TABLE public.tournament_user_notifications
  ADD COLUMN match_id uuid,
  ADD COLUMN source_reschedule_id bigint,
  ADD COLUMN previous_scheduled_at timestamptz,
  ADD COLUMN scheduled_at timestamptz,
  ADD CONSTRAINT tournament_user_notifications_match_fk
    FOREIGN KEY (match_id) REFERENCES public.tournament_matches(id) ON DELETE CASCADE,
  ADD CONSTRAINT tournament_user_notifications_reschedule_fk
    FOREIGN KEY (source_reschedule_id) REFERENCES public.tournament_match_reschedules(id) ON DELETE CASCADE,
  DROP CONSTRAINT tournament_user_notifications_kind_check,
  ADD CONSTRAINT tournament_user_notifications_kind_check CHECK (kind IN (
    'registration.submitted', 'registration.received', 'registration.approved',
    'registration.changes_requested', 'registration.rejected', 'match.rescheduled', 'match.postponed'
  )),
  -- A match notice always names its match and its history row, goes to the team side and never carries a message
  -- (the organizer's reason stays in the organization's history); a registration notice has none of it. A reschedule
  -- has a new time, a postponement has none.
  ADD CONSTRAINT tournament_user_notifications_match_shape_check CHECK (
    (kind IN ('match.rescheduled', 'match.postponed')) = (
      match_id IS NOT NULL AND source_reschedule_id IS NOT NULL AND audience = 'team' AND message IS NULL
    )
    AND (kind <> 'match.rescheduled' OR scheduled_at IS NOT NULL)
    AND (kind <> 'match.postponed' OR scheduled_at IS NULL)
  );
CREATE UNIQUE INDEX tournament_user_notifications_reschedule_recipient_key
  ON public.tournament_user_notifications (source_reschedule_id, recipient_user_id)
  WHERE source_reschedule_id IS NOT NULL;
CREATE INDEX tournament_user_notifications_match_idx
  ON public.tournament_user_notifications (match_id)
  WHERE match_id IS NOT NULL;

CREATE FUNCTION public.notify_tournament_match_schedule_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $function$
declare
  v_previous_at timestamptz := new.previous_scheduled_at;
  v_kind text;
  v_title text;
  v_tournament_name text;
  v_category_name text;
begin
  if new.new_status = 'scheduled' and new.new_scheduled_at is not null then
    v_kind := 'match.rescheduled';
    v_title := 'Partido reprogramado';
  elsif new.new_status = 'postponed' then
    v_kind := 'match.postponed';
    v_title := 'Partido postergado';
  else
    -- A return to "unscheduled" (or a cancellation recorded here) is not a schedule notice.
    return null;
  end if;
  -- Nothing a participant sees changed.
  if new.previous_status = 'scheduled'
    and new.previous_scheduled_at is not distinct from new.new_scheduled_at
    and new.previous_venue_id is not distinct from new.new_venue_id
    and new.previous_court_id is not distinct from new.new_court_id
  then
    return null;
  end if;
  -- Participants only see matches of the published fixture.
  if not exists (
    select 1 from public.tournament_fixture_versions version
    where version.id = new.fixture_version_id and version.status = 'published' and version.invalidated_at is null
  ) then
    return null;
  end if;
  -- A postponed match has no time left: the previous one is the time it had before the postponement.
  if v_previous_at is null then
    select reschedule.previous_scheduled_at into v_previous_at
    from public.tournament_match_reschedules reschedule
    where reschedule.match_id = new.match_id and reschedule.id <> new.id
      and reschedule.previous_scheduled_at is not null
    order by reschedule.created_at desc, reschedule.id desc
    limit 1;
  end if;
  select name into v_tournament_name from public.tournaments
  where id = new.tournament_id and organization_id = new.organization_id;
  select name into v_category_name from public.tournament_categories where id = new.category_id;

  insert into public.tournament_user_notifications (
    recipient_user_id, organization_id, tournament_id, team_entry_id, category_id,
    audience, kind, title, body, actor_user_id,
    match_id, source_reschedule_id, previous_scheduled_at, scheduled_at
  )
  select distinct on (recipient.user_id)
    recipient.user_id, new.organization_id, new.tournament_id, recipient.team_entry_id, new.category_id,
    'team', v_kind, v_title,
    left(own_entry.name || ' vs. ' || opponent_entry.name || ' · ' || coalesce(v_tournament_name, 'Torneo')
      || ' · ' || coalesce(v_category_name, 'Categoría'), 500),
    new.actor_user_id, new.match_id, new.id, v_previous_at,
    case when v_kind = 'match.rescheduled' then new.new_scheduled_at end
  from public.tournament_matches match_row
  cross join lateral public.tournament_match_team_entries(match_row.id) teams
  join lateral (
    -- The players get_player_tournament_matches serves…
    select player.arma2_user_id user_id, player.team_entry_id
    from public.tournament_roster_players player
    join public.tournament_rosters roster
      on roster.id = player.roster_id and roster.status in ('approved', 'locked')
    where player.team_entry_id in (teams.home_team_entry_id, teams.away_team_entry_id)
      and player.status = 'active' and player.eligibility_status = 'eligible'
      and player.arma2_user_id is not null
    union
    -- …and the captains and delegates get_managed_tournament_matches serves.
    select manager.user_id, manager.team_entry_id
    from public.tournament_team_managers manager
    where manager.team_entry_id in (teams.home_team_entry_id, teams.away_team_entry_id)
      and manager.status = 'active' and manager.role in ('captain', 'delegate')
      and manager.user_id is not null
  ) recipient on true
  join public.tournament_competition_participants own_participant
    on own_participant.team_entry_id = recipient.team_entry_id
    and own_participant.status = 'active'
    and own_participant.id in (match_row.home_participant_id, match_row.away_participant_id)
  join public.tournament_team_entries own_entry on own_entry.id = recipient.team_entry_id
  join public.tournament_team_entries opponent_entry
    on opponent_entry.id = case
      when recipient.team_entry_id = teams.home_team_entry_id then teams.away_team_entry_id
      else teams.home_team_entry_id end
  where match_row.id = new.match_id
    and recipient.user_id is distinct from new.actor_user_id
  order by recipient.user_id, recipient.team_entry_id
  on conflict (source_reschedule_id, recipient_user_id) where source_reschedule_id is not null do nothing;
  return null;
end;
$function$;

REVOKE ALL ON FUNCTION public.notify_tournament_match_schedule_change() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER tournament_match_reschedules_notify
  AFTER INSERT ON public.tournament_match_reschedules
  FOR EACH ROW EXECUTE FUNCTION public.notify_tournament_match_schedule_change();

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
  -- PILOT 0016: the same request again (a double tap, a retry) changes nothing and records nothing.
  if v_match.status = 'scheduled'
    and v_match.scheduled_at is not distinct from p_scheduled_at
    and v_match.venue_id is not distinct from p_venue_id
    and v_match.court_id is not distinct from p_court_id
    and v_match.duration_minutes is not distinct from p_duration_minutes
  then
    return jsonb_build_object('matchId', v_match.id, 'status', 'scheduled');
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
      'categoryId', page.category_id,
      'matchId', page.match_id,
      'previousScheduledAt', page.previous_scheduled_at,
      'scheduledAt', page.scheduled_at
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
  IF v_md5 IS DISTINCT FROM '9de3463325be197e4181673784c65d90' THEN
    RAISE EXCEPTION 'TORNEOS_PILOT_0016_POSTCONDITION_FAILED: reschedule_tournament_match body is not the expected one (%)', v_md5;
  END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = 'public.get_my_torneos_notifications(boolean,integer,integer)'::regprocedure;
  IF v_md5 IS DISTINCT FROM '856cad59ae5f93019dc0c7ab2aa7bf34' THEN
    RAISE EXCEPTION 'TORNEOS_PILOT_0016_POSTCONDITION_FAILED: get_my_torneos_notifications body is not the expected one (%)', v_md5;
  END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = 'public.notify_tournament_match_schedule_change()'::regprocedure;
  IF v_md5 IS DISTINCT FROM 'f71af1690aa88bdd994e0672adae27e3' THEN
    RAISE EXCEPTION 'TORNEOS_PILOT_0016_POSTCONDITION_FAILED: notify_tournament_match_schedule_change body is not the expected one (%)', v_md5;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid IN (
        'public.reschedule_tournament_match(uuid,uuid,timestamptz,uuid,uuid,integer,text,boolean)'::regprocedure,
        'public.get_my_torneos_notifications(boolean,integer,integer)'::regprocedure,
        'public.notify_tournament_match_schedule_change()'::regprocedure)
      AND (NOT p.prosecdef OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""'] OR has_function_privilege('anon', p.oid, 'EXECUTE'))
  ) OR NOT has_function_privilege('authenticated', 'public.reschedule_tournament_match(uuid,uuid,timestamptz,uuid,uuid,integer,text,boolean)', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'public.get_my_torneos_notifications(boolean,integer,integer)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.notify_tournament_match_schedule_change()', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'TORNEOS_PILOT_0016_POSTCONDITION_FAILED: grants, SECURITY DEFINER or search_path are not the expected ones';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.tournament_match_reschedules'::regclass AND tgname = 'tournament_match_reschedules_notify'
      AND tgfoid = 'public.notify_tournament_match_schedule_change()'::regprocedure AND NOT tgisinternal AND tgenabled = 'O'
  ) THEN
    RAISE EXCEPTION 'TORNEOS_PILOT_0016_POSTCONDITION_FAILED: the notice trigger is missing';
  END IF;
  IF (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.tournament_user_notifications'::regclass) IS NOT TRUE
    OR has_table_privilege('authenticated', 'public.tournament_user_notifications', 'SELECT')
    OR has_table_privilege('anon', 'public.tournament_user_notifications', 'SELECT')
  THEN
    RAISE EXCEPTION 'TORNEOS_PILOT_0016_POSTCONDITION_FAILED: tournament_user_notifications must stay closed to the API roles';
  END IF;
END $post$;

COMMIT;
