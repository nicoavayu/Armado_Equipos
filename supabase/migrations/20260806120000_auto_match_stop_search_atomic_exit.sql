begin;

-- ==========================================================================
-- Partido automatico — "Dejar de buscar" deja de ser una baja a medias, y
-- deja de depender de una ventana de tiempo.
--
-- Sintoma original: cancel_my_availability() solo marcaba player_availability
-- como 'cancelled'. Las membresias del jugador en propuestas vivas quedaban
-- 'pending'/'accepted', asi que seguia ocupando cupo, seguia figurando en el
-- roster, conservaba el chat y sus cards no desaparecian de la interfaz.
--
-- Segundo defecto (corregido en esta version): la primera implementacion
-- reintentaba "hasta tres pasadas" para atrapar un backfill concurrente. Eso
-- NO cerraba la carrera. Bajo READ COMMITTED, un backfill que ya inserto pero
-- todavia no comiteo es INVISIBLE para la cancelacion: las tres pasadas
-- corren dentro de la misma transaccion y ninguna lo ve. El orden
--
--   B: insert (sin commit)  →  C: cancela, no ve nada, commitea  →  B: commit
--
-- dejaba una membresia 'pending' viva de alguien con la busqueda apagada.
--
-- ==========================================================================
-- GARANTIA (no probabilistica)
-- ==========================================================================
--
-- Se introduce un unico punto de estrangulamiento: el trigger BEFORE
-- INSERT/UPDATE de auto_match_proposal_members. TODA alta o reactivacion de
-- una membresia ACTIVA ('pending'/'accepted') pasa obligatoriamente por ahi,
-- venga de donde venga (backfill, cohortes, sincronizacion de gestaciones,
-- reconciliacion, suplentes, materializacion, barrido de pg_cron o SQL
-- manual). El trigger exige dos cosas:
--
--   (a) que la transaccion RETENGA el advisory lock por usuario —el mismo
--       que toman cancel y el matcher— durante todo el resto de la
--       transaccion. Se toma con pg_try_advisory_xact_lock: si otra
--       transaccion lo tiene, la fila NO se inserta (return null). Nunca
--       espera, asi que no agrega ninguna arista de espera al grafo de locks
--       y no puede introducir deadlocks;
--
--   (b) revalidacion BAJO ese lock contra la version VIVA de la fila de
--       player_availability (select ... for share), no contra el snapshot del
--       statement.
--
-- Con eso, "insertar" y "cancelar" quedan estrictamente serializados sobre el
-- lock del usuario, y las dos ordenes posibles son ambas correctas:
--
--   * Insert primero: retiene el lock hasta commitear, asi que la cancelacion
--     que venga despues espera, y al escanear YA VE la fila comiteada y la
--     retira. Resultado: sin membresia activa.
--   * Cancel primero: retiene el lock hasta commitear, asi que el try-lock
--     del insert falla (se descarta) o, si ya solto el lock, la revalidacion
--     for-share lee la version viva 'cancelled' y descarta igual.
--
-- No queda ninguna ventana intermedia. Por eso la estrategia de "hasta tres
-- pasadas" se ELIMINA: cancel_my_availability hace una sola pasada.
--
-- Orden global de locks (para que no aparezcan deadlocks nuevos):
--   advisory(usuario)  →  fila de player_availability  →  fila de
--   auto_match_proposals
-- Solo cancel_my_availability, sync_my_auto_match_gestations,
-- upsert_my_availability y sync_my_auto_match_location_from_profile ESPERAN
-- por el advisory lock, y las cuatro lo toman como su PRIMER lock (no
-- retienen nada mientras esperan), asi que no pueden cerrar un ciclo. Todos
-- los demas caminos usan try-lock y nunca esperan.
--
-- ==========================================================================
-- CONTRATO DE LOS RPC
-- ==========================================================================
--
-- public.cancel_my_availability() CONSERVA su firma publica exacta
-- (sin argumentos, returns void). No hay DROP FUNCTION: los clientes de iOS,
-- Android y web ya publicados siguen ejecutando el mismo contrato y ademas
-- reciben la correccion completa. Los contadores viven en un RPC NUEVO,
-- public.cancel_my_availability_detailed(), que solo usan los clientes que
-- saben pedirlo, y el trabajo real esta en una funcion interna compartida.
--
-- Es aditiva: no crea ni altera tablas, columnas, indices, constraints, RLS
-- ni el cron auto_match_sweep, y no modifica datos historicos. No ejecuta
-- ninguna limpieza (el dry-run vive fuera de la base, como SQL de solo
-- lectura en scripts/db-readonly/).
-- ==========================================================================


-- ---------------------------------------------------------------------------
-- 1. Primitivas del lock por usuario y revalidacion bajo lock.
-- ---------------------------------------------------------------------------

-- Clave canonica. Es EXACTAMENTE la expresion que sync_my_auto_match_gestations
-- viene usando desde 20260713120000: hashtext devuelve int4 y
-- pg_advisory_xact_lock(bigint) recibe el mismo valor tras la promocion
-- implicita, asi que ambos comparten espacio de locks. Hay un test que lo
-- verifica contra la expresion literal para que no se separen nunca.
create or replace function public.auto_match_user_lock_key(p_user_id uuid)
returns bigint
language sql
immutable
set search_path = public
as $$
  select hashtext('auto_match_sync:' || p_user_id::text)::bigint;
$$;

-- Adquisicion BLOQUEANTE. Solo la usan los caminos que toman este lock como su
-- primer lock de la transaccion.
create or replace function public.auto_match_lock_user(p_user_id uuid)
returns void
language sql
set search_path = public
as $$
  select pg_advisory_xact_lock(public.auto_match_user_lock_key(p_user_id));
$$;

-- Adquisicion NO BLOQUEANTE. Devuelve true si la transaccion ya lo tenia o si
-- lo acaba de tomar; false si lo tiene otra transaccion. Reentrante: tomarlo
-- dos veces en la misma transaccion es gratis.
create or replace function public.auto_match_try_lock_user(p_user_id uuid)
returns boolean
language sql
set search_path = public
as $$
  select pg_try_advisory_xact_lock(public.auto_match_user_lock_key(p_user_id));
$$;

-- Revalidacion de UNA disponibilidad concreta contra su version VIVA.
--
-- La diferencia con auto_match_availability_is_eligible (que es STABLE y por
-- lo tanto lee el snapshot del statement que la invoca) es el "for share":
--   * bajo READ COMMITTED, PostgreSQL bloquea la ultima version comiteada y
--     reevalua el filtro contra ella (EvalPlanQual), asi que una cancelacion
--     comiteada despues del snapshot SI se ve;
--   * bajo REPEATABLE READ o SERIALIZABLE, aborta con serialization_failure
--     en lugar de leer una version obsoleta.
-- En los dos casos es imposible insertar sobre una disponibilidad ya cancelada.
create or replace function public.auto_match_availability_is_eligible_locked(
  p_availability_id bigint
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, auth
as $$
declare
  v_status text;
  v_user uuid;
  v_distance integer;
  v_latitude double precision;
  v_longitude double precision;
begin
  if p_availability_id is null then return false; end if;

  select a.status, a.user_id, a.max_distance_km, a.latitude, a.longitude
    into v_status, v_user, v_distance, v_latitude, v_longitude
  from public.player_availability a
  where a.id = p_availability_id
  for share;

  if v_user is null then return false; end if;

  return v_status = 'active'
     and v_distance between 1 and 50
     and public.auto_match_has_valid_coordinates(v_latitude, v_longitude)
     and public.auto_match_account_is_eligible(v_user);
end;
$$;

-- Mismo criterio pero por USUARIO: lo usan las reactivaciones, donde la
-- availability_id guardada en la membresia puede apuntar a una busqueda ya
-- reemplazada. Reactivar exige que el jugador tenga HOY una busqueda activa.
-- Reemplazar la busqueda (upsert_my_availability) deja uno activa, asi que ese
-- caso legitimo se sigue permitiendo; apagarla no.
create or replace function public.auto_match_user_search_is_active(p_user_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, auth
as $$
declare
  v_id bigint;
begin
  if p_user_id is null then return false; end if;

  select a.id into v_id
  from public.player_availability a
  where a.user_id = p_user_id and a.status = 'active'
  order by a.created_at desc, a.id desc
  limit 1
  for share;

  if v_id is null then return false; end if;
  return public.auto_match_availability_is_eligible_locked(v_id);
end;
$$;

revoke all on function public.auto_match_user_lock_key(uuid) from public, anon, authenticated;
revoke all on function public.auto_match_lock_user(uuid) from public, anon, authenticated;
revoke all on function public.auto_match_try_lock_user(uuid) from public, anon, authenticated;
revoke all on function public.auto_match_availability_is_eligible_locked(bigint) from public, anon, authenticated;
revoke all on function public.auto_match_user_search_is_active(uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 2. El trigger de elegibilidad pasa a ser el punto de estrangulamiento.
-- ---------------------------------------------------------------------------

-- Se conserva TODA la logica de 20260716120000 (regla A2 en el alta,
-- restauracion expired->accepted, compatibilidad de snapshots). Lo que se
-- agrega es el guardia del invariante, y solo sobre las dos transiciones que
-- "vuelven a agregar" a alguien:
--
--   * INSERT de una membresia activa;
--   * UPDATE que lleva una membresia de un estado terminal
--     ('declined' / 'expired' / 'waitlisted') a uno activo.
--
-- Un 'pending' -> 'accepted' NO es reactivacion: esa membresia ya estaba
-- activa, asi que una cancelacion previa la habria encontrado y retirado. Por
-- eso no se le pide el lock y respond_to_auto_match_proposal no cambia.
--
-- Las reactivaciones hechas por el PROPIO jugador (auth.uid() = user_id) estan
-- exentas: el invariante habla de procesos concurrentes que reincorporan a
-- alguien, no de una accion explicita del jugador sobre un partido ya creado
-- (por ejemplo aceptar una invitacion de suplente desde la lista de espera).
create or replace function public.enforce_auto_match_member_eligibility()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if new.response not in ('pending', 'accepted') then return new; end if;

  if tg_op = 'INSERT' then
    -- (a) Sin el lock del usuario retenido hasta el commit, esta fila no entra.
    -- try (no wait): si lo tiene una cancelacion en curso, se descarta el alta.
    if not public.auto_match_try_lock_user(new.user_id) then
      return null;
    end if;

    -- (b) Revalidacion contra la version viva, ya bajo el lock.
    if new.availability_id is not null
       and public.auto_match_availability_is_eligible_locked(new.availability_id)
       and public.auto_match_availability_fits_proposal(new.availability_id, new.proposal_id) then
      return new;
    end if;
    return null;
  end if;

  -- Reactivacion desde un estado terminal, hecha por un tercero o por el
  -- backend: mismo guardia.
  if old.response in ('declined', 'expired', 'waitlisted')
     and auth.uid() is distinct from new.user_id then
    if not public.auto_match_try_lock_user(new.user_id) then
      return null;
    end if;
    if not public.auto_match_user_search_is_active(new.user_id) then
      return null;
    end if;
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
-- 3. backfill: toma el lock explicitamente, ademas del guardia del trigger.
-- ---------------------------------------------------------------------------

-- Identica a 20260715003000 salvo por el bloque marcado. El trigger ya
-- garantizaria el invariante por si solo; tomarlo aca ademas hace que el
-- candidato se descarte ANTES de gastar el cupo del bucle y deja el motivo
-- explicito en el camino que la auditoria senalo por nombre.
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

    -- ---- Invariante ------------------------------------------------------
    -- La lista de candidatos se calculo con el snapshot del cursor. Antes de
    -- escribir, el candidato tiene que pasar por el lock por usuario y por la
    -- revalidacion contra la version viva de su disponibilidad. Si el lock lo
    -- tiene una cancelacion en curso, o si la disponibilidad ya no esta
    -- activa, se salta: reponer el lugar es trabajo del proximo barrido, no
    -- de un reintento dentro de esta transaccion.
    if not public.auto_match_try_lock_user(v_candidate.user_id) then
      continue;
    end if;
    if not public.auto_match_availability_is_eligible_locked(v_candidate.availability_id) then
      continue;
    end if;
    -- ----------------------------------------------------------------------

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
-- 4. Orden de locks: los otros dos escritores de player_availability.
-- ---------------------------------------------------------------------------

-- upsert_my_availability cancelaba la busqueda vieja e insertaba la nueva ANTES
-- de que sync_my_auto_match_gestations tomara el advisory lock. Eso dejaba la
-- secuencia "fila de player_availability -> advisory", inversa a la del resto y
-- suficiente para cerrar un ciclo con la revalidacion for-share del trigger.
-- Se mueve el lock al principio. El cuerpo no cambia en nada mas (identico a
-- 20260714030000), y sync lo vuelve a pedir de forma reentrante sin costo.
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

  -- Primer lock de la transaccion, antes de tocar player_availability.
  perform public.auto_match_lock_user(auth.uid());

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

-- Mismo movimiento, misma razon. Resto identico a 20260714030000.
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

  -- Primer lock de la transaccion, antes de tocar player_availability.
  perform public.auto_match_lock_user(auth.uid());

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
-- 5. Baja atomica de la busqueda.
-- ---------------------------------------------------------------------------

-- Nucleo compartido. Interno: ningun rol de cliente puede invocarlo. Se ejecuta
-- unicamente desde los dos wrappers SECURITY DEFINER de abajo, que corren como
-- el dueno de la funcion.
create or replace function public.auto_match_cancel_search()
returns table (
  availability_cancelled integer,
  gestation_memberships_released integer,
  created_invites_withdrawn integer,
  created_memberships_kept integer
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid;
  v_proposal public.auto_match_proposals;
  v_member public.auto_match_proposal_members;
  v_row record;
begin
  -- (1) Usuario autenticado. Sin sesion no hay nada que cancelar.
  v_uid := auth.uid();
  if v_uid is null then raise exception 'not_authenticated'; end if;

  availability_cancelled := 0;
  gestation_memberships_released := 0;
  created_invites_withdrawn := 0;
  created_memberships_kept := 0;

  -- (2) Primer lock de la transaccion: el mismo advisory lock por usuario que
  -- exige el trigger para insertar o reactivar una membresia activa. Desde
  -- aca hasta el commit, ninguna otra transaccion puede commitear un alta de
  -- este jugador; y si alguna ya la habia insertado sin commitear, retiene el
  -- lock, asi que este perform espera a que termine y el escaneo de (4) SI la
  -- ve. Esa es la razon por la que una sola pasada alcanza.
  perform public.auto_match_lock_user(v_uid);

  -- (3) La disponibilidad se cancela ANTES de tocar membresias: desde este
  -- punto la revalidacion for-share del trigger lee 'cancelled' aunque el
  -- statement que inserta haya empezado antes.
  update public.player_availability
     set status = 'cancelled', updated_at = now()
   where user_id = v_uid and status = 'active';
  get diagnostics availability_cancelled = row_count;

  -- (4) Membresias. UNA sola pasada: la exclusion mutua sobre el lock del
  -- usuario garantiza que no puede aparecer ninguna despues de este escaneo.
  -- Las propuestas se bloquean por id ascendente, el mismo orden determinista
  -- que usa respond_to_auto_match_proposal, para que dos operaciones cruzadas
  -- no puedan deadlockear. El estado autoritativo se vuelve a leer DESPUES de
  -- tomar el lock: si la propuesta paso a 'created' entre el escaneo y el
  -- lock, la frontera se aplica sobre el estado real.
  for v_row in
    select distinct m.proposal_id as id
    from public.auto_match_proposal_members m
    join public.auto_match_proposals p on p.id = m.proposal_id
    where m.user_id = v_uid
      and (
        (p.status in ('collecting', 'ready') and m.response in ('pending', 'accepted'))
        or (p.status = 'created' and m.response = 'pending')
      )
    order by 1
  loop
    select * into v_proposal
    from public.auto_match_proposals
    where id = v_row.id
    for update;
    if v_proposal.id is null then continue; end if;

    select * into v_member
    from public.auto_match_proposal_members
    where proposal_id = v_row.id and user_id = v_uid
    for update;
    if v_member.proposal_id is null then continue; end if;

    if v_proposal.status in ('collecting', 'ready')
       and v_member.response in ('pending', 'accepted') then
      -- Salida voluntaria: mismo estado terminal que "Esta vez no". El motivo
      -- 'user_declined' (y no 'schedule_conflict') es lo que impide que
      -- reconcile_auto_match_proposal_members la vuelva a poner pending.
      update public.auto_match_proposal_members
         set response = 'declined',
             response_reason = 'user_declined',
             responded_at = now(),
             confirmed_at = null,
             invite_expires_at = null
       where proposal_id = v_row.id and user_id = v_uid;

      gestation_memberships_released := gestation_memberships_released + 1;

      -- (5) Logica existente de salida: suelta la organizacion si era suya,
      -- reconvoca reemplazos y devuelve ready->collecting si hace falta.
      -- El backfill que dispara no puede volver a tomar a este jugador: la
      -- fila ya existe (declined) y su disponibilidad ya esta cancelada.
      perform public.process_auto_match_member_exit(v_row.id);

    elsif v_proposal.status = 'created' and v_member.response = 'pending' then
      -- Invitacion de suplente sobre un partido ya materializado: se retira.
      -- confirmed_at en NULL la deja fuera del camino de restauracion
      -- expired->accepted de reconcile / del trigger de elegibilidad.
      update public.auto_match_proposal_members
         set response = 'expired',
             response_reason = 'invite_expired',
             responded_at = now(),
             confirmed_at = null,
             invite_expires_at = null
       where proposal_id = v_row.id and user_id = v_uid;

      created_invites_withdrawn := created_invites_withdrawn + 1;
    end if;
  end loop;

  -- (6) Los accepted de propuestas ya materializadas quedan intactos: el
  -- jugador ya pertenece al partido real y bajarse de ahi es el flujo normal
  -- del partido, no el de la busqueda. Se informan para que la interfaz pueda
  -- decir la verdad ("seguis en N partidos"), pero no se toca ni la membresia
  -- ni public.jugadores.
  select count(*)
  into created_memberships_kept
  from public.auto_match_proposal_members m
  join public.auto_match_proposals p on p.id = m.proposal_id
  where m.user_id = v_uid
    and p.status = 'created'
    and m.response = 'accepted'
    and p.proposed_starts_at > now();

  return next;
end;
$$;

revoke all on function public.auto_match_cancel_search() from public, anon, authenticated;

-- Contrato publico INTACTO: misma firma, mismo tipo de retorno (void) que
-- 20260710101500. Sin DROP FUNCTION. Cualquier build ya publicado de iOS,
-- Android o web sigue llamandolo igual y ahora recibe la baja completa.
-- Cambia solo el lenguaje (sql -> plpgsql), que CREATE OR REPLACE si admite.
create or replace function public.cancel_my_availability()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  perform * from public.auto_match_cancel_search();
end;
$$;

revoke all on function public.cancel_my_availability() from public, anon;
grant execute on function public.cancel_my_availability() to authenticated;

-- RPC NUEVO, aditivo: mismos efectos que el anterior y ademas los contadores
-- de lo que hizo. Solo lo llaman los clientes que saben pedirlo; ninguno
-- publicado lo conoce, asi que no hay contrato viejo que romper.
create or replace function public.cancel_my_availability_detailed()
returns table (
  availability_cancelled integer,
  gestation_memberships_released integer,
  created_invites_withdrawn integer,
  created_memberships_kept integer
)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  return query select * from public.auto_match_cancel_search();
end;
$$;

revoke all on function public.cancel_my_availability_detailed() from public, anon;
grant execute on function public.cancel_my_availability_detailed() to authenticated;


-- ---------------------------------------------------------------------------
-- 6. Roster: solo miembros activos.
-- ---------------------------------------------------------------------------

-- Misma firma y mismas columnas que la version de 20260712220000. Cambian dos
-- cosas: las filas terminales ('declined', 'expired', 'waitlisted') dejan de
-- devolverse, y quien consulta debe ser miembro activo (un jugador que se
-- bajo no sigue viendo el plantel). El calculo de asiento titular/suplente no
-- cambia: se rankea dentro de los 'accepted', que no se filtran.
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
      and m.response not in ('declined', 'expired', 'waitlisted')
      and exists (
        select 1 from public.auto_match_proposal_members me
        where me.proposal_id = p_proposal_id
          and me.user_id = auth.uid()
          and me.response not in ('declined', 'expired', 'waitlisted')
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

commit;
