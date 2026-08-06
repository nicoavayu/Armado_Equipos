-- ==========================================================================
-- ROLLBACK COMPLETO de la migracion
--   supabase/migrations/20260806120000_auto_match_stop_search_atomic_exit.sql
--
-- Deja la base EXACTAMENTE en el estado previo a esa migracion. No toca datos:
-- la migracion es puramente de funciones, asi que revertirla es reponer cada
-- definicion anterior y borrar las funciones nuevas.
--
-- Cada bloque indica de que migracion sale el cuerpo que se repone.
--
-- Uso (una sola transaccion, todo o nada):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f scripts/auto-match-stop-search/rollback_20260806120000.sql
--
-- NOTA sobre los datos: si la migracion ya estuvo activa, algunas membresias
-- pueden haber quedado en 'declined'/'user_declined' o 'expired'/'invite_expired'
-- por bajas legitimas de jugadores. El rollback NO las revierte a proposito:
-- son bajas que el jugador pidio, y restaurarlas volveria a meterlo en partidos
-- de los que se fue.
-- ==========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. get_auto_match_proposal_members  ->  version de 20260712220000
--    (vuelve a devolver declined/expired/waitlisted y a permitir la consulta
--     a cualquier miembro, activo o no)
-- ---------------------------------------------------------------------------
create or replace function public.get_auto_match_proposal_members(p_proposal_id bigint)
returns table (
  user_id uuid,
  nombre text,
  avatar_url text,
  response text,
  can_organize boolean,
  is_organizer boolean,
  responded_at timestamptz,
  confirmed_at timestamptz,
  seat text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    t.user_id,
    t.nombre,
    t.avatar_url,
    t.response,
    t.can_organize,
    t.is_organizer,
    t.responded_at,
    t.confirmed_at,
    case
      when t.response = 'accepted' and t.accepted_rank <= t.max_players then 'titular'
      when t.response = 'accepted' then 'suplente'
      else null
    end as seat
  from (
    select
      m.user_id,
      u.nombre,
      u.avatar_url,
      m.response,
      m.can_organize,
      (p.organizer_id = m.user_id) as is_organizer,
      m.responded_at,
      m.confirmed_at,
      p.max_players,
      row_number() over (
        partition by (m.response = 'accepted')
        order by coalesce(m.confirmed_at, m.responded_at) asc nulls last, m.user_id
      ) as accepted_rank
    from public.auto_match_proposal_members m
    join public.auto_match_proposals p on p.id = m.proposal_id
    join public.usuarios u on u.id = m.user_id
    where m.proposal_id = p_proposal_id
      and exists (
        select 1 from public.auto_match_proposal_members me
        where me.proposal_id = p_proposal_id and me.user_id = auth.uid()
      )
  ) t
  order by
    t.is_organizer desc,
    case t.response when 'accepted' then 0 when 'pending' then 1 else 2 end,
    coalesce(t.confirmed_at, t.responded_at) asc nulls last,
    t.user_id;
$$;

revoke all on function public.get_auto_match_proposal_members(bigint) from public, anon;
grant execute on function public.get_auto_match_proposal_members(bigint) to authenticated;


-- ---------------------------------------------------------------------------
-- 2. cancel_my_availability  ->  version de 20260710101500
--    (misma firma que ahora: sin argumentos, returns void. Vuelve a ser
--     'language sql' y a cancelar SOLO player_availability)
-- ---------------------------------------------------------------------------
create or replace function public.cancel_my_availability()
returns void
language sql
security definer
set search_path = public
as $$
  update public.player_availability
     set status = 'cancelled', updated_at = now()
   where user_id = auth.uid() and status = 'active';
$$;

revoke execute on function public.cancel_my_availability() from public, anon;
grant execute on function public.cancel_my_availability() to authenticated;


-- ---------------------------------------------------------------------------
-- 3. enforce_auto_match_member_eligibility  ->  version de 20260716120000
--    (sin el guardia del advisory lock ni la revalidacion for-share)
-- ---------------------------------------------------------------------------
create or replace function public.enforce_auto_match_member_eligibility()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if new.response not in ('pending', 'accepted') then return new; end if;

  if tg_op = 'INSERT' then
    if new.availability_id is not null
       and public.auto_match_availability_is_eligible(new.availability_id)
       and public.auto_match_availability_fits_proposal(new.availability_id, new.proposal_id) then
      return new;
    end if;
    return null;
  end if;

  if old.response = 'expired'
     and new.response = 'accepted'
     and old.confirmed_at is not null
     and coalesce(old.response_reason, '') in ('', 'schedule_conflict', 'availability_ineligible')
     and public.auto_match_member_snapshot_is_valid_for_proposal(
       new.proposal_id, new.user_id
     )
     and public.auto_match_member_has_free_slot(new.proposal_id, new.user_id)
     and not exists (
       select 1
       from public.auto_match_proposal_members core
       where core.proposal_id = new.proposal_id
         and core.response = 'accepted'
         and core.user_id <> new.user_id
         and not public.auto_match_member_snapshots_are_compatible(
           new.proposal_id, new.user_id, core.user_id
         )
     ) then
    return new;
  end if;

  if public.auto_match_member_snapshot_fits_proposal(new.proposal_id, new.user_id) then
    return new;
  end if;

  if new.response = 'accepted' and old.response is distinct from 'accepted' then
    raise exception 'auto_match_location_or_account_ineligible';
  end if;
  return null;
end;
$$;


-- ---------------------------------------------------------------------------
-- 4. backfill_auto_match_proposal_members  ->  version de 20260715003000
--    (sin el try-lock por candidato ni la revalidacion bajo lock)
-- ---------------------------------------------------------------------------
create or replace function public.backfill_auto_match_proposal_members(p_proposal_id bigint)
returns integer
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_proposal public.auto_match_proposals;
  v_candidate record;
  v_active integer;
  v_capacity integer;
  v_added integer := 0;
begin
  select * into v_proposal
  from public.auto_match_proposals
  where id = p_proposal_id
  for update;

  if v_proposal.id is null or v_proposal.status not in ('collecting', 'ready') then
    return 0;
  end if;

  v_capacity := public.auto_match_invitation_capacity(v_proposal.format);
  select count(*) into v_active
  from public.auto_match_proposal_members m
  where m.proposal_id = p_proposal_id
    and m.response not in ('declined', 'expired', 'waitlisted');

  for v_candidate in
    select a.id as availability_id, a.user_id, a.can_organize
    from public.player_availability a
    where public.auto_match_availability_is_eligible(a.id)
      and public.auto_match_availability_fits_proposal(a.id, p_proposal_id)
      and not exists (
        select 1
        from public.auto_match_proposal_members m
        where m.proposal_id = p_proposal_id and m.user_id = a.user_id
      )
    order by a.created_at, a.id
  loop
    exit when v_active >= v_capacity;

    insert into public.auto_match_proposal_members (
      proposal_id, availability_id, user_id, response, can_organize, invite_expires_at
    ) values (
      p_proposal_id, v_candidate.availability_id, v_candidate.user_id,
      'pending', v_candidate.can_organize,
      public.auto_match_invite_deadline(now(), v_proposal.proposed_starts_at)
    ) on conflict do nothing;

    if found then
      v_active := v_active + 1;
      v_added := v_added + 1;
      perform public.enqueue_auto_match_notification(
        p_proposal_id,
        'auto_match_gestating',
        'Se libero un lugar',
        format('Se libero un lugar en un %s compatible con tus horarios. Entra para confirmar si te sumas.', v_proposal.format),
        array[v_candidate.user_id]::uuid[],
        format('joined:%s', v_candidate.user_id),
        null
      );
    end if;
  end loop;

  return v_added;
end;
$$;


-- ---------------------------------------------------------------------------
-- 5. upsert_my_availability  ->  version de 20260714030000
--    (sin el advisory lock adelantado)
-- ---------------------------------------------------------------------------
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


-- ---------------------------------------------------------------------------
-- 6. sync_my_auto_match_location_from_profile  ->  version de 20260714030000
--    (sin el advisory lock adelantado)
-- ---------------------------------------------------------------------------
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


-- ---------------------------------------------------------------------------
-- 7. Funciones NUEVAS que introdujo la migracion: se borran.
--    Va al final: los cuerpos repuestos arriba ya no las referencian.
-- ---------------------------------------------------------------------------
drop function if exists public.cancel_my_availability_detailed();
drop function if exists public.auto_match_cancel_search();
drop function if exists public.auto_match_user_search_is_active(uuid);
drop function if exists public.auto_match_availability_is_eligible_locked(bigint);
drop function if exists public.auto_match_try_lock_user(uuid);
drop function if exists public.auto_match_lock_user(uuid);
drop function if exists public.auto_match_user_lock_key(uuid);

commit;
