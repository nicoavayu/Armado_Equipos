begin;

-- ==========================================================================
-- Partido automatico: snapshots inmutables, reconciliacion geografica y
-- respuestas concurrentes con orden de locks determinista.
-- ==========================================================================

alter table public.auto_match_proposal_members
  add column if not exists response_reason text,
  add column if not exists source_availability_id bigint,
  add column if not exists snapshot_latitude double precision,
  add column if not exists snapshot_longitude double precision,
  add column if not exists snapshot_max_distance_km integer,
  add column if not exists snapshot_days_of_week smallint[],
  add column if not exists snapshot_time_start time,
  add column if not exists snapshot_time_end time,
  add column if not exists snapshot_timezone text,
  add column if not exists snapshot_formats text[],
  add column if not exists snapshot_complete boolean,
  add column if not exists snapshot_taken_at timestamptz;

-- Las filas historicas aun conservan la disponibilidad que origino la
-- invitacion. Se copia exactamente lo que existe; si falta una fuente, la
-- migracion aborta en vez de inventar coordenadas o ventanas.
update public.auto_match_proposal_members m
set source_availability_id = a.id,
    snapshot_latitude = a.latitude,
    snapshot_longitude = a.longitude,
    snapshot_max_distance_km = a.max_distance_km,
    snapshot_days_of_week = a.days_of_week,
    snapshot_time_start = a.time_start,
    snapshot_time_end = a.time_end,
    snapshot_timezone = a.timezone,
    snapshot_formats = a.formats,
    snapshot_complete = public.auto_match_has_valid_coordinates(a.latitude, a.longitude),
    snapshot_taken_at = now()
from public.player_availability a
where a.id = m.availability_id
  and m.snapshot_taken_at is null;

do $$
begin
  if exists (
    select 1
    from public.auto_match_proposal_members m
    where m.source_availability_id is null
       or m.snapshot_max_distance_km is null
       or m.snapshot_days_of_week is null
       or m.snapshot_time_start is null
       or m.snapshot_time_end is null
       or m.snapshot_timezone is null
       or m.snapshot_formats is null
       or m.snapshot_complete is null
       or m.snapshot_taken_at is null
  ) then
    raise exception 'auto_match_snapshot_backfill_incomplete';
  end if;

  -- No se fabrican coordenadas para invitaciones historicas. Un snapshot
  -- incompleto solo puede sobrevivir si la propuesta ya fue materializada o
  -- cerrada; una gestacion viva debe poder reconciliarse con datos completos.
  if exists (
    select 1
    from public.auto_match_proposal_members m
    join public.auto_match_proposals p on p.id = m.proposal_id
    where not m.snapshot_complete
      and p.status in ('collecting', 'ready')
      and p.expires_at > now()
  ) then
    raise exception 'active_auto_match_snapshot_backfill_incomplete';
  end if;
end;
$$;

alter table public.auto_match_proposal_members
  alter column availability_id drop not null,
  alter column source_availability_id set not null,
  alter column snapshot_max_distance_km set not null,
  alter column snapshot_days_of_week set not null,
  alter column snapshot_time_start set not null,
  alter column snapshot_time_end set not null,
  alter column snapshot_timezone set not null,
  alter column snapshot_formats set not null,
  alter column snapshot_complete set not null,
  alter column snapshot_taken_at set not null;

-- El FK queda solamente para auditoria mientras exista la busqueda. Borrar una
-- disponibilidad pone el FK en NULL, pero source_availability_id y el snapshot
-- permanecen y la membresia no se elimina.
alter table public.auto_match_proposal_members
  drop constraint if exists auto_match_proposal_members_availability_id_fkey;
alter table public.auto_match_proposal_members
  add constraint auto_match_proposal_members_availability_id_fkey
  foreign key (availability_id) references public.player_availability(id)
  on delete set null;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'auto_match_member_response_reason_check'
      and conrelid = 'public.auto_match_proposal_members'::regclass
  ) then
    alter table public.auto_match_proposal_members
      drop constraint auto_match_member_response_reason_check;
  end if;
  alter table public.auto_match_proposal_members
    add constraint auto_match_member_response_reason_check
    check (response_reason is null or response_reason in (
      'user_declined', 'schedule_conflict', 'invite_expired',
      'availability_ineligible', 'account_ineligible',
      'geographic_incompatibility'
    ));

  if not exists (
    select 1 from pg_constraint
    where conname = 'auto_match_member_snapshot_shape_check'
      and conrelid = 'public.auto_match_proposal_members'::regclass
  ) then
    alter table public.auto_match_proposal_members
      add constraint auto_match_member_snapshot_shape_check check (
        snapshot_max_distance_km between 1 and 50
        and snapshot_complete = public.auto_match_has_valid_coordinates(
          snapshot_latitude, snapshot_longitude
        )
        and cardinality(snapshot_days_of_week) between 1 and 7
        and snapshot_days_of_week <@ array[1,2,3,4,5,6,7]::smallint[]
        and snapshot_time_end > snapshot_time_start
        and cardinality(snapshot_formats) > 0
        and snapshot_formats <@ array['F5','F6','F7','F8','F9','F11']::text[]
      );
  end if;
end;
$$;

-- La migracion anterior del mismo PR nunca llego a produccion. Se elimina su
-- estrategia de re-vincular: re-guardar una busqueda no debe mutar una
-- invitacion ya creada.
drop trigger if exists rebind_auto_match_memberships_after_availability_insert
  on public.player_availability;
drop function if exists public.rebind_auto_match_memberships_after_availability_insert();

-- Se suspende la defensa vieja durante la reconciliacion. Se reinstala al final
-- usando snapshots, no player_availability mutable.
drop trigger if exists enforce_auto_match_member_eligibility_trigger
  on public.auto_match_proposal_members;

-- Duracion canonica aprobada: 120 minutos. Los rangos semiabiertos permiten
-- partidos consecutivos (20:00-22:00 y 22:00-00:00).
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

-- Regla geografica unica y simetrica:
-- distancia(A,B) <= least(radio_A, radio_B).
create or replace function public.auto_match_snapshots_are_compatible(
  p_latitude_a double precision,
  p_longitude_a double precision,
  p_radius_a integer,
  p_latitude_b double precision,
  p_longitude_b double precision,
  p_radius_b integer
)
returns boolean
language sql
immutable
set search_path = public
as $$
  select public.auto_match_has_valid_coordinates(p_latitude_a, p_longitude_a)
    and public.auto_match_has_valid_coordinates(p_latitude_b, p_longitude_b)
    and p_radius_a between 1 and 50
    and p_radius_b between 1 and 50
    and public.auto_match_distance_km(
      p_latitude_a, p_longitude_a, p_latitude_b, p_longitude_b
    ) <= least(p_radius_a, p_radius_b);
$$;

-- Esta funcion se conserva para seleccionar una clique antes de crear una sala.
-- Solo las filas activas y elegibles pueden originar invitaciones nuevas.
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
      and public.auto_match_snapshots_are_compatible(
        a.latitude, a.longitude, a.max_distance_km,
        b.latitude, b.longitude, b.max_distance_km
      )
  );
$$;

create or replace function public.auto_match_member_snapshots_are_compatible(
  p_proposal_id bigint,
  p_user_a uuid,
  p_user_b uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.auto_match_proposal_members a
    join public.auto_match_proposal_members b
      on b.proposal_id = a.proposal_id and b.user_id = p_user_b
    where a.proposal_id = p_proposal_id
      and a.user_id = p_user_a
      and public.auto_match_snapshots_are_compatible(
        a.snapshot_latitude, a.snapshot_longitude, a.snapshot_max_distance_km,
        b.snapshot_latitude, b.snapshot_longitude, b.snapshot_max_distance_km
      )
  );
$$;

-- Valida solamente el snapshot propio contra el slot. Es util durante la
-- reconciliacion, cuando los pending incompatibles aun no fueron retirados.
create or replace function public.auto_match_member_snapshot_is_valid_for_proposal(
  p_proposal_id bigint,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.auto_match_proposal_members m
    join public.auto_match_proposals p on p.id = m.proposal_id
    where m.proposal_id = p_proposal_id
      and m.user_id = p_user_id
      and public.auto_match_account_is_eligible(m.user_id)
      and public.auto_match_has_valid_coordinates(m.snapshot_latitude, m.snapshot_longitude)
      and m.snapshot_max_distance_km between 1 and 50
      and p.format = any(m.snapshot_formats)
      and extract(isodow from (p.proposed_starts_at at time zone m.snapshot_timezone))::smallint
          = any(m.snapshot_days_of_week)
      and (p.proposed_starts_at at time zone m.snapshot_timezone)::time >= m.snapshot_time_start
      and m.snapshot_time_end
          - (p.proposed_starts_at at time zone m.snapshot_timezone)::time >= interval '60 minutes'
  );
$$;

-- Candidato nuevo: usa su disponibilidad viva solamente para crear SU snapshot
-- y la compara con los snapshots congelados de todos los miembros vivos.
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
      and extract(isodow from (p.proposed_starts_at at time zone a.timezone))::smallint
          = any(a.days_of_week)
      and (p.proposed_starts_at at time zone a.timezone)::time >= a.time_start
      and a.time_end - (p.proposed_starts_at at time zone a.timezone)::time >= interval '60 minutes'
      and not exists (
        select 1
        from public.auto_match_proposal_members m
        where m.proposal_id = p.id
          and m.user_id <> a.user_id
          and m.response not in ('declined', 'expired', 'waitlisted')
          and not public.auto_match_snapshots_are_compatible(
            a.latitude, a.longitude, a.max_distance_km,
            m.snapshot_latitude, m.snapshot_longitude, m.snapshot_max_distance_km
          )
      )
  );
$$;

-- Miembro existente: toda la decision se toma con su snapshot, incluso si la
-- disponibilidad original fue cancelada, reemplazada o eliminada.
create or replace function public.auto_match_member_snapshot_fits_proposal(
  p_proposal_id bigint,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select public.auto_match_member_snapshot_is_valid_for_proposal(p_proposal_id, p_user_id)
    and not exists (
      select 1
      from public.auto_match_proposal_members mine
      join public.auto_match_proposal_members other
        on other.proposal_id = mine.proposal_id
       and other.user_id <> mine.user_id
       and other.response not in ('declined', 'expired', 'waitlisted')
      where mine.proposal_id = p_proposal_id
        and mine.user_id = p_user_id
        and not public.auto_match_snapshots_are_compatible(
          mine.snapshot_latitude, mine.snapshot_longitude, mine.snapshot_max_distance_km,
          other.snapshot_latitude, other.snapshot_longitude, other.snapshot_max_distance_km
        )
    );
$$;

-- Todo INSERT de membresia toma el snapshot en el mismo statement. Los callers
-- existentes no necesitan repetir columnas y ningun backfill puede olvidarlas.
create or replace function public.capture_auto_match_member_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_availability public.player_availability;
begin
  if new.availability_id is null then
    raise exception 'auto_match_snapshot_source_required';
  end if;

  select * into v_availability
  from public.player_availability
  where id = new.availability_id;

  if v_availability.id is null or v_availability.user_id <> new.user_id then
    raise exception 'auto_match_snapshot_source_invalid';
  end if;

  new.source_availability_id := v_availability.id;
  new.snapshot_latitude := v_availability.latitude;
  new.snapshot_longitude := v_availability.longitude;
  new.snapshot_max_distance_km := v_availability.max_distance_km;
  new.snapshot_days_of_week := v_availability.days_of_week;
  new.snapshot_time_start := v_availability.time_start;
  new.snapshot_time_end := v_availability.time_end;
  new.snapshot_timezone := v_availability.timezone;
  new.snapshot_formats := v_availability.formats;
  new.snapshot_complete := public.auto_match_has_valid_coordinates(
    v_availability.latitude, v_availability.longitude
  );
  new.snapshot_taken_at := now();
  return new;
end;
$$;

drop trigger if exists auto_match_member_snapshot_capture_trigger
  on public.auto_match_proposal_members;
create trigger auto_match_member_snapshot_capture_trigger
before insert on public.auto_match_proposal_members
for each row execute function public.capture_auto_match_member_snapshot();

create or replace function public.prevent_auto_match_member_snapshot_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'auto_match_snapshot_is_immutable';
end;
$$;

drop trigger if exists auto_match_member_snapshot_immutable_trigger
  on public.auto_match_proposal_members;
create trigger auto_match_member_snapshot_immutable_trigger
before update of source_availability_id, snapshot_latitude, snapshot_longitude,
  snapshot_max_distance_km, snapshot_days_of_week, snapshot_time_start,
  snapshot_time_end, snapshot_timezone, snapshot_formats, snapshot_complete,
  snapshot_taken_at
on public.auto_match_proposal_members
for each row execute function public.prevent_auto_match_member_snapshot_update();

-- Conflicto real de agenda: 120 minutos, sin depender del formato ni de la
-- disponibilidad que origino la invitacion.
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

-- Reemplazos: candidato vivo + horario + auth + compatibilidad contra TODOS los
-- snapshots conservados. El trigger captura su snapshot al insertar.
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
        select 1 from public.auto_match_proposal_members m
        where m.proposal_id = p_proposal_id and m.user_id = a.user_id
      )
      and not public.user_has_overlapping_auto_match(
        a.user_id, v_proposal.proposed_starts_at, p_proposal_id
      )
      and not public.user_declined_auto_match_slot(
        a.user_id, v_proposal.format, v_proposal.proposed_starts_at
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

-- Regla general de reparacion in-place:
--   * accepted elegibles = nucleo prioritario (nunca los expulsa un pending),
--   * una confirmacion degradada automaticamente se restaura con evidencia
--     durable (confirmed_at presente, sin motivo de salida explicita),
--   * pending se evalua en orden estable contra el nucleo y los pending ya
--     conservados; el incompatible se expira sin cancelar la sala,
--   * al final se ejecuta el backfill compatible existente.
create or replace function public.reconcile_auto_match_proposal_members(
  p_proposal_id bigint
)
returns table (
  restored_count integer,
  removed_count integer,
  backfilled_count integer
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_proposal public.auto_match_proposals;
  v_member record;
  v_reason text;
begin
  restored_count := 0;
  removed_count := 0;
  backfilled_count := 0;

  select * into v_proposal
  from public.auto_match_proposals
  where id = p_proposal_id
  for update;

  if v_proposal.id is null
     or v_proposal.status not in ('collecting', 'ready')
     or v_proposal.expires_at <= now() then
    return next;
    return;
  end if;

  create temporary table if not exists tmp_auto_match_reconcile_keep (
    user_id uuid primary key
  ) on commit drop;
  truncate tmp_auto_match_reconcile_keep;

  -- Auth se consulta en tiempo real. Una cuenta borrada/suspendida no forma
  -- parte del nucleo aunque su snapshot siga siendo valido.
  update public.auto_match_proposal_members m
  set response = 'expired',
      response_reason = 'account_ineligible',
      responded_at = now(),
      confirmed_at = null,
      invite_expires_at = null
  where m.proposal_id = p_proposal_id
    and m.response in ('pending', 'accepted')
    and not public.auto_match_account_is_eligible(m.user_id);
  get diagnostics removed_count = row_count;

  -- Restauracion segura de confirmaciones que un barrido automatico degrado.
  -- Rechazo/abandono explicito limpia confirmed_at, por eso no entra aqui.
  for v_member in
    select m.user_id
    from public.auto_match_proposal_members m
    where m.proposal_id = p_proposal_id
      and m.response = 'expired'
      and m.confirmed_at is not null
      and m.response_reason is null
      and public.auto_match_member_snapshot_is_valid_for_proposal(p_proposal_id, m.user_id)
      and not public.user_has_overlapping_auto_match(
        m.user_id, v_proposal.proposed_starts_at, p_proposal_id
      )
      and not exists (
        select 1
        from public.auto_match_proposal_members core
        where core.proposal_id = p_proposal_id
          and core.response = 'accepted'
          and core.user_id <> m.user_id
          and not public.auto_match_member_snapshots_are_compatible(
            p_proposal_id, m.user_id, core.user_id
          )
      )
    order by m.confirmed_at, m.created_at, m.user_id
  loop
    update public.auto_match_proposal_members
    set response = 'accepted',
        response_reason = null,
        responded_at = coalesce(responded_at, confirmed_at),
        invite_expires_at = null
    where proposal_id = p_proposal_id
      and user_id = v_member.user_id
      and response = 'expired'
      and confirmed_at is not null
      and response_reason is null;
    if found then restored_count := restored_count + 1; end if;
  end loop;

  insert into tmp_auto_match_reconcile_keep(user_id)
  select m.user_id
  from public.auto_match_proposal_members m
  where m.proposal_id = p_proposal_id and m.response = 'accepted'
  on conflict do nothing;

  -- Greedy estable: accepted siempre gana; pending solo se conserva si es
  -- compatible con todo lo ya conservado.
  for v_member in
    select m.user_id
    from public.auto_match_proposal_members m
    where m.proposal_id = p_proposal_id and m.response = 'pending'
    order by m.created_at, m.user_id
  loop
    v_reason := null;

    if not public.auto_match_member_snapshot_is_valid_for_proposal(
      p_proposal_id, v_member.user_id
    ) then
      v_reason := 'availability_ineligible';
    elsif exists (
      select 1
      from tmp_auto_match_reconcile_keep kept
      where not public.auto_match_member_snapshots_are_compatible(
        p_proposal_id, v_member.user_id, kept.user_id
      )
    ) then
      v_reason := 'geographic_incompatibility';
    end if;

    if v_reason is null then
      insert into tmp_auto_match_reconcile_keep(user_id)
      values (v_member.user_id)
      on conflict do nothing;
    else
      update public.auto_match_proposal_members
      set response = 'expired',
          response_reason = v_reason,
          responded_at = now(),
          confirmed_at = null,
          invite_expires_at = null
      where proposal_id = p_proposal_id
        and user_id = v_member.user_id
        and response = 'pending';
      if found then removed_count := removed_count + 1; end if;
    end if;
  end loop;

  backfilled_count := public.backfill_auto_match_proposal_members(p_proposal_id);
  return next;
end;
$$;

-- Reconciliacion idempotente de todas las salas vigentes. No hay UPDATE por id
-- hardcodeado: la forma concreta de #5 cae naturalmente en la regla anterior.
do $$
declare
  v_row record;
begin
  for v_row in
    select p.id
    from public.auto_match_proposals p
    where p.status in ('collecting', 'ready')
      and p.expires_at > now()
    order by p.id
  loop
    perform * from public.reconcile_auto_match_proposal_members(v_row.id);
  end loop;
end;
$$;

-- Defensa transversal para creacion, cohortes, invitaciones, reemplazos,
-- backfill y reactivaciones de lista de espera.
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

  -- Re-ejecutar la reconciliacion despues de aplicada la migracion sigue siendo
  -- idempotente. La unica restauracion permitida conserva confirmed_at, no tiene
  -- motivo explicito y debe ser compatible con todo el nucleo accepted. Los
  -- pending se depuran inmediatamente despues por la regla determinista.
  if old.response = 'expired'
     and new.response = 'accepted'
     and old.confirmed_at is not null
     and old.response_reason is null
     and public.auto_match_member_snapshot_is_valid_for_proposal(
       new.proposal_id, new.user_id
     )
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

create trigger enforce_auto_match_member_eligibility_trigger
before insert or update of response, availability_id
on public.auto_match_proposal_members
for each row execute function public.enforce_auto_match_member_eligibility();

-- Una baja libera solo esa membresia; nunca cancela toda la gestacion ni emite
-- una cancelacion falsa. El backfill usa snapshots y compatibilidad simetrica.
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

-- Una busqueda cancelada/reemplazada/eliminada no expira snapshots. Solo auth
-- real puede retirar automaticamente accepted/pending existentes.
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
    and not public.auto_match_account_is_eligible(m.user_id)
  on conflict do nothing;

  update public.auto_match_proposal_members m
  set response = 'expired',
      response_reason = 'account_ineligible',
      responded_at = now(),
      confirmed_at = null,
      invite_expires_at = null
  from public.auto_match_proposals p
  where p.id = m.proposal_id
    and (
      (p.status in ('collecting', 'ready') and m.response in ('pending', 'accepted'))
      or (p.status = 'created' and m.response = 'pending')
    )
    and not public.auto_match_account_is_eligible(m.user_id);
  get diagnostics v_pruned = row_count;

  for v_row in select proposal_id from tmp_pruned_auto_match_proposals order by proposal_id loop
    perform public.process_auto_match_member_exit(v_row.proposal_id);
  end loop;
  return v_pruned;
end;
$$;

-- Respuesta atomica. Antes de modificar cualquier sala reune TODAS las
-- propuestas superpuestas que puede tocar y bloquea sus filas por id ascendente.
-- Dos respuestas cruzadas toman P1,P2 en el mismo orden y no pueden deadlockear.
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
  v_lock record;
  v_overlap record;
  v_geo_incompatible boolean;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_response not in ('accepted','declined') then raise exception 'invalid_response'; end if;

  perform pg_advisory_xact_lock(hashtext('auto_match_response:' || auth.uid()::text));

  -- Lectura preliminar sin lock: solo define el conjunto conservador de filas a
  -- bloquear. El estado se relee despues de obtener todos los locks.
  select * into v_proposal
  from public.auto_match_proposals
  where id = p_proposal_id;
  if v_proposal.id is null then raise exception 'proposal_not_found'; end if;

  create temporary table if not exists tmp_auto_match_response_proposal_locks (
    proposal_id bigint primary key
  ) on commit drop;
  truncate tmp_auto_match_response_proposal_locks;
  insert into tmp_auto_match_response_proposal_locks values (p_proposal_id)
  on conflict do nothing;

  if p_response = 'accepted' then
    insert into tmp_auto_match_response_proposal_locks(proposal_id)
    select distinct p.id
    from public.auto_match_proposal_members m
    join public.auto_match_proposals p on p.id = m.proposal_id
    where m.user_id = auth.uid()
      and m.response in ('pending', 'accepted')
      and p.status in ('collecting', 'ready')
      and p.expires_at > now()
      and public.auto_match_play_range(p.proposed_starts_at, p.format)
          && public.auto_match_play_range(v_proposal.proposed_starts_at, v_proposal.format)
    on conflict do nothing;
  end if;

  for v_lock in
    select p.id
    from public.auto_match_proposals p
    join tmp_auto_match_response_proposal_locks l on l.proposal_id = p.id
    order by p.id
    for update of p
  loop
    null;
  end loop;

  select * into v_proposal
  from public.auto_match_proposals
  where id = p_proposal_id;

  select * into v_member
  from public.auto_match_proposal_members
  where proposal_id = p_proposal_id and user_id = auth.uid()
  for update;
  if v_member.proposal_id is null then raise exception 'proposal_member_not_found'; end if;

  -- Retry idempotente, incluso si la propuesta cambio despues del commit.
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

  -- Una reconciliacion geografica debe poder persistir y a la vez comunicar una
  -- causa de producto. Se devuelve la fila; el cliente la traduce y refresca.
  if v_member.response = 'expired'
     and v_member.response_reason = 'geographic_incompatibility' then
    return v_member;
  end if;
  if v_member.response = 'declined' then raise exception 'proposal_member_declined'; end if;
  if v_member.response = 'expired' then raise exception 'proposal_member_expired'; end if;
  if v_member.response = 'waitlisted' then raise exception 'proposal_member_waitlisted'; end if;
  if v_proposal.status not in ('collecting', 'ready') or v_proposal.expires_at <= now() then
    raise exception 'proposal_not_open';
  end if;
  if v_member.invite_expires_at is not null and v_member.invite_expires_at <= now() then
    raise exception 'proposal_member_expired';
  end if;

  v_required := v_proposal.max_players;

  if p_response = 'accepted' then
    select exists (
      select 1
      from public.auto_match_proposal_members other
      where other.proposal_id = p_proposal_id
        and other.user_id <> auth.uid()
        and other.response not in ('declined', 'expired', 'waitlisted')
        and not public.auto_match_member_snapshots_are_compatible(
          p_proposal_id, auth.uid(), other.user_id
        )
    ) into v_geo_incompatible;

    if v_geo_incompatible
       or not public.auto_match_member_snapshot_is_valid_for_proposal(
         p_proposal_id, auth.uid()
       ) then
      update public.auto_match_proposal_members
      set response = 'expired',
          response_reason = case
            when v_geo_incompatible then 'geographic_incompatibility'
            when not public.auto_match_account_is_eligible(auth.uid()) then 'account_ineligible'
            else 'availability_ineligible'
          end,
          responded_at = now(),
          confirmed_at = null,
          invite_expires_at = null
      where proposal_id = p_proposal_id and user_id = auth.uid()
      returning * into v_member;
      perform public.backfill_auto_match_proposal_members(p_proposal_id);
      return v_member;
    end if;

    if public.user_has_overlapping_auto_match(
      auth.uid(), v_proposal.proposed_starts_at, p_proposal_id
    ) then
      raise exception 'proposal_schedule_conflict';
    end if;

    select count(*) into v_accepted
    from public.auto_match_proposal_members
    where proposal_id = p_proposal_id and response = 'accepted';
    if v_accepted >= public.auto_match_invitation_capacity(v_proposal.format) then
      raise exception 'proposal_full';
    end if;

    update public.auto_match_proposal_members
    set response = 'accepted',
        response_reason = null,
        can_organize = can_organize or coalesce(p_can_organize, false),
        confirmed_at = coalesce(confirmed_at, now()),
        responded_at = coalesce(responded_at, now())
    where proposal_id = p_proposal_id and user_id = auth.uid()
    returning * into v_member;

    -- Todas estas propuestas ya estan bloqueadas en orden ascendente.
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
      order by p.id
    loop
      update public.auto_match_proposal_members
      set response = 'declined',
          response_reason = 'schedule_conflict',
          responded_at = now(),
          confirmed_at = null
      where proposal_id = v_overlap.id
        and user_id = auth.uid()
        and response = 'pending';
      if found then
        perform public.process_auto_match_member_exit(v_overlap.id);
      end if;
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
  set response = 'declined',
      response_reason = 'user_declined',
      responded_at = now(),
      confirmed_at = null
  where proposal_id = p_proposal_id and user_id = auth.uid()
  returning * into v_member;

  perform public.process_auto_match_member_exit(p_proposal_id);
  return v_member;
end;
$$;

-- Funciones internas: sin EXECUTE para clientes. RPC publico: solo authenticated.
revoke all on function public.auto_match_duration(text) from public, anon, authenticated, service_role;
revoke all on function public.auto_match_play_range(timestamptz,text) from public, anon, authenticated, service_role;
revoke all on function public.auto_match_snapshots_are_compatible(double precision,double precision,integer,double precision,double precision,integer) from public, anon, authenticated, service_role;
revoke all on function public.auto_match_availabilities_are_compatible(bigint,bigint) from public, anon, authenticated, service_role;
revoke all on function public.auto_match_member_snapshots_are_compatible(bigint,uuid,uuid) from public, anon, authenticated, service_role;
revoke all on function public.auto_match_member_snapshot_is_valid_for_proposal(bigint,uuid) from public, anon, authenticated, service_role;
revoke all on function public.auto_match_availability_fits_proposal(bigint,bigint) from public, anon, authenticated, service_role;
revoke all on function public.auto_match_member_snapshot_fits_proposal(bigint,uuid) from public, anon, authenticated, service_role;
revoke all on function public.capture_auto_match_member_snapshot() from public, anon, authenticated, service_role;
revoke all on function public.prevent_auto_match_member_snapshot_update() from public, anon, authenticated, service_role;
revoke all on function public.user_declined_auto_match_slot(uuid,text,timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.user_has_overlapping_auto_match(uuid,timestamptz,bigint) from public, anon, authenticated, service_role;
revoke all on function public.backfill_auto_match_proposal_members(bigint) from public, anon, authenticated, service_role;
revoke all on function public.reconcile_auto_match_proposal_members(bigint) from public, anon, authenticated, service_role;
revoke all on function public.enforce_auto_match_member_eligibility() from public, anon, authenticated, service_role;
revoke all on function public.process_auto_match_member_exit(bigint) from public, anon, authenticated, service_role;
revoke all on function public.prune_ineligible_auto_match_members() from public, anon, authenticated, service_role;
revoke all on function public.respond_to_auto_match_proposal(bigint,text,boolean) from public, anon;
grant execute on function public.respond_to_auto_match_proposal(bigint,text,boolean) to authenticated;

commit;
