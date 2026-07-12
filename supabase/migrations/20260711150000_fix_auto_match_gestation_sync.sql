begin;

-- Corrective migration for 20260711034500_auto_match_gestation_mvp.sql.
-- sync_my_auto_match_gestations crashed at runtime (reproduced against prod):
--   1) the candidate INSERT ... ORDER BY referenced overlap_end/overlap_start/
--      distance_km, which were never declared as output aliases (42703), so
--      every availability activation aborted before creating a gestation;
--   2) the member-count filter referenced proposal_id unqualified, ambiguous
--      between the column and the proposal_id OUT parameter (42702);
--   3) the join filter used time + interval, which wraps at 24:00 (see the
--      note in 20260710101500) and mis-matched proposals starting at 23:00.
-- Behavior fix: declining used to cancel the proposal while everyone stayed
-- eligible, so the next sync recreated the identical slot and re-notified the
-- decliner in a loop. A decline now pauses that format+slot for the decliner
-- for 24 hours; their availability stays active for other combinations.

create or replace function public.user_declined_auto_match_slot(
  p_user_id uuid,
  p_format text,
  p_starts_at timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.auto_match_proposal_members dm
    join public.auto_match_proposals dp on dp.id = dm.proposal_id
    where dm.user_id = p_user_id
      and dm.response = 'declined'
      and dm.responded_at > now() - interval '24 hours'
      and dp.format = p_format
      and abs(extract(epoch from (dp.proposed_starts_at - p_starts_at))) < 900
  );
$$;

create or replace function public.sync_my_auto_match_gestations()
returns table (
  proposal_id bigint,
  action text,
  format text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mine public.player_availability;
  v_format text;
  v_required integer;
  v_threshold integer;
  v_group_mask integer;
  v_group_start time;
  v_group_end time;
  v_local_today date;
  v_slot_date date;
  v_proposed timestamptz;
  v_expires timestamptz;
  v_offset integer;
  v_proposal public.auto_match_proposals;
  v_candidate record;
  v_member_count integer;
  v_created boolean;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;

  perform pg_advisory_xact_lock(hashtext('auto_match_sync:' || auth.uid()::text));

  select * into v_mine
  from public.player_availability
  where user_id = auth.uid() and status = 'active'
  order by created_at desc
  limit 1;

  if v_mine.id is null then return; end if;

  foreach v_format in array v_mine.formats loop
    v_required := substring(v_format from 2)::integer * 2;
    v_threshold := public.auto_match_threshold(v_format);
    v_created := false;

    -- Join an existing compatible gestation first.
    select p.* into v_proposal
    from public.auto_match_proposals p
    where p.status = 'collecting'
      and p.format = v_format
      and p.expires_at > now()
      and extract(isodow from (p.proposed_starts_at at time zone v_mine.timezone))::smallint = any(v_mine.days_of_week)
      and (p.proposed_starts_at at time zone v_mine.timezone)::time >= v_mine.time_start
      -- time - time yields an interval; time + interval would wrap at 24:00
      and v_mine.time_end - (p.proposed_starts_at at time zone v_mine.timezone)::time >= interval '60 minutes'
      and not public.user_has_overlapping_auto_match(auth.uid(), p.proposed_starts_at, p.id)
      and not public.user_declined_auto_match_slot(auth.uid(), v_format, p.proposed_starts_at)
      and not exists (
        select 1 from public.auto_match_proposal_members m
        where m.proposal_id = p.id and m.user_id = auth.uid()
      )
      and (select count(*) from public.auto_match_proposal_members m where m.proposal_id = p.id and m.response <> 'declined') < p.max_players
    order by p.created_at asc
    limit 1
    for update skip locked;

    if v_proposal.id is not null then
      insert into public.auto_match_proposal_members (
        proposal_id, availability_id, user_id, response
      ) values (
        v_proposal.id, v_mine.id, auth.uid(), 'pending'
      ) on conflict do nothing;

      perform public.enqueue_auto_match_notification(
        v_proposal.id,
        'auto_match_gestating',
        'Se está armando un partido',
        format('Se está armando un %s compatible con tus horarios. Entrá para ver el estado.', v_format),
        array[auth.uid()]::uuid[]
      );

      proposal_id := v_proposal.id;
      action := 'joined';
      format := v_format;
      return next;
      continue;
    end if;

    -- Build the best compatible group around the current user.
    create temporary table if not exists tmp_auto_match_gestation_candidates (
      availability_id bigint,
      user_id uuid,
      days_mask integer,
      overlap_start time,
      overlap_end time,
      distance_km double precision
    ) on commit drop;
    truncate tmp_auto_match_gestation_candidates;

    insert into tmp_auto_match_gestation_candidates
    select c.availability_id, c.user_id, c.days_mask, c.overlap_start, c.overlap_end, c.distance_km
    from (
      select
        other.id as availability_id,
        other.user_id as user_id,
        public.availability_days_mask(v_mine.days_of_week) & public.availability_days_mask(other.days_of_week) as days_mask,
        greatest(v_mine.time_start, other.time_start) as overlap_start,
        least(v_mine.time_end, other.time_end) as overlap_end,
        case
          when v_mine.latitude is null or v_mine.longitude is null or other.latitude is null or other.longitude is null then null
          else 6371 * 2 * asin(sqrt(
            power(sin(radians(other.latitude - v_mine.latitude) / 2), 2)
            + cos(radians(v_mine.latitude)) * cos(radians(other.latitude))
            * power(sin(radians(other.longitude - v_mine.longitude) / 2), 2)
          ))
        end as distance_km
      from public.player_availability other
      where other.status = 'active'
        and other.user_id <> auth.uid()
        and v_format = any(other.formats)
        and other.days_of_week && v_mine.days_of_week
        and least(v_mine.time_end, other.time_end) - greatest(v_mine.time_start, other.time_start) >= interval '60 minutes'
        and (
          v_mine.latitude is null or v_mine.longitude is null or other.latitude is null or other.longitude is null
          or (6371 * 2 * asin(sqrt(
            power(sin(radians(other.latitude - v_mine.latitude) / 2), 2)
            + cos(radians(v_mine.latitude)) * cos(radians(other.latitude))
            * power(sin(radians(other.longitude - v_mine.longitude) / 2), 2)
          ))) <= least(v_mine.max_distance_km, other.max_distance_km)
        )
    ) c
    order by c.overlap_end - c.overlap_start desc, c.distance_km asc nulls last
    limit v_required - 1;

    if (select count(*) from tmp_auto_match_gestation_candidates) + 1 < v_threshold then
      continue;
    end if;

    select bit_and(t.days_mask), max(t.overlap_start), min(t.overlap_end)
      into v_group_mask, v_group_start, v_group_end
    from tmp_auto_match_gestation_candidates t;

    if coalesce(v_group_mask, 0) = 0 or v_group_end - v_group_start < interval '60 minutes' then
      continue;
    end if;

    v_local_today := (now() at time zone v_mine.timezone)::date;
    v_proposed := null;
    for v_offset in 0..14 loop
      v_slot_date := v_local_today + v_offset;
      if (v_group_mask & (1 << extract(isodow from v_slot_date)::integer)) <> 0 then
        v_proposed := (v_slot_date + v_group_start) at time zone v_mine.timezone;
        if v_proposed > now() + interval '90 minutes' then exit; end if;
        v_proposed := null;
      end if;
    end loop;

    if v_proposed is null then continue; end if;
    if public.user_has_overlapping_auto_match(auth.uid(), v_proposed, null) then continue; end if;
    if public.user_declined_auto_match_slot(auth.uid(), v_format, v_proposed) then continue; end if;

    perform pg_advisory_xact_lock(hashtext('auto_match_slot:' || v_format || ':' || v_proposed::text));

    select p.* into v_proposal
    from public.auto_match_proposals p
    where p.status in ('collecting', 'ready')
      and p.format = v_format
      and abs(extract(epoch from (p.proposed_starts_at - v_proposed))) < 900
    order by p.created_at asc
    limit 1
    for update;

    if v_proposal.id is null then
      v_expires := v_proposed - interval '30 minutes';
      insert into public.auto_match_proposals (
        format,
        proposed_starts_at,
        latitude,
        longitude,
        max_players,
        status,
        created_by,
        expires_at,
        gestation_started_at,
        gestation_threshold
      ) values (
        v_format,
        v_proposed,
        null,
        null,
        v_required,
        'collecting',
        auth.uid(),
        v_expires,
        now(),
        v_threshold
      ) returning * into v_proposal;
      v_created := true;
    end if;

    insert into public.auto_match_proposal_members (
      proposal_id, availability_id, user_id, response, responded_at
    ) values (
      v_proposal.id, v_mine.id, auth.uid(), 'accepted', now()
    ) on conflict do nothing;

    for v_candidate in
      select * from tmp_auto_match_gestation_candidates
    loop
      exit when (select count(*) from public.auto_match_proposal_members m where m.proposal_id = v_proposal.id and m.response <> 'declined') >= v_required;
      if not public.user_has_overlapping_auto_match(v_candidate.user_id, v_proposed, v_proposal.id)
        and not public.user_declined_auto_match_slot(v_candidate.user_id, v_format, v_proposed) then
        insert into public.auto_match_proposal_members (
          proposal_id, availability_id, user_id, response
        ) values (
          v_proposal.id, v_candidate.availability_id, v_candidate.user_id, 'pending'
        ) on conflict do nothing;
      end if;
    end loop;

    select count(*) into v_member_count
    from public.auto_match_proposal_members m
    where m.proposal_id = v_proposal.id and m.response <> 'declined';

    if v_created then
      perform public.enqueue_auto_match_notification(
        v_proposal.id,
        'auto_match_gestating',
        format('Se está armando un %s', v_format),
        format('Ya hay %s de %s jugadores compatibles. Entrá para confirmar si te sumás.', v_member_count, v_required),
        null
      );
    end if;

    proposal_id := v_proposal.id;
    action := case when v_created then 'created' else 'joined' end;
    format := v_format;
    return next;
  end loop;
end;
$$;

revoke all on function public.user_declined_auto_match_slot(uuid,text,timestamptz) from public, anon, authenticated;
revoke all on function public.sync_my_auto_match_gestations() from public, anon;
grant execute on function public.sync_my_auto_match_gestations() to authenticated;

commit;
