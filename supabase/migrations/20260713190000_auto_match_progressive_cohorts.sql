begin;

-- ============================================================================
-- Gestación automática: COHORTES PROGRESIVAS para el mismo día/horario/formato.
--
-- Incremental sobre 20260712220000 / 20260712230000 / 20260713120000 (todas
-- aplicadas a prod). No edita ninguna migración previa: agrega una columna,
-- reangosta la constraint de exclusión y redefine/crea funciones.
--
-- PROBLEMA QUE RESUELVE
--   Con muchísimos compatibles para un mismo slot (p. ej. 100 personas para F5
--   el lunes 20:00) el matcher creaba UNA sola sala (dedup por bucket de 15 min)
--   que convocaba hasta invitation_capacity (15 para F5) y DEJABA AFUERA al
--   resto: los 85 restantes quedaban sin propuesta ni push, bloqueados en una
--   única sala imposible de agrandar.
--
-- COMPORTAMIENTO NUEVO (progresivo, sin mandar 100 pushes juntos)
--   1) La primera sala convoca hasta invitation_capacity (F5=15, F7=21, F11=33)
--      y SOLO esos reciben push. El resto sigue disponible, sin notificar.
--   2) Cuando una sala completa sus TITULARES (accepted >= required) se "latchea"
--      (titulares_completed_at) y deja de bloquear el slot: recién ahí se habilita
--      la creación de la SIGUIENTE sala con otros compatibles.
--   3) La siguiente sala vuelve a convocar hasta invitation_capacity — a gente
--      DISTINTA (excluye titulares/suplentes/pendientes/vencidos/rechazados de las
--      salas previas de la cohorte; los 'waitlisted' pueden volver con invitación
--      nueva) — y así sucesivamente mientras queden >= min_candidates (4)
--      compatibles disponibles.
--
-- DEDUPLICACIÓN / CARRERAS
--   * Puede existir UNA sola sala de la cohorte todavía recolectando titulares
--     (status collecting/ready con titulares_completed_at IS NULL). Una sala con
--     titulares completos ya no bloquea a la siguiente.
--   * La constraint de exclusión (btree_gist) se reangosta a "…AND
--     titulares_completed_at IS NULL": impide dos salas RECOLECTANDO titulares en
--     el mismo bucket, pero permite la siguiente una vez completada la anterior.
--   * spawn_next_auto_match_cohort toma un advisory lock por cohorte + relee "¿ya
--     hay una sala abierta?" antes de crear, y atrapa exclusion_violation: dos
--     confirmaciones concurrentes que crucen el umbral no crean dos "segundas
--     salas".
--
-- AUTOMATIZACIÓN (quién crea la siguiente sala y cuándo)
--   * INMEDIATO: resolve_auto_match_full_cupo — que ya corre dentro del RPC de
--     confirmación respond_to_auto_match_proposal en el instante en que accepted
--     llega a required — llama a spawn_next_auto_match_cohort. La sala siguiente y
--     sus <=15 pushes quedan encolados ANTES de que devuelva la confirmación. No
--     depende de reabrir la app, reactivar disponibilidad ni de un sync manual.
--   * RESPALDO: auto_match_scheduled_sweep (pg_cron cada 5 min) reintenta la
--     cascada para cohortes cuya sala se completó pero cuyos compatibles llegaron
--     tarde. Demora máxima del respaldo: ~5 minutos.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Latch "titulares completos": marca de una sola vez cuándo una sala llenó
--    sus titulares. Libera el slot para la próxima sala de la cohorte.
-- ---------------------------------------------------------------------------

alter table public.auto_match_proposals
  add column if not exists titulares_completed_at timestamptz;

-- Backfill: las salas que YA tienen titulares completos (todas las 'ready', y
-- cualquier 'collecting'/'created' con accepted >= required) quedan latcheadas,
-- para que la constraint reangostada no las siga tratando como "recolectando".
update public.auto_match_proposals p
set titulares_completed_at = coalesce(p.updated_at, now())
where p.titulares_completed_at is null
  and p.status in ('collecting', 'ready', 'created')
  and (
    select count(*) from public.auto_match_proposal_members m
    where m.proposal_id = p.id and m.response = 'accepted'
  ) >= p.max_players;

-- ---------------------------------------------------------------------------
-- 2. Constraint de exclusión reangostada: dos salas RECOLECTANDO titulares en el
--    mismo bucket siguen prohibidas; una sala ya completa (latcheada) no bloquea
--    la creación de la siguiente. Mantiene el mismo nombre.
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1 from pg_constraint where conname = 'auto_match_proposals_slot_bucket_excl'
  ) then
    alter table public.auto_match_proposals
      drop constraint auto_match_proposals_slot_bucket_excl;
  end if;
  alter table public.auto_match_proposals
    add constraint auto_match_proposals_slot_bucket_excl
    exclude using gist (
      format with =,
      public.auto_match_slot_bucket_range(proposed_starts_at) with &&
    ) where (status in ('collecting', 'ready') and titulares_completed_at is null);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. spawn_next_auto_match_cohort: habilita la SIGUIENTE sala de la cohorte.
--    Idempotente y a prueba de carreras. Reutiliza el criterio de compatibilidad
--    del backfill de reemplazos (formato + día + ventana horaria), sumando la
--    exclusión por cohorte y las guardas de superposición / rechazo por slot.
-- ---------------------------------------------------------------------------

create or replace function public.spawn_next_auto_match_cohort(p_proposal_id bigint)
returns bigint
language plpgsql
security definer
set search_path = public
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
  v_invited integer := 0;
begin
  select * into v_base
  from public.auto_match_proposals
  where id = p_proposal_id;

  if v_base.id is null then return null; end if;
  -- Solo desde una sala de gestación viva. Una ya materializada no dispara
  -- cohortes nuevas desde acá.
  if v_base.status not in ('collecting', 'ready') then return null; end if;

  v_format := v_base.format;
  v_required := v_base.max_players;
  v_capacity := public.auto_match_invitation_capacity(v_format);
  v_min := public.auto_match_min_candidates();

  -- Latch de "titulares completos" (una sola vez). No se limpia aunque luego baje
  -- un titular: esa vacante la recompone la propia sala, no una cohorte nueva.
  update public.auto_match_proposals
  set titulares_completed_at = coalesce(titulares_completed_at, now())
  where id = p_proposal_id and titulares_completed_at is null;

  -- Serializa la creación de cohortes de este slot: dos confirmaciones que crucen
  -- el umbral a la vez no crean dos "segundas salas".
  v_bucket := floor(extract(epoch from v_base.proposed_starts_at) / 900)::bigint;
  perform pg_advisory_xact_lock(hashtextextended('auto_match_cohort:' || v_format || ':' || v_bucket::text, 0));

  -- Regla de deduplicación: solo puede haber UNA sala de la cohorte todavía
  -- recolectando titulares (sin latch). Si ya existe, no creamos otra.
  if exists (
    select 1 from public.auto_match_proposals cp
    where cp.format = v_format
      and cp.status in ('collecting', 'ready')
      and cp.titulares_completed_at is null
      and abs(extract(epoch from (cp.proposed_starts_at - v_base.proposed_starts_at))) < 900
  ) then
    return null;
  end if;

  -- Candidatos: disponibles compatibles con el slot (mismo criterio que el
  -- backfill de reemplazos) que NO estén ya comprometidos en ninguna sala de la
  -- cohorte con una respuesta distinta de 'waitlisted' (titular/suplente/pendiente
  -- /vencido/rechazado quedan excluidos; los 'waitlisted' —que quedaron afuera al
  -- completarse un plantel— vuelven a ser candidatos con una invitación nueva).
  -- Las guardas de superposición y de rechazo del slot se aplican acá, de modo
  -- que todo lo que entra al temporal ya es convocable de verdad.
  create temporary table if not exists tmp_auto_match_cohort_candidates (
    availability_id bigint,
    user_id uuid,
    can_organize boolean
  ) on commit drop;
  truncate tmp_auto_match_cohort_candidates;

  insert into tmp_auto_match_cohort_candidates
  select a.id, a.user_id, a.can_organize
  from public.player_availability a
  where a.status = 'active'
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
  limit v_capacity;

  select count(*) into v_cand_total from tmp_auto_match_cohort_candidates;
  -- "Continuar mientras existan al menos cuatro candidatos compatibles."
  if v_cand_total < v_min then
    return null;
  end if;

  -- Crea la próxima sala en el mismo slot. Sin miembro auto-confirmado: los
  -- convocados entran 'pending' y los primeros `required` que confirmen serán
  -- titulares. created_by hereda la procedencia (no otorga membresía ni chat).
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
    -- Otra corrida ganó la carrera y ya creó la sala. No duplicamos.
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
      v_invited := v_invited + 1;
      -- Un push por convocado, con clave idempotente por propuesta+usuario.
      perform public.enqueue_auto_match_notification(
        v_new_id,
        'auto_match_gestating',
        'Se está armando un partido',
        format('Se está armando un %s compatible con tus horarios. Entrá para confirmar si te sumás.', v_format),
        array[v_candidate.user_id]::uuid[],
        format('cohort_invite:%s', v_candidate.user_id),
        null
      );
    end if;
  end loop;

  return v_new_id;
end;
$$;

revoke all on function public.spawn_next_auto_match_cohort(bigint) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. resolve_auto_match_full_cupo: idéntica a 20260712220000 pero, al final,
--    dispara la cohorte siguiente. Es el único punto que corre exactamente
--    cuando accepted alcanza required (desde respond_to_auto_match_proposal), así
--    que la creación de la próxima sala es inmediata y automática.
-- ---------------------------------------------------------------------------

create or replace function public.resolve_auto_match_full_cupo(p_proposal_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proposal public.auto_match_proposals;
  v_required integer;
  v_volunteer record;
begin
  select * into v_proposal
  from public.auto_match_proposals
  where id = p_proposal_id;

  if v_proposal.id is null then return; end if;
  v_required := v_proposal.max_players;

  if v_proposal.organizer_id is null then
    -- Voluntario más temprano entre los titulares (rank <= required por
    -- confirmed_at). Nadie es convertido a la fuerza.
    select ranked.user_id, ranked.nombre
    into v_volunteer
    from (
      select
        m.user_id,
        u.nombre,
        m.can_organize,
        row_number() over (order by m.confirmed_at asc nulls last, m.user_id) as seat
      from public.auto_match_proposal_members m
      join public.usuarios u on u.id = m.user_id
      where m.proposal_id = p_proposal_id and m.response = 'accepted'
    ) ranked
    where ranked.seat <= v_required and ranked.can_organize
    order by ranked.seat
    limit 1;

    if v_volunteer.user_id is not null then
      update public.auto_match_proposals
      set organizer_id = v_volunteer.user_id, organizer_deadline_at = null, updated_at = now()
      where id = p_proposal_id;

      perform public.enqueue_auto_match_notification(
        p_proposal_id,
        'auto_match_organizing',
        '¡Ya somos todos!',
        format('El cupo está completo y %s organiza el partido: va a definir cancha, hora exacta y precio.', coalesce(v_volunteer.nombre, 'un jugador')),
        null,
        format('organizer_assigned:%s', v_volunteer.user_id),
        null
      );
    else
      update public.auto_match_proposals
      set organizer_deadline_at = least(now() + interval '12 hours', expires_at), updated_at = now()
      where id = p_proposal_id;

      perform public.enqueue_auto_match_notification(
        p_proposal_id,
        'auto_match_ready',
        'Ya están todos los jugadores',
        'Falta que alguien organice el partido. El primero que toque "Yo lo organizo" define cancha y precio.',
        null,
        'ready_awaiting_organizer',
        null
      );
    end if;
  else
    perform public.enqueue_auto_match_notification(
      p_proposal_id,
      'auto_match_organizing',
      '¡Ya somos todos!',
      'El cupo volvió a completarse. La organización sigue en marcha.',
      null,
      format('refull:%s', extract(epoch from now())::bigint / 3600),
      null
    );
  end if;

  -- Titulares completos => habilitar la SIGUIENTE sala de la cohorte (idempotente
  -- y a prueba de carreras). La falta de organizador NO frena la cascada.
  perform public.spawn_next_auto_match_cohort(p_proposal_id);
end;
$$;

revoke all on function public.resolve_auto_match_full_cupo(bigint) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Barrido programado: además de vencimientos, reemplazos y reapertura de
--    vacantes, RESPALDA la cascada progresiva por si aparecieron compatibles
--    después de que una sala completó sus titulares. spawn es idempotente.
--    Redefinida sin depender del orden de migraciones (copia de 20260713120000).
-- ---------------------------------------------------------------------------

create or replace function public.auto_match_scheduled_sweep()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
begin
  perform public.expire_stale_auto_match_proposals();

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

  -- Respaldo de la cascada: salas con titulares completos (latcheadas) cuya
  -- cohorte todavía no tiene una sala abierta recolectando titulares habilitan la
  -- siguiente si aún quedan compatibles. spawn_next_auto_match_cohort chequea todo
  -- eso internamente y es idempotente.
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

revoke all on function public.auto_match_scheduled_sweep() from public, anon, authenticated;

commit;
