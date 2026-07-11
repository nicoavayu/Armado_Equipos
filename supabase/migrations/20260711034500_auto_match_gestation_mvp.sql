begin;

-- Shared, visible lifecycle for automatic matches before the definitive partido exists.
alter table public.auto_match_proposals
  add column if not exists gestation_started_at timestamptz,
  add column if not exists gestation_threshold integer,
  add column if not exists cancelled_reason text;

-- Exact user coordinates are only needed while matching availabilities. Existing
-- proposal rows are scrubbed and new gestations deliberately store no coordinates.
update public.auto_match_proposals
set latitude = null,
    longitude = null
where latitude is not null or longitude is not null;

create index if not exists auto_match_proposals_active_slot_idx
  on public.auto_match_proposals(format, proposed_starts_at)
  where status in ('collecting', 'ready');

create or replace function public.auto_match_threshold(p_format text)
returns integer
language sql
immutable
as $$
  select greatest(4, ceil((substring(p_format from 2)::integer * 2) * 0.40)::integer);
$$;

create or replace function public.enqueue_auto_match_notification(
  p_proposal_id bigint,
  p_type text,
  p_title text,
  p_message text,
  p_recipient_ids uuid[] default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recipient uuid;
  v_count integer := 0;
  v_payload jsonb;
begin
  if p_type not in (
    'auto_match_gestating',
    'auto_match_almost_full',
    'auto_match_ready',
    'auto_match_cancelled'
  ) then
    raise exception 'invalid_auto_match_notification_type';
  end if;

  v_payload := jsonb_build_object(
    'proposal_id', p_proposal_id,
    'route', '/quiero-jugar?auto=1',
    'link', '/quiero-jugar?auto=1',
    'source', 'auto_match_gestation',
    'title', p_title,
    'message', p_message
  );

  for v_recipient in
    select distinct x.user_id
    from (
      select unnest(coalesce(p_recipient_ids, array[]::uuid[])) as user_id
      union all
      select m.user_id
      from public.auto_match_proposal_members m
      where m.proposal_id = p_proposal_id
    ) x
    where x.user_id is not null
  loop
    insert into public.notifications (
      user_id, type, title, message, data, read, created_at
    ) values (
      v_recipient, p_type, p_title, p_message, v_payload, false, now()
    );

    insert into public.notification_delivery_log (
      user_id,
      partido_id,
      notification_type,
      payload_json,
      channel,
      status,
      correlation_id,
      created_at
    ) values (
      v_recipient,
      null,
      p_type,
      v_payload,
      'push',
      'queued',
      gen_random_uuid(),
      now()
    );

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

create or replace function public.user_has_overlapping_auto_match(
  p_user_id uuid,
  p_starts_at timestamptz,
  p_exclude_proposal_id bigint default null
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.auto_match_proposal_members m
    join public.auto_match_proposals p on p.id = m.proposal_id
    where m.user_id = p_user_id
      and m.response <> 'declined'
      and p.status in ('collecting', 'ready')
      and p.expires_at > now()
      and (p_exclude_proposal_id is null or p.id <> p_exclude_proposal_id)
      and tstzrange(
        p.proposed_starts_at - interval '30 minutes',
        p.proposed_starts_at + interval '150 minutes',
        '[)'
      ) && tstzrange(
        p_starts_at - interval '30 minutes',
        p_starts_at + interval '150 minutes',
        '[)'
      )
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
      and (p.proposed_starts_at at time zone v_mine.timezone)::time + interval '60 minutes' <= v_mine.time_end
      and not public.user_has_overlapping_auto_match(auth.uid(), p.proposed_starts_at, p.id)
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
    select
      other.id,
      other.user_id,
      public.availability_days_mask(v_mine.days_of_week) & public.availability_days_mask(other.days_of_week),
      greatest(v_mine.time_start, other.time_start),
      least(v_mine.time_end, other.time_end),
      case
        when v_mine.latitude is null or v_mine.longitude is null or other.latitude is null or other.longitude is null then null
        else 6371 * 2 * asin(sqrt(
          power(sin(radians(other.latitude - v_mine.latitude) / 2), 2)
          + cos(radians(v_mine.latitude)) * cos(radians(other.latitude))
          * power(sin(radians(other.longitude - v_mine.longitude) / 2), 2)
        ))
      end
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
    order by overlap_end - overlap_start desc, distance_km asc nulls last
    limit v_required - 1;

    if (select count(*) from tmp_auto_match_gestation_candidates) + 1 < v_threshold then
      continue;
    end if;

    select bit_and(days_mask), max(overlap_start), min(overlap_end)
      into v_group_mask, v_group_start, v_group_end
    from tmp_auto_match_gestation_candidates;

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
      if not public.user_has_overlapping_auto_match(v_candidate.user_id, v_proposed, v_proposal.id) then
        insert into public.auto_match_proposal_members (
          proposal_id, availability_id, user_id, response
        ) values (
          v_proposal.id, v_candidate.availability_id, v_candidate.user_id, 'pending'
        ) on conflict do nothing;
      end if;
    end loop;

    select count(*) into v_member_count
    from public.auto_match_proposal_members
    where proposal_id = v_proposal.id and response <> 'declined';

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

create or replace function public.get_my_auto_match_proposals()
returns table (
  id bigint,
  format text,
  proposed_starts_at timestamptz,
  max_players integer,
  status text,
  expires_at timestamptz,
  gestation_started_at timestamptz,
  gestation_threshold integer,
  my_response text,
  member_count integer,
  accepted_count integer,
  pending_count integer,
  missing_count integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    p.format,
    p.proposed_starts_at,
    p.max_players,
    p.status,
    p.expires_at,
    p.gestation_started_at,
    p.gestation_threshold,
    mine.response as my_response,
    count(all_members.user_id) filter (where all_members.response <> 'declined')::integer as member_count,
    count(all_members.user_id) filter (where all_members.response = 'accepted')::integer as accepted_count,
    count(all_members.user_id) filter (where all_members.response = 'pending')::integer as pending_count,
    greatest(0, p.max_players - count(all_members.user_id) filter (where all_members.response = 'accepted'))::integer as missing_count
  from public.auto_match_proposal_members mine
  join public.auto_match_proposals p on p.id = mine.proposal_id
  join public.auto_match_proposal_members all_members on all_members.proposal_id = p.id
  where mine.user_id = auth.uid()
    and p.status in ('collecting', 'ready')
    and p.expires_at > now()
  group by p.id, mine.response
  order by p.proposed_starts_at asc;
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
  v_pending integer;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_response not in ('accepted','declined') then raise exception 'invalid_response'; end if;

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

  if p_response = 'declined' then
    update public.auto_match_proposals
    set status = 'cancelled',
        cancelled_reason = 'member_declined',
        updated_at = now()
    where id = p_proposal_id;

    perform public.enqueue_auto_match_notification(
      p_proposal_id,
      'auto_match_cancelled',
      'La propuesta se reorganizará',
      'Una persona no pudo sumarse. Tu disponibilidad sigue activa y Arma2 buscará otra combinación.',
      null
    );

    return v_member;
  end if;

  select
    count(*) filter (where response = 'accepted'),
    count(*) filter (where response = 'pending')
  into v_accepted, v_pending
  from public.auto_match_proposal_members
  where proposal_id = p_proposal_id;

  if v_accepted >= v_proposal.max_players then
    update public.auto_match_proposals
    set status = 'ready', updated_at = now()
    where id = p_proposal_id and status = 'collecting';

    perform public.enqueue_auto_match_notification(
      p_proposal_id,
      'auto_match_ready',
      '¡Ya somos todos!',
      'El cupo está completo. Entrá para tomar la organización y definir cancha y precio.',
      null
    );
  elsif v_proposal.max_players - v_accepted <= 2 and v_pending > 0 then
    perform public.enqueue_auto_match_notification(
      p_proposal_id,
      'auto_match_almost_full',
      'Faltan muy pocos',
      format('Faltan %s confirmaciones para completar el partido.', v_proposal.max_players - v_accepted),
      null
    );
  end if;

  return v_member;
end;
$$;

-- Keep the existing manual RPC compatible, but make it use the same privacy and
-- expiry rules. UI no longer needs to call it for gestation creation.
create or replace function public.create_my_auto_match_proposal(p_format text)
returns public.auto_match_proposals
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result record;
  v_proposal public.auto_match_proposals;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  perform public.sync_my_auto_match_gestations();

  select * into v_proposal
  from public.auto_match_proposals p
  where p.format = upper(p_format)
    and p.status in ('collecting', 'ready')
    and p.expires_at > now()
    and exists (
      select 1 from public.auto_match_proposal_members m
      where m.proposal_id = p.id and m.user_id = auth.uid()
    )
  order by p.created_at desc
  limit 1;

  if v_proposal.id is null then raise exception 'not_enough_candidates'; end if;
  return v_proposal;
end;
$$;

-- Redefine availability upsert so matching/gestation starts from the backend,
-- even when the user leaves the screen immediately after activating it.
create or replace function public.upsert_my_availability(
  p_days smallint[],
  p_time_start time,
  p_time_end time,
  p_formats text[],
  p_max_distance_km integer default 8,
  p_latitude double precision default null,
  p_longitude double precision default null
)
returns public.player_availability
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.player_availability;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_days is null or cardinality(p_days) = 0 or not (p_days <@ array[1,2,3,4,5,6,7]::smallint[]) then raise exception 'invalid_days'; end if;
  if p_time_start is null or p_time_end is null or p_time_end <= p_time_start then raise exception 'invalid_time_window'; end if;
  if p_time_end - p_time_start < interval '60 minutes' then raise exception 'window_too_short'; end if;
  if p_max_distance_km not between 1 and 50 then raise exception 'invalid_distance'; end if;
  if p_latitude is not null and p_latitude not between -90 and 90 then raise exception 'invalid_latitude'; end if;
  if p_longitude is not null and p_longitude not between -180 and 180 then raise exception 'invalid_longitude'; end if;
  if cardinality(p_formats) = 0 or not (p_formats <@ array['F5','F6','F7','F8','F9','F11']::text[]) then raise exception 'invalid_formats'; end if;

  update public.player_availability
  set status = 'cancelled', updated_at = now()
  where user_id = auth.uid() and status = 'active';

  insert into public.player_availability (
    user_id, days_of_week, time_start, time_end, formats, max_distance_km, latitude, longitude
  ) values (
    auth.uid(),
    array(select distinct unnest(p_days) order by 1),
    p_time_start,
    p_time_end,
    array(select distinct unnest(p_formats)),
    p_max_distance_km,
    p_latitude,
    p_longitude
  ) returning * into v_row;

  perform public.sync_my_auto_match_gestations();
  return v_row;
end;
$$;

revoke all on function public.auto_match_threshold(text) from public, anon;
revoke all on function public.enqueue_auto_match_notification(bigint,text,text,text,uuid[]) from public, anon, authenticated;
revoke all on function public.user_has_overlapping_auto_match(uuid,timestamptz,bigint) from public, anon, authenticated;
revoke all on function public.sync_my_auto_match_gestations() from public, anon;
revoke all on function public.get_my_auto_match_proposals() from public, anon;
revoke all on function public.respond_to_auto_match_proposal(bigint,text) from public, anon;
revoke all on function public.create_my_auto_match_proposal(text) from public, anon;
revoke all on function public.upsert_my_availability(smallint[],time,time,text[],integer,double precision,double precision) from public, anon;

grant execute on function public.sync_my_auto_match_gestations() to authenticated;
grant execute on function public.get_my_auto_match_proposals() to authenticated;
grant execute on function public.respond_to_auto_match_proposal(bigint,text) to authenticated;
grant execute on function public.create_my_auto_match_proposal(text) to authenticated;
grant execute on function public.upsert_my_availability(smallint[],time,time,text[],integer,double precision,double precision) to authenticated;

commit;
