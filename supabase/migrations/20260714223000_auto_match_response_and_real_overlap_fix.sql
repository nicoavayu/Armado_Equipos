begin;

-- Partido automatico: una membresia conserva el snapshot de disponibilidad con
-- el que fue convocada. Re-guardar la busqueda no puede invalidar compromisos
-- aceptados ni envenenar las confirmaciones de los demas miembros.
alter table public.auto_match_proposal_members
  add column if not exists response_reason text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'auto_match_member_response_reason_check'
  ) then
    alter table public.auto_match_proposal_members
      add constraint auto_match_member_response_reason_check
      check (response_reason is null or response_reason in (
        'user_declined', 'schedule_conflict', 'invite_expired',
        'availability_ineligible', 'account_ineligible'
      ));
  end if;
end;
$$;

-- Duracion canonica vigente para conflictos de agenda. El rango semiabierto
-- permite que un partido empiece exactamente cuando termina el anterior.
create or replace function public.auto_match_duration(p_format text)
returns interval
language sql
immutable
set search_path = public
as $$
  select interval '120 minutes';
$$;

create or replace function public.auto_match_play_range(
  p_starts_at timestamptz,
  p_format text
)
returns tstzrange
language sql
immutable
set search_path = public
as $$
  select tstzrange(
    p_starts_at,
    p_starts_at + public.auto_match_duration(p_format),
    '[)'
  );
$$;

revoke all on function public.auto_match_duration(text) from public, anon, authenticated, service_role;
revoke all on function public.auto_match_play_range(timestamptz,text) from public, anon, authenticated, service_role;

-- Compatibilidad de snapshots: exige cuenta, coordenadas y radios validos,
-- pero no que la fila historica siga status='active'. El estado activo solo es
-- requisito para quien esta intentando entrar ahora.
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
      and public.auto_match_account_is_eligible(a.user_id)
      and public.auto_match_account_is_eligible(b.user_id)
      and public.auto_match_has_valid_coordinates(a.latitude, a.longitude)
      and public.auto_match_has_valid_coordinates(b.latitude, b.longitude)
      and a.max_distance_km between 1 and 50
      and b.max_distance_km between 1 and 50
      and public.auto_match_distance_km(
        a.latitude, a.longitude, b.latitude, b.longitude
      ) <= a.max_distance_km
      and public.auto_match_distance_km(
        a.latitude, a.longitude, b.latitude, b.longitude
      ) <= b.max_distance_km
  );
$$;

-- El candidato debe seguir activo y su busqueda debe admitir el horario y
-- formato concretos. Los demas miembros se comparan como snapshots, no como
-- busquedas globales todavia activas. La ventana representa posibles inicios;
-- conserva el minimo vigente de 60 minutos desde el inicio elegido.
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
  select exists (
    select 1
    from public.player_availability a
    join public.auto_match_proposals p on p.id = p_proposal_id
    where a.id = p_availability_id
      and public.auto_match_availability_is_eligible(a.id)
      and p.format = any(a.formats)
      and extract(isodow from (p.proposed_starts_at at time zone a.timezone))::smallint = any(a.days_of_week)
      and (p.proposed_starts_at at time zone a.timezone)::time >= a.time_start
      and a.time_end - (p.proposed_starts_at at time zone a.timezone)::time >= interval '60 minutes'
      and not exists (
        select 1
        from public.auto_match_proposal_members m
        where m.proposal_id = p.id
          and m.user_id <> a.user_id
          and m.response not in ('declined', 'expired', 'waitlisted')
          and not public.auto_match_availabilities_are_compatible(a.id, m.availability_id)
      )
  );
$$;

revoke all on function public.auto_match_availabilities_are_compatible(bigint,bigint) from public, anon, authenticated, service_role;
revoke all on function public.auto_match_availability_fits_proposal(bigint,bigint) from public, anon, authenticated, service_role;

-- Re-guardar una busqueda compatible religa las membresias vivas a la nueva
-- fila. Las aceptadas incompatibles conservan su snapshot: son compromisos, no
-- una razon para consumir globalmente la nueva busqueda.
create or replace function public.rebind_auto_match_memberships_after_availability_insert()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if new.status <> 'active' then return new; end if;

  update public.auto_match_proposal_members m
  set availability_id = new.id
  from public.auto_match_proposals p
  where p.id = m.proposal_id
    and m.user_id = new.user_id
    and m.availability_id <> new.id
    and m.response in ('pending', 'accepted')
    and p.status in ('collecting', 'ready', 'created')
    and public.auto_match_availability_fits_proposal(new.id, p.id);

  return new;
end;
$$;

drop trigger if exists rebind_auto_match_memberships_after_availability_insert
  on public.player_availability;
create trigger rebind_auto_match_memberships_after_availability_insert
after insert on public.player_availability
for each row execute function public.rebind_auto_match_memberships_after_availability_insert();

revoke all on function public.rebind_auto_match_memberships_after_availability_insert() from public, anon, authenticated, service_role;

-- Repara de forma idempotente membresias vivas que ya quedaron apuntando a una
-- fila anterior, siempre que la busqueda activa actual siga siendo compatible.
update public.auto_match_proposal_members m
set availability_id = a.id
from public.player_availability a, public.auto_match_proposals p
where p.id = m.proposal_id
  and a.user_id = m.user_id
  and a.status = 'active'
  and a.id <> m.availability_id
  and m.response in ('pending', 'accepted')
  and p.status in ('collecting', 'ready', 'created')
  and public.auto_match_availability_fits_proposal(a.id, p.id);

-- Un retiro automatico por agenda no equivale a un rechazo voluntario y no
-- impide otras combinaciones futuras del mismo formato/slot.
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
      and (dm.response_reason is null or dm.response_reason = 'user_declined')
      and dp.format = p_format
      and abs(extract(epoch from (dp.proposed_starts_at - p_starts_at))) < 900
      and dp.proposed_starts_at > now()
  );
$$;

revoke all on function public.user_declined_auto_match_slot(uuid,text,timestamptz) from public, anon, authenticated, service_role;

-- Conflicto real: usa el horario de cada propuesta/partido y 120 minutos. Ni
-- el formato, ni el availability_id, ni toda la ventana de busqueda bloquean.
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
      and m.response = 'accepted'
      and p.status in ('collecting', 'ready')
      and p.expires_at > now()
      and (p_exclude_proposal_id is null or p.id <> p_exclude_proposal_id)
      and public.auto_match_play_range(p.proposed_starts_at, p.format)
          && public.auto_match_play_range(p_starts_at, null)
  )
  or exists (
    select 1
    from public.jugadores j
    join public.partidos pa on pa.id = j.partido_id
    where j.usuario_id = p_user_id
      and coalesce(pa.estado, '') not in ('deleted', 'cancelado', 'cancelled', 'finalizado')
      and public.partido_kickoff_at(pa.fecha, pa.hora) is not null
      and public.auto_match_play_range(
            public.partido_kickoff_at(pa.fecha, pa.hora), pa.modalidad
          ) && public.auto_match_play_range(p_starts_at, null)
  );
$$;

revoke all on function public.user_has_overlapping_auto_match(uuid,timestamptz,bigint) from public, anon, authenticated, service_role;

-- Una baja libera solo esa membresia. Se intenta backfill y, si la sala estaba
-- ready, vuelve a collecting; nunca se cancela toda la gestacion ni se envia un
-- push de cancelacion por quedar momentaneamente debajo del umbral.
create or replace function public.process_auto_match_member_exit(p_proposal_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proposal public.auto_match_proposals;
  v_required integer;
  v_accepted integer;
begin
  select * into v_proposal
  from public.auto_match_proposals
  where id = p_proposal_id
  for update;

  if v_proposal.id is null or v_proposal.status not in ('collecting', 'ready') then
    return;
  end if;

  if v_proposal.organizer_id is not null
     and not exists (
       select 1 from public.auto_match_proposal_members m
       where m.proposal_id = p_proposal_id
         and m.user_id = v_proposal.organizer_id
         and m.response = 'accepted'
     ) then
    update public.auto_match_proposals
    set organizer_id = null, organizer_deadline_at = null, updated_at = now()
    where id = p_proposal_id;
  end if;

  perform public.backfill_auto_match_proposal_members(p_proposal_id);

  v_required := v_proposal.max_players;
  select count(*) filter (where response = 'accepted')
  into v_accepted
  from public.auto_match_proposal_members
  where proposal_id = p_proposal_id;

  if v_proposal.status = 'ready' and v_accepted < v_required then
    update public.auto_match_proposals
    set status = 'collecting', organizer_deadline_at = null, updated_at = now()
    where id = p_proposal_id and status = 'ready';
  end if;
end;
$$;

revoke all on function public.process_auto_match_member_exit(bigint) from public, anon, authenticated, service_role;

-- Solo una invitacion pendiente depende de que su busqueda siga activa. Una
-- confirmacion aceptada persiste al editar/cancelar la busqueda, pero una cuenta
-- eliminada o suspendida se sigue retirando: no se relajan controles de cuenta.
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
    and (
      (m.response = 'pending' and not public.auto_match_availability_is_eligible(m.availability_id))
      or (m.response = 'accepted' and not public.auto_match_account_is_eligible(m.user_id))
    )
  on conflict do nothing;

  update public.auto_match_proposal_members m
  set response = 'expired',
      response_reason = case
        when not public.auto_match_account_is_eligible(m.user_id) then 'account_ineligible'
        else 'availability_ineligible'
      end,
      responded_at = now(),
      confirmed_at = case when m.response = 'accepted' then null else m.confirmed_at end,
      invite_expires_at = null
  from public.auto_match_proposals p
  where p.id = m.proposal_id
    and (
      (
        p.status in ('collecting', 'ready')
        and (
          (m.response = 'pending' and not public.auto_match_availability_is_eligible(m.availability_id))
          or (m.response = 'accepted' and not public.auto_match_account_is_eligible(m.user_id))
        )
      )
      or (
        p.status = 'created'
        and m.response = 'pending'
        and not public.auto_match_availability_is_eligible(m.availability_id)
      )
    );
  get diagnostics v_pruned = row_count;

  for v_row in select proposal_id from tmp_pruned_auto_match_proposals loop
    perform public.process_auto_match_member_exit(v_row.proposal_id);
  end loop;
  return v_pruned;
end;
$$;

revoke all on function public.prune_ineligible_auto_match_members() from public, anon, authenticated, service_role;

-- Respuesta atomica e idempotente. Una confirmacion previa gana sobre retries;
-- una segunda propuesta ya aceptada/partido real superpuesto rechaza el nuevo
-- intento con estado especifico. Solo pendientes superpuestos se retiran.
create or replace function public.respond_to_auto_match_proposal(
  p_proposal_id bigint,
  p_response text,
  p_can_organize boolean default false
)
returns public.auto_match_proposal_members
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_proposal public.auto_match_proposals;
  v_member public.auto_match_proposal_members;
  v_accepted integer;
  v_pending integer;
  v_required integer;
  v_overlap record;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_response not in ('accepted','declined') then raise exception 'invalid_response'; end if;

  -- Serializa todas las respuestas del usuario, incluso si llegan para salas
  -- distintas al mismo tiempo. Asi el chequeo de superposicion y el cambio a
  -- accepted forman una unica decision sin carreras de doble reserva.
  perform pg_advisory_xact_lock(hashtext('auto_match_response:' || auth.uid()::text));

  perform public.expire_stale_auto_match_proposals();

  select * into v_proposal
  from public.auto_match_proposals
  where id = p_proposal_id
  for update;
  if v_proposal.id is null then raise exception 'proposal_not_found'; end if;

  select * into v_member
  from public.auto_match_proposal_members
  where proposal_id = p_proposal_id and user_id = auth.uid()
  for update;
  if v_member.proposal_id is null then raise exception 'proposal_member_not_found'; end if;

  -- Retries de la misma respuesta devuelven la fila ya persistida, incluso si
  -- la propuesta cambio de estado entre el commit y el refresh del cliente.
  if p_response = 'accepted' and v_member.response = 'accepted' then
    if coalesce(p_can_organize, false) and not v_member.can_organize
       and v_proposal.status in ('collecting', 'ready') then
      update public.auto_match_proposal_members
      set can_organize = true
      where proposal_id = p_proposal_id and user_id = auth.uid()
      returning * into v_member;
    end if;
    return v_member;
  end if;
  if p_response = 'declined' and v_member.response = 'declined' then
    return v_member;
  end if;

  if v_member.response = 'declined' then raise exception 'proposal_member_declined'; end if;
  if v_member.response = 'expired' then raise exception 'proposal_member_expired'; end if;
  if v_member.response = 'waitlisted' then raise exception 'proposal_member_waitlisted'; end if;
  if v_proposal.status not in ('collecting', 'ready') or v_proposal.expires_at <= now() then
    raise exception 'proposal_not_open';
  end if;

  v_required := v_proposal.max_players;

  if p_response = 'accepted' then
    if not public.auto_match_availability_is_eligible(v_member.availability_id)
       or not public.auto_match_availability_fits_proposal(v_member.availability_id, p_proposal_id) then
      raise exception 'auto_match_location_or_account_ineligible';
    end if;

    if public.user_has_overlapping_auto_match(auth.uid(), v_proposal.proposed_starts_at, p_proposal_id) then
      raise exception 'proposal_schedule_conflict';
    end if;

    update public.auto_match_proposal_members
    set response = 'accepted',
        response_reason = null,
        can_organize = can_organize or coalesce(p_can_organize, false),
        confirmed_at = coalesce(confirmed_at, now()),
        responded_at = coalesce(responded_at, now())
    where proposal_id = p_proposal_id and user_id = auth.uid()
    returning * into v_member;

    -- Una pendiente realmente superpuesta deja de reservar a esta persona. Las
    -- aceptadas no se cambian: habrian sido detectadas arriba como conflicto.
    for v_overlap in
      select p.id
      from public.auto_match_proposal_members m
      join public.auto_match_proposals p on p.id = m.proposal_id
      where m.user_id = auth.uid()
        and m.response = 'pending'
        and p.id <> p_proposal_id
        and p.status in ('collecting', 'ready')
        and p.expires_at > now()
        and public.auto_match_play_range(p.proposed_starts_at, p.format)
            && public.auto_match_play_range(v_proposal.proposed_starts_at, v_proposal.format)
    loop
      update public.auto_match_proposal_members
      set response = 'declined', response_reason = 'schedule_conflict',
          responded_at = now(), confirmed_at = null
      where proposal_id = v_overlap.id and user_id = auth.uid() and response = 'pending';
      perform public.process_auto_match_member_exit(v_overlap.id);
    end loop;

    select
      count(*) filter (where response = 'accepted'),
      count(*) filter (where response = 'pending')
    into v_accepted, v_pending
    from public.auto_match_proposal_members
    where proposal_id = p_proposal_id;

    if v_accepted >= v_required then
      if v_proposal.status = 'collecting' then
        update public.auto_match_proposals
        set status = 'ready', updated_at = now()
        where id = p_proposal_id and status = 'collecting';
      end if;
      perform public.resolve_auto_match_full_cupo(p_proposal_id);
    elsif v_required - v_accepted <= 2 and v_pending > 0 then
      perform public.enqueue_auto_match_notification(
        p_proposal_id,
        'auto_match_almost_full',
        'Faltan muy pocos',
        format('Faltan %s confirmaciones para completar el partido.', v_required - v_accepted),
        null,
        format('almost_full:%s', v_required - v_accepted),
        null
      );
    end if;
    return v_member;
  end if;

  update public.auto_match_proposal_members
  set response = 'declined', response_reason = 'user_declined',
      responded_at = now(), confirmed_at = null
  where proposal_id = p_proposal_id and user_id = auth.uid()
  returning * into v_member;

  perform public.process_auto_match_member_exit(p_proposal_id);
  return v_member;
end;
$$;

revoke all on function public.respond_to_auto_match_proposal(bigint,text,boolean) from public, anon;
grant execute on function public.respond_to_auto_match_proposal(bigint,text,boolean) to authenticated;

commit;
