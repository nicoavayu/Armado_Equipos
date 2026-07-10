-- Creates one opt-in proposal from the authenticated user's active availability.
-- A real partido is deliberately not created until participants accept and an
-- organizer confirms venue/details.

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
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_format not in ('F5','F6','F7','F8','F9','F11') then raise exception 'invalid_format'; end if;

  -- Serialize proposal creation per user so a double tap (or two devices)
  -- can't slip past the active_proposal_exists check below.
  perform pg_advisory_xact_lock(hashtext('auto_match_proposal:' || auth.uid()::text));

  select * into v_mine
  from public.player_availability
  where user_id = auth.uid() and status = 'active' and ends_at > now()
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
      and p.proposed_starts_at < v_mine.ends_at
      and p.expires_at > v_mine.starts_at
  ) then
    raise exception 'active_proposal_exists';
  end if;

  create temporary table if not exists tmp_auto_match_candidates (
    availability_id bigint,
    user_id uuid,
    overlap_start timestamptz,
    overlap_end timestamptz,
    distance_km double precision
  ) on commit drop;
  truncate tmp_auto_match_candidates;

  insert into tmp_auto_match_candidates
  select c.availability_id, c.user_id, c.overlap_start, c.overlap_end, c.distance_km
  from (
    select
      other.id as availability_id,
      other.user_id as user_id,
      greatest(v_mine.starts_at, other.starts_at) as overlap_start,
      least(v_mine.ends_at, other.ends_at) as overlap_end,
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
      and other.ends_at > now()
      and other.user_id <> auth.uid()
      and p_format = any(other.formats)
      and greatest(v_mine.starts_at, other.starts_at) + interval '60 minutes' <= least(v_mine.ends_at, other.ends_at)
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

  -- Pairwise overlap doesn't guarantee the whole group shares a window:
  -- the proposal is only viable if everyone can still play 60 minutes together.
  if (select max(overlap_start) + interval '60 minutes' from tmp_auto_match_candidates)
     > (select min(overlap_end) from tmp_auto_match_candidates) then
    raise exception 'not_enough_candidates';
  end if;

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
    greatest(v_mine.starts_at, (select max(overlap_start) from tmp_auto_match_candidates)),
    v_mine.latitude,
    v_mine.longitude,
    v_required,
    'collecting',
    auth.uid(),
    least(v_mine.ends_at, (select min(overlap_end) from tmp_auto_match_candidates))
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
