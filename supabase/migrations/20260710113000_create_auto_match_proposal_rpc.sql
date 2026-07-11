-- Creates one opt-in proposal from the authenticated user's active weekly
-- availability. The proposal pins a concrete datetime: the next upcoming
-- occurrence of a weekday the whole group shares, at the start of the
-- group's shared time window. A real partido is deliberately not created
-- until participants accept and an organizer confirms venue/details.

create or replace function public.create_my_auto_match_proposal(p_format text)
returns public.auto_match_proposals
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mine public.player_availability;
  v_required integer;
  v_proposal public.auto_match_proposals;
  v_candidate record;
  v_group_mask integer;
  v_group_start time;
  v_group_end time;
  v_local_today date;
  v_slot_date date;
  v_proposed timestamptz;
  v_expires timestamptz;
  v_offset integer;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_format not in ('F5','F6','F7','F8','F9','F11') then raise exception 'invalid_format'; end if;

  -- Serialize proposal creation per user so a double tap (or two devices)
  -- can't slip past the active_proposal_exists check below.
  perform pg_advisory_xact_lock(hashtext('auto_match_proposal:' || auth.uid()::text));

  select * into v_mine
  from public.player_availability
  where user_id = auth.uid() and status = 'active'
  order by created_at desc
  limit 1;

  if v_mine.id is null then raise exception 'availability_not_found'; end if;
  if not (p_format = any(v_mine.formats)) then raise exception 'format_not_available'; end if;

  v_required := substring(p_format from 2)::integer * 2;

  if exists (
    select 1
    from public.auto_match_proposal_members m
    join public.auto_match_proposals p on p.id = m.proposal_id
    where m.user_id = auth.uid()
      and m.response <> 'declined'
      and p.status in ('collecting','ready')
      and p.expires_at > now()
  ) then
    raise exception 'active_proposal_exists';
  end if;

  create temporary table if not exists tmp_auto_match_candidates (
    availability_id bigint,
    user_id uuid,
    -- intersection with MY availability, so group aggregates below already
    -- include my own bounds
    days_mask integer,
    overlap_start time,
    overlap_end time,
    distance_km double precision
  ) on commit drop;
  truncate tmp_auto_match_candidates;

  insert into tmp_auto_match_candidates
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
      and p_format = any(other.formats)
      and other.days_of_week && v_mine.days_of_week
      -- interval subtraction, never time + interval: time addition wraps at 24h
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

  if (select count(*) from tmp_auto_match_candidates) + 1 < v_required then
    raise exception 'not_enough_candidates';
  end if;

  -- Pairwise overlap doesn't guarantee the whole group shares a slot: the
  -- proposal is only viable if everyone shares at least one weekday AND a
  -- 60-minute time window.
  select bit_and(days_mask), max(overlap_start), min(overlap_end)
    into v_group_mask, v_group_start, v_group_end
  from tmp_auto_match_candidates;

  if coalesce(v_group_mask, 0) = 0
     or v_group_end - v_group_start < interval '60 minutes' then
    raise exception 'not_enough_candidates';
  end if;

  -- Next concrete occurrence of a shared weekday at the window start, in the
  -- availability's timezone. Two weeks of lookahead is more than enough: with
  -- at least one shared weekday there is always a hit within 8 days.
  v_local_today := (now() at time zone v_mine.timezone)::date;
  for v_offset in 0..14 loop
    v_slot_date := v_local_today + v_offset;
    if (v_group_mask & (1 << extract(isodow from v_slot_date)::integer)) <> 0 then
      v_proposed := (v_slot_date + v_group_start) at time zone v_mine.timezone;
      -- Skip a slot already underway (or about to start): proposals need
      -- time for every member to respond.
      if v_proposed > now() + interval '90 minutes' then
        exit;
      end if;
      v_proposed := null;
    end if;
  end loop;

  if v_proposed is null then raise exception 'not_enough_candidates'; end if;
  v_expires := (v_slot_date + v_group_end) at time zone v_mine.timezone;

  insert into public.auto_match_proposals (
    format,
    proposed_starts_at,
    latitude,
    longitude,
    max_players,
    status,
    created_by,
    expires_at
  ) values (
    p_format,
    v_proposed,
    v_mine.latitude,
    v_mine.longitude,
    v_required,
    'collecting',
    auth.uid(),
    v_expires
  ) returning * into v_proposal;

  insert into public.auto_match_proposal_members (
    proposal_id, availability_id, user_id, response, responded_at
  ) values (
    v_proposal.id, v_mine.id, auth.uid(), 'accepted', now()
  );

  for v_candidate in select * from tmp_auto_match_candidates loop
    insert into public.auto_match_proposal_members (
      proposal_id, availability_id, user_id, response
    ) values (
      v_proposal.id, v_candidate.availability_id, v_candidate.user_id, 'pending'
    );
  end loop;

  return v_proposal;
end;
$$;

create or replace function public.respond_to_auto_match_proposal(
  p_proposal_id bigint,
  p_response text
)
returns public.auto_match_proposal_members
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proposal public.auto_match_proposals;
  v_member public.auto_match_proposal_members;
  v_accepted integer;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_response not in ('accepted','declined') then raise exception 'invalid_response'; end if;

  -- Lock the proposal row: two members accepting at once would otherwise each
  -- miss the other's uncommitted response and neither would flip it to ready.
  select * into v_proposal
  from public.auto_match_proposals
  where id = p_proposal_id
  for update;

  if v_proposal.id is null then raise exception 'proposal_not_found'; end if;
  if v_proposal.status <> 'collecting' or v_proposal.expires_at <= now() then
    raise exception 'proposal_not_open';
  end if;

  update public.auto_match_proposal_members
  set response = p_response, responded_at = now()
  where proposal_id = p_proposal_id and user_id = auth.uid()
  returning * into v_member;

  if v_member.proposal_id is null then raise exception 'proposal_member_not_found'; end if;

  select count(*) filter (where response = 'accepted')
  into v_accepted
  from public.auto_match_proposal_members
  where proposal_id = p_proposal_id;

  if v_accepted >= v_proposal.max_players then
    update public.auto_match_proposals
    set status = 'ready', updated_at = now()
    where id = p_proposal_id and status = 'collecting';
  end if;

  return v_member;
end;
$$;

revoke execute on function public.create_my_auto_match_proposal(text) from public, anon;
revoke execute on function public.respond_to_auto_match_proposal(bigint,text) from public, anon;

grant execute on function public.create_my_auto_match_proposal(text) to authenticated;
grant execute on function public.respond_to_auto_match_proposal(bigint,text) to authenticated;
