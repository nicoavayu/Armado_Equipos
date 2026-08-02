begin;

-- ---------------------------------------------------------------------------
-- Elegibilidad común: ubicación completa, radio válido y cuenta de auth viva.
-- `usuarios.is_active` NO se usa: esa columna representa presencia en una
-- pantalla de partido (default false), no el lifecycle de la cuenta.
-- ---------------------------------------------------------------------------

create or replace function public.auto_match_has_valid_coordinates(
  p_latitude double precision,
  p_longitude double precision
)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_latitude is not null
    and p_longitude is not null
    and p_latitude <> 'NaN'::double precision
    and p_longitude <> 'NaN'::double precision
    and p_latitude between -90 and 90
    and p_longitude between -180 and 180
    and not (p_latitude = 0 and p_longitude = 0);
$$;

create or replace function public.auto_match_account_is_eligible(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from auth.users au
    where au.id = p_user_id
      and au.deleted_at is null
      and (au.banned_until is null or au.banned_until <= now())
  );
$$;

create or replace function public.auto_match_availability_is_eligible(p_availability_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.player_availability a
    where a.id = p_availability_id
      and a.status = 'active'
      and a.max_distance_km between 1 and 50
      and public.auto_match_has_valid_coordinates(a.latitude, a.longitude)
      and public.auto_match_account_is_eligible(a.user_id)
  );
$$;

create or replace function public.auto_match_distance_km(
  p_latitude_a double precision,
  p_longitude_a double precision,
  p_latitude_b double precision,
  p_longitude_b double precision
)
returns double precision
language sql
immutable
strict
set search_path = public
as $$
  select 6371 * 2 * asin(least(1::double precision, sqrt(
    power(sin(radians(p_latitude_b - p_latitude_a) / 2), 2)
    + cos(radians(p_latitude_a)) * cos(radians(p_latitude_b))
    * power(sin(radians(p_longitude_b - p_longitude_a) / 2), 2)
  )));
$$;

-- Compatibilidad simétrica: la distancia debe caber en el radio de A Y en el
-- de B. Al exigir elegibilidad de ambas filas, una coordenada faltante nunca
-- se interpreta como distancia abierta.
create or replace function public.auto_match_availabilities_are_compatible(
  p_availability_a bigint,
  p_availability_b bigint
)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.player_availability a
    join public.player_availability b on b.id = p_availability_b
    where a.id = p_availability_a
      and public.auto_match_availability_is_eligible(a.id)
      and public.auto_match_availability_is_eligible(b.id)
      and public.auto_match_distance_km(
        a.latitude, a.longitude, b.latitude, b.longitude
      ) <= a.max_distance_km
      and public.auto_match_distance_km(
        a.latitude, a.longitude, b.latitude, b.longitude
      ) <= b.max_distance_km
  );
$$;

-- Una persona sólo entra a una sala existente si es compatible con todos los
-- miembros vivos de esa sala. Esto hace que el resultado no dependa de quién
-- disparó primero el sync.
create or replace function public.auto_match_availability_fits_proposal(
  p_availability_id bigint,
  p_proposal_id bigint
)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select public.auto_match_availability_is_eligible(p_availability_id)
    and not exists (
      select 1
      from public.auto_match_proposal_members m
      where m.proposal_id = p_proposal_id
        and m.availability_id <> p_availability_id
        and m.response not in ('declined', 'expired', 'waitlisted')
        and not public.auto_match_availabilities_are_compatible(
          p_availability_id, m.availability_id
        )
    );
$$;

revoke all on function public.auto_match_has_valid_coordinates(double precision, double precision) from public, anon, authenticated, service_role;
revoke all on function public.auto_match_account_is_eligible(uuid) from public, anon, authenticated, service_role;
revoke all on function public.auto_match_availability_is_eligible(bigint) from public, anon, authenticated, service_role;
revoke all on function public.auto_match_distance_km(double precision, double precision, double precision, double precision) from public, anon, authenticated, service_role;
revoke all on function public.auto_match_availabilities_are_compatible(bigint, bigint) from public, anon, authenticated, service_role;
revoke all on function public.auto_match_availability_fits_proposal(bigint, bigint) from public, anon, authenticated, service_role;

-- Mantiene el contrato existente, pero rechaza pares parciales, NaN, rangos
-- inválidos y el sentinel 0,0. Ambos NULL siguen permitidos únicamente para
-- conservar búsquedas históricas incompletas; el matcher nunca las considera.
create or replace function public.upsert_my_availability(
  p_days smallint[],
  p_time_start time,
  p_time_end time,
  p_formats text[],
  p_max_distance_km integer default 8,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_can_organize boolean default false
)
returns public.player_availability
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_row public.player_availability;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_days is null or cardinality(p_days) = 0 or not (p_days <@ array[1,2,3,4,5,6,7]::smallint[]) then raise exception 'invalid_days'; end if;
  if p_time_start is null or p_time_end is null or p_time_end <= p_time_start then raise exception 'invalid_time_window'; end if;
  if p_time_end - p_time_start < interval '60 minutes' then raise exception 'window_too_short'; end if;
  if p_max_distance_km not between 1 and 50 then raise exception 'invalid_distance'; end if;
  if (p_latitude is null) <> (p_longitude is null) then raise exception 'invalid_coordinates'; end if;
  if p_latitude is not null and not public.auto_match_has_valid_coordinates(p_latitude, p_longitude) then
    raise exception 'invalid_coordinates';
  end if;
  if cardinality(p_formats) = 0 or not (p_formats <@ array['F5','F6','F7','F8','F9','F11']::text[]) then raise exception 'invalid_formats'; end if;

  update public.player_availability
  set status = 'cancelled', updated_at = now()
  where user_id = auth.uid() and status = 'active';

  insert into public.player_availability (
    user_id, days_of_week, time_start, time_end, formats, max_distance_km,
    latitude, longitude, can_organize
  ) values (
    auth.uid(), array(select distinct unnest(p_days) order by 1),
    p_time_start, p_time_end, array(select distinct unnest(p_formats)),
    p_max_distance_km, p_latitude, p_longitude, coalesce(p_can_organize, false)
  ) returning * into v_row;

  if public.auto_match_availability_is_eligible(v_row.id) then
    perform * from public.sync_my_auto_match_gestations();
  end if;
  return v_row;
end;
$$;

revoke all on function public.upsert_my_availability(smallint[],time,time,text[],integer,double precision,double precision,boolean) from public, anon;
grant execute on function public.upsert_my_availability(smallint[],time,time,text[],integer,double precision,double precision,boolean) to authenticated;

-- Completar ubicación modifica la misma disponibilidad activa y sincroniza en
-- la misma transacción. No cancela ni inserta búsquedas adicionales.
create or replace function public.sync_my_auto_match_location_from_profile()
returns public.player_availability
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_latitude double precision;
  v_longitude double precision;
  v_row public.player_availability;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;

  select u.latitud, u.longitud
  into v_latitude, v_longitude
  from public.usuarios u
  where u.id = auth.uid();

  if not public.auto_match_has_valid_coordinates(v_latitude, v_longitude) then
    raise exception 'auto_match_location_required';
  end if;

  update public.player_availability a
  set latitude = v_latitude,
      longitude = v_longitude,
      updated_at = case
        when a.latitude is distinct from v_latitude or a.longitude is distinct from v_longitude
          then now()
        else a.updated_at
      end
  where a.user_id = auth.uid() and a.status = 'active'
  returning a.* into v_row;

  if v_row.id is not null and public.auto_match_availability_is_eligible(v_row.id) then
    perform * from public.sync_my_auto_match_gestations();
  end if;
  return v_row;
end;
$$;

revoke all on function public.sync_my_auto_match_location_from_profile() from public, anon;
grant execute on function public.sync_my_auto_match_location_from_profile() to authenticated;

-- El listado manual usa exactamente la misma regla estricta y simétrica.
create or replace function public.find_my_availability_matches(p_limit integer default 30)
returns table (
  availability_id bigint,
  user_id uuid,
  nombre text,
  avatar_url text,
  shared_days smallint[],
  window_start time,
  window_end time,
  shared_formats text[],
  distance_km double precision,
  overlap_minutes integer
)
language sql
stable
security definer
set search_path = public, auth
as $$
  with mine as (
    select *
    from public.player_availability
    where user_id = auth.uid()
      and status = 'active'
      and public.auto_match_availability_is_eligible(id)
    order by created_at desc
    limit 1
  )
  select
    other.id,
    other.user_id,
    u.nombre,
    u.avatar_url,
    array(
      select unnest(mine.days_of_week)
      intersect select unnest(other.days_of_week)
      order by 1
    ),
    greatest(mine.time_start, other.time_start),
    least(mine.time_end, other.time_end),
    array(select unnest(mine.formats) intersect select unnest(other.formats)),
    public.auto_match_distance_km(
      mine.latitude, mine.longitude, other.latitude, other.longitude
    ) as distance_km,
    floor(extract(epoch from (
      least(mine.time_end, other.time_end) - greatest(mine.time_start, other.time_start)
    )) / 60)::integer as overlap_minutes
  from mine
  join public.player_availability other
    on other.status = 'active'
   and other.user_id <> mine.user_id
   and other.days_of_week && mine.days_of_week
   and other.formats && mine.formats
   and least(mine.time_end, other.time_end) - greatest(mine.time_start, other.time_start) >= interval '60 minutes'
   and public.auto_match_availabilities_are_compatible(mine.id, other.id)
  join public.usuarios u on u.id = other.user_id
  order by overlap_minutes desc, distance_km asc
  limit greatest(1, least(coalesce(p_limit, 30), 100));
$$;

revoke all on function public.find_my_availability_matches(integer) from public, anon;
grant execute on function public.find_my_availability_matches(integer) to authenticated;

-- Defensa común para backfill, reemplazos, vacantes, lista de espera y
-- cualquier alta futura. INSERT/reativación inválidos se omiten sin push; una
-- aceptación explícita inválida devuelve un error de producto al cliente.
create or replace function public.enforce_auto_match_member_eligibility()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if new.response not in ('pending', 'accepted') then return new; end if;

  if public.auto_match_availability_is_eligible(new.availability_id)
     and public.auto_match_availability_fits_proposal(new.availability_id, new.proposal_id) then
    return new;
  end if;

  if tg_op = 'UPDATE' and new.response = 'accepted' and old.response is distinct from 'accepted' then
    raise exception 'auto_match_location_or_account_ineligible';
  end if;
  return null;
end;
$$;

drop trigger if exists enforce_auto_match_member_eligibility_trigger
  on public.auto_match_proposal_members;
create trigger enforce_auto_match_member_eligibility_trigger
before insert or update of response, availability_id
on public.auto_match_proposal_members
for each row execute function public.enforce_auto_match_member_eligibility();

revoke all on function public.enforce_auto_match_member_eligibility() from public, anon, authenticated, service_role;

-- Matcher canónico: exige que el iniciador y todos los candidatos sean
-- elegibles, arma una cohorte pairwise compatible y vuelve a validar
-- superposición/rechazo antes de crear la sala.
create or replace function public.sync_my_auto_match_gestations()
returns table (proposal_id bigint, action text, format text)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_mine public.player_availability;
  v_format text;
  v_required integer;
  v_capacity integer;
  v_min integer;
  v_day smallint;
  v_group_start time;
  v_group_end time;
  v_local_today date;
  v_slot_date date;
  v_proposed timestamptz;
  v_expires timestamptz;
  v_offset integer;
  v_bucket bigint;
  v_proposal public.auto_match_proposals;
  v_candidate record;
  v_member_count integer;
  v_cand_count integer;
  v_created boolean;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;

  perform pg_advisory_xact_lock(hashtext('auto_match_sync:' || auth.uid()::text));
  perform public.expire_stale_auto_match_proposals();

  select * into v_mine
  from public.player_availability
  where user_id = auth.uid() and status = 'active'
  order by created_at desc
  limit 1;

  if v_mine.id is null or not public.auto_match_availability_is_eligible(v_mine.id) then
    return;
  end if;

  v_local_today := (now() at time zone v_mine.timezone)::date;

  foreach v_format in array v_mine.formats loop
    v_required := public.auto_match_required_players(v_format);
    v_capacity := public.auto_match_invitation_capacity(v_format);
    v_min := public.auto_match_min_candidates();

    foreach v_day in array v_mine.days_of_week loop
      v_created := false;

      -- Fase A: una sala existente sólo acepta al usuario si respeta los
      -- radios de todos sus miembros, además de horario y superposición.
      select p.* into v_proposal
      from public.auto_match_proposals p
      where p.status in ('collecting', 'ready')
        and p.format = v_format
        and p.expires_at > now()
        and extract(isodow from (p.proposed_starts_at at time zone v_mine.timezone))::smallint = v_day
        and (p.proposed_starts_at at time zone v_mine.timezone)::time >= v_mine.time_start
        and v_mine.time_end - (p.proposed_starts_at at time zone v_mine.timezone)::time >= interval '60 minutes'
        and public.auto_match_availability_fits_proposal(v_mine.id, p.id)
        and not public.user_has_overlapping_auto_match(auth.uid(), p.proposed_starts_at, p.id)
        and not public.user_declined_auto_match_slot(auth.uid(), v_format, p.proposed_starts_at)
        and not exists (
          select 1 from public.auto_match_proposal_members m
          where m.proposal_id = p.id and m.user_id = auth.uid()
        )
        and (
          select count(*) from public.auto_match_proposal_members m
          where m.proposal_id = p.id and m.response not in ('declined', 'expired', 'waitlisted')
        ) < v_capacity
      order by p.created_at asc
      limit 1
      for update skip locked;

      if v_proposal.id is not null then
        insert into public.auto_match_proposal_members (
          proposal_id, availability_id, user_id, response, can_organize, invite_expires_at
        ) values (
          v_proposal.id, v_mine.id, auth.uid(), 'pending', v_mine.can_organize,
          public.auto_match_invite_deadline(now(), v_proposal.proposed_starts_at)
        ) on conflict do nothing;

        if found then
          perform public.enqueue_auto_match_notification(
            v_proposal.id, 'auto_match_gestating', 'Se está armando un partido',
            format('Se está armando un %s compatible con tus horarios. Entrá para ver el estado.', v_format),
            array[auth.uid()]::uuid[], format('joined:%s', auth.uid()), null
          );
          proposal_id := v_proposal.id; action := 'joined'; format := v_format;
          return next;
          continue;
        end if;
      end if;

      -- Fase B: selección greedy de una clique. Cada nuevo integrante debe ser
      -- compatible con el iniciador y con todos los ya seleccionados.
      create temporary table if not exists tmp_auto_match_gestation_candidates (
        availability_id bigint,
        user_id uuid,
        overlap_start time,
        overlap_end time,
        distance_km double precision,
        can_organize boolean
      ) on commit drop;
      truncate tmp_auto_match_gestation_candidates;

      for v_candidate in
        select
          other.id as availability_id,
          other.user_id,
          greatest(v_mine.time_start, other.time_start) as overlap_start,
          least(v_mine.time_end, other.time_end) as overlap_end,
          public.auto_match_distance_km(
            v_mine.latitude, v_mine.longitude, other.latitude, other.longitude
          ) as distance_km,
          other.can_organize
        from public.player_availability other
        where other.status = 'active'
          and other.user_id <> auth.uid()
          and v_format = any(other.formats)
          and v_day = any(other.days_of_week)
          and least(v_mine.time_end, other.time_end) - greatest(v_mine.time_start, other.time_start) >= interval '60 minutes'
          and public.auto_match_availabilities_are_compatible(v_mine.id, other.id)
        order by
          least(v_mine.time_end, other.time_end) - greatest(v_mine.time_start, other.time_start) desc,
          public.auto_match_distance_km(
            v_mine.latitude, v_mine.longitude, other.latitude, other.longitude
          ) asc,
          other.created_at asc
      loop
        select count(*) into v_cand_count from tmp_auto_match_gestation_candidates;
        exit when v_cand_count >= v_capacity - 1;

        if exists (
          select 1
          from tmp_auto_match_gestation_candidates chosen
          where not public.auto_match_availabilities_are_compatible(
            chosen.availability_id, v_candidate.availability_id
          )
        ) then
          continue;
        end if;

        if exists (select 1 from tmp_auto_match_gestation_candidates)
           and least(
             v_candidate.overlap_end,
             (select min(chosen.overlap_end) from tmp_auto_match_gestation_candidates chosen)
           ) - greatest(
             v_candidate.overlap_start,
             (select max(chosen.overlap_start) from tmp_auto_match_gestation_candidates chosen)
           ) < interval '60 minutes' then
          continue;
        end if;

        insert into tmp_auto_match_gestation_candidates values (
          v_candidate.availability_id, v_candidate.user_id,
          v_candidate.overlap_start, v_candidate.overlap_end,
          v_candidate.distance_km, v_candidate.can_organize
        );
      end loop;

      select count(*) into v_cand_count from tmp_auto_match_gestation_candidates;
      if v_cand_count + 1 < v_min then continue; end if;

      select max(overlap_start), min(overlap_end)
      into v_group_start, v_group_end
      from tmp_auto_match_gestation_candidates;
      if v_group_start is null or v_group_end - v_group_start < interval '60 minutes' then continue; end if;

      v_proposed := null;
      for v_offset in 0..14 loop
        v_slot_date := v_local_today + v_offset;
        if extract(isodow from v_slot_date)::smallint = v_day then
          v_proposed := (v_slot_date + v_group_start) at time zone v_mine.timezone;
          if v_proposed > now() + interval '90 minutes' then exit; end if;
          v_proposed := null;
        end if;
      end loop;

      if v_proposed is null then continue; end if;
      if public.user_has_overlapping_auto_match(auth.uid(), v_proposed, null) then continue; end if;
      if public.user_declined_auto_match_slot(auth.uid(), v_format, v_proposed) then continue; end if;

      -- La superposición se evalúa antes del mínimo; así los usuarios del
      -- partido real #621 (o cualquier otro partido) nunca inflan la cohorte.
      delete from tmp_auto_match_gestation_candidates c
      where public.user_has_overlapping_auto_match(c.user_id, v_proposed, null)
         or public.user_declined_auto_match_slot(c.user_id, v_format, v_proposed);
      select count(*) into v_cand_count from tmp_auto_match_gestation_candidates;
      if v_cand_count + 1 < v_min then continue; end if;

      v_bucket := floor(extract(epoch from v_proposed) / 900)::bigint;
      perform pg_advisory_xact_lock(hashtextextended('auto_match_slot:' || v_format || ':' || (v_bucket - 1)::text, 0));
      perform pg_advisory_xact_lock(hashtextextended('auto_match_slot:' || v_format || ':' || v_bucket::text, 0));
      perform pg_advisory_xact_lock(hashtextextended('auto_match_slot:' || v_format || ':' || (v_bucket + 1)::text, 0));

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
        begin
          insert into public.auto_match_proposals (
            format, proposed_starts_at, latitude, longitude, max_players, status, created_by,
            expires_at, gestation_started_at, gestation_threshold
          ) values (
            v_format, v_proposed, null, null, v_required, 'collecting', auth.uid(),
            v_expires, now(), v_min
          ) returning * into v_proposal;
          v_created := true;
        exception when exclusion_violation then
          select p.* into v_proposal
          from public.auto_match_proposals p
          where p.status in ('collecting', 'ready')
            and p.format = v_format
            and abs(extract(epoch from (p.proposed_starts_at - v_proposed))) < 900
          order by p.created_at asc
          limit 1
          for update;
          if v_proposal.id is null then continue; end if;
        end;
      end if;

      if not v_created and not public.auto_match_availability_fits_proposal(v_mine.id, v_proposal.id) then
        continue;
      end if;

      if v_created then
        insert into public.auto_match_proposal_members (
          proposal_id, availability_id, user_id, response, responded_at, confirmed_at, can_organize
        ) values (
          v_proposal.id, v_mine.id, auth.uid(), 'accepted', now(), now(), v_mine.can_organize
        ) on conflict do nothing;
      else
        if (
          select count(*) from public.auto_match_proposal_members m
          where m.proposal_id = v_proposal.id and m.response not in ('declined', 'expired', 'waitlisted')
        ) >= v_capacity then continue; end if;

        insert into public.auto_match_proposal_members (
          proposal_id, availability_id, user_id, response, can_organize, invite_expires_at
        ) values (
          v_proposal.id, v_mine.id, auth.uid(), 'pending', v_mine.can_organize,
          public.auto_match_invite_deadline(now(), v_proposal.proposed_starts_at)
        ) on conflict do nothing;

        if found then
          perform public.enqueue_auto_match_notification(
            v_proposal.id, 'auto_match_gestating', 'Se está armando un partido',
            format('Se está armando un %s compatible con tus horarios. Entrá para ver el estado.', v_format),
            array[auth.uid()]::uuid[], format('joined:%s', auth.uid()), null
          );
        end if;
      end if;

      for v_candidate in select * from tmp_auto_match_gestation_candidates loop
        exit when (
          select count(*) from public.auto_match_proposal_members m
          where m.proposal_id = v_proposal.id and m.response not in ('declined', 'expired', 'waitlisted')
        ) >= v_capacity;

        if public.auto_match_availability_fits_proposal(v_candidate.availability_id, v_proposal.id)
           and not public.user_has_overlapping_auto_match(v_candidate.user_id, v_proposed, v_proposal.id)
           and not public.user_declined_auto_match_slot(v_candidate.user_id, v_format, v_proposed) then
          insert into public.auto_match_proposal_members (
            proposal_id, availability_id, user_id, response, can_organize, invite_expires_at
          ) values (
            v_proposal.id, v_candidate.availability_id, v_candidate.user_id, 'pending', v_candidate.can_organize,
            public.auto_match_invite_deadline(now(), v_proposed)
          ) on conflict do nothing;
        end if;
      end loop;

      select count(*) into v_member_count
      from public.auto_match_proposal_members m
      where m.proposal_id = v_proposal.id and m.response not in ('declined', 'expired', 'waitlisted');

      if v_created and v_member_count >= v_min then
        perform public.enqueue_auto_match_notification(
          v_proposal.id, 'auto_match_gestating',
          format('Se está armando un %s', v_format),
          format('Ya hay %s de %s jugadores compatibles. Entrá para confirmar si te sumás.', v_member_count, v_required),
          null, 'gestation_created', null
        );
      elsif v_created and v_member_count < v_min then
        update public.auto_match_proposals
        set status = 'cancelled', cancelled_reason = 'below_threshold', updated_at = now()
        where id = v_proposal.id;
        continue;
      end if;

      proposal_id := v_proposal.id;
      action := case when v_created then 'created' else 'joined' end;
      format := v_format;
      return next;
    end loop;
  end loop;
end;
$$;

revoke all on function public.sync_my_auto_match_gestations() from public, anon;
grant execute on function public.sync_my_auto_match_gestations() to authenticated;

-- Cohortes siguientes: misma selección pairwise y mismo filtro de elegibilidad.
create or replace function public.spawn_next_auto_match_cohort(p_proposal_id bigint)
returns bigint
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_base public.auto_match_proposals;
  v_format text;
  v_required integer;
  v_capacity integer;
  v_min integer;
  v_bucket bigint;
  v_expires timestamptz;
  v_new_id bigint;
  v_candidate record;
  v_cand_total integer;
begin
  select * into v_base from public.auto_match_proposals where id = p_proposal_id;
  if v_base.id is null or v_base.status not in ('collecting', 'ready') then return null; end if;

  v_format := v_base.format;
  v_required := v_base.max_players;
  v_capacity := public.auto_match_invitation_capacity(v_format);
  v_min := public.auto_match_min_candidates();

  update public.auto_match_proposals
  set titulares_completed_at = coalesce(titulares_completed_at, now())
  where id = p_proposal_id and titulares_completed_at is null;

  v_bucket := floor(extract(epoch from v_base.proposed_starts_at) / 900)::bigint;
  perform pg_advisory_xact_lock(hashtextextended('auto_match_cohort:' || v_format || ':' || v_bucket::text, 0));

  if exists (
    select 1 from public.auto_match_proposals cp
    where cp.format = v_format
      and cp.status in ('collecting', 'ready')
      and cp.titulares_completed_at is null
      and abs(extract(epoch from (cp.proposed_starts_at - v_base.proposed_starts_at))) < 900
  ) then return null; end if;

  create temporary table if not exists tmp_auto_match_cohort_candidates (
    availability_id bigint,
    user_id uuid,
    can_organize boolean
  ) on commit drop;
  truncate tmp_auto_match_cohort_candidates;

  for v_candidate in
    select a.id as availability_id, a.user_id, a.can_organize
    from public.player_availability a
    where a.status = 'active'
      and public.auto_match_availability_is_eligible(a.id)
      and v_format = any(a.formats)
      and extract(isodow from (v_base.proposed_starts_at at time zone a.timezone))::smallint = any(a.days_of_week)
      and (v_base.proposed_starts_at at time zone a.timezone)::time >= a.time_start
      and a.time_end - (v_base.proposed_starts_at at time zone a.timezone)::time >= interval '60 minutes'
      and not exists (
        select 1
        from public.auto_match_proposal_members m
        join public.auto_match_proposals cp on cp.id = m.proposal_id
        where m.user_id = a.user_id
          and cp.format = v_format
          and cp.status in ('collecting', 'ready', 'created')
          and abs(extract(epoch from (cp.proposed_starts_at - v_base.proposed_starts_at))) < 900
          and m.response <> 'waitlisted'
      )
      and not public.user_has_overlapping_auto_match(a.user_id, v_base.proposed_starts_at, null)
      and not public.user_declined_auto_match_slot(a.user_id, v_format, v_base.proposed_starts_at)
    order by a.created_at asc
  loop
    select count(*) into v_cand_total from tmp_auto_match_cohort_candidates;
    exit when v_cand_total >= v_capacity;

    if exists (
      select 1
      from tmp_auto_match_cohort_candidates chosen
      where not public.auto_match_availabilities_are_compatible(
        chosen.availability_id, v_candidate.availability_id
      )
    ) then continue; end if;

    insert into tmp_auto_match_cohort_candidates values (
      v_candidate.availability_id, v_candidate.user_id, v_candidate.can_organize
    );
  end loop;

  select count(*) into v_cand_total from tmp_auto_match_cohort_candidates;
  if v_cand_total < v_min then return null; end if;

  v_expires := v_base.proposed_starts_at - interval '30 minutes';
  begin
    insert into public.auto_match_proposals (
      format, proposed_starts_at, latitude, longitude, max_players, status, created_by,
      expires_at, gestation_started_at, gestation_threshold
    ) values (
      v_format, v_base.proposed_starts_at, null, null, v_required, 'collecting', v_base.created_by,
      v_expires, now(), v_min
    ) returning id into v_new_id;
  exception when exclusion_violation then
    return null;
  end;

  for v_candidate in select * from tmp_auto_match_cohort_candidates loop
    insert into public.auto_match_proposal_members (
      proposal_id, availability_id, user_id, response, can_organize, invite_expires_at
    ) values (
      v_new_id, v_candidate.availability_id, v_candidate.user_id, 'pending', v_candidate.can_organize,
      public.auto_match_invite_deadline(now(), v_base.proposed_starts_at)
    ) on conflict do nothing;

    if found then
      perform public.enqueue_auto_match_notification(
        v_new_id, 'auto_match_gestating', 'Se está armando un partido',
        format('Se está armando un %s compatible con tus horarios. Entrá para confirmar si te sumás.', v_format),
        array[v_candidate.user_id]::uuid[], format('cohort_invite:%s', v_candidate.user_id), null
      );
    end if;
  end loop;

  return v_new_id;
end;
$$;

revoke all on function public.spawn_next_auto_match_cohort(bigint) from public, anon, authenticated, service_role;

-- Retira de gestaciones sólo la membresía activa que ya no es elegible. La
-- disponibilidad histórica se conserva intacta; en partidos ya creados no se
-- toca a ningún jugador real, sólo invitaciones pendientes.
create or replace function public.prune_ineligible_auto_match_members()
returns integer
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_row record;
  v_pruned integer := 0;
begin
  create temporary table if not exists tmp_pruned_auto_match_proposals (
    proposal_id bigint primary key
  ) on commit drop;
  truncate tmp_pruned_auto_match_proposals;

  insert into tmp_pruned_auto_match_proposals
  select distinct m.proposal_id
  from public.auto_match_proposal_members m
  join public.auto_match_proposals p on p.id = m.proposal_id
  where p.status in ('collecting', 'ready')
    and m.response in ('pending', 'accepted')
    and not public.auto_match_availability_is_eligible(m.availability_id)
  on conflict do nothing;

  update public.auto_match_proposal_members m
  set response = 'expired', responded_at = now(), invite_expires_at = null
  from public.auto_match_proposals p
  where p.id = m.proposal_id
    and (
      (p.status in ('collecting', 'ready') and m.response in ('pending', 'accepted'))
      or (p.status = 'created' and m.response = 'pending')
    )
    and not public.auto_match_availability_is_eligible(m.availability_id);
  get diagnostics v_pruned = row_count;

  for v_row in select proposal_id from tmp_pruned_auto_match_proposals loop
    perform public.process_auto_match_member_exit(v_row.proposal_id);
  end loop;
  return v_pruned;
end;
$$;

revoke all on function public.prune_ineligible_auto_match_members() from public, anon, authenticated, service_role;

-- El barrido histórico mantenía propuestas existentes (vencimientos,
-- reemplazos, vacantes y cohortes siguientes), pero nunca iniciaba la primera
-- gestación si ningún cliente volvía a abrir la app. Este helper ejecuta el
-- matcher canónico para cada disponibilidad activa desde el backend.
--
-- No duplica la lógica de compatibilidad: sync_my_auto_match_gestations conserva
-- los advisory locks por usuario/slot, la constraint de exclusión, el límite de
-- convocatoria y los event_key idempotentes de notificaciones. Cada usuario se
-- procesa en un sub-bloque para que una fila inválida no aborte todo el cron.
create or replace function public.sync_active_auto_match_gestations()
returns table (processed_count integer, failed_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_original_sub text := current_setting('request.jwt.claim.sub', true);
  v_processed integer := 0;
  v_failed integer := 0;
begin
  for v_row in
    select pa.user_id
    from public.player_availability pa
    where pa.status = 'active'
      and public.auto_match_availability_is_eligible(pa.id)
    order by
      cardinality(pa.formats) * cardinality(pa.days_of_week) desc,
      pa.created_at asc,
      pa.id asc
  loop
    begin
      perform set_config('request.jwt.claim.sub', v_row.user_id::text, true);
      perform * from public.sync_my_auto_match_gestations();
      v_processed := v_processed + 1;
    exception when others then
      v_failed := v_failed + 1;
      raise warning 'auto_match_backend_sync_failed user_ref=% sqlstate=%',
        left(md5(v_row.user_id::text), 8), sqlstate;
    end;
  end loop;

  perform set_config('request.jwt.claim.sub', coalesce(v_original_sub, ''), true);
  processed_count := v_processed;
  failed_count := v_failed;
  return next;
exception when others then
  perform set_config('request.jwt.claim.sub', coalesce(v_original_sub, ''), true);
  raise;
end;
$$;

revoke all on function public.sync_active_auto_match_gestations() from public, anon, authenticated, service_role;

-- El job auto_match_sweep ya está programado cada cinco minutos y llama a esta
-- función por nombre. Redefinirla incorpora el inicio backend sin reprogramar
-- ni duplicar el cron instalado.
create or replace function public.auto_match_scheduled_sweep()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
begin
  perform public.prune_ineligible_auto_match_members();
  perform public.expire_stale_auto_match_proposals();

  -- Inicia la primera gestación (y completa salas existentes) aunque ningún
  -- frontend esté abierto. El matcher decide compatibilidad, cupo y locks.
  perform * from public.sync_active_auto_match_gestations();

  for v_row in
    select p.id
    from public.auto_match_proposals p
    where p.status in ('collecting', 'ready')
      and p.expires_at > now()
      and (
        select count(*) from public.auto_match_proposal_members m
        where m.proposal_id = p.id and m.response not in ('declined', 'expired', 'waitlisted')
      ) < public.auto_match_invitation_capacity(p.format)
    for update skip locked
  loop
    perform public.backfill_auto_match_proposal_members(v_row.id);
  end loop;

  perform public.reopen_auto_match_vacancies();

  for v_row in
    select p.id
    from public.auto_match_proposals p
    where p.status in ('collecting', 'ready')
      and p.titulares_completed_at is not null
      and p.proposed_starts_at > now()
    for update skip locked
  loop
    perform public.spawn_next_auto_match_cohort(v_row.id);
  end loop;
end;
$$;

revoke all on function public.auto_match_scheduled_sweep() from public, anon, authenticated, service_role;

commit;
