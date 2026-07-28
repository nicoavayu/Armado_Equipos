begin;

-- ==========================================================================
-- Partido automatico — correcciones de la auditoria independiente:
--
--  A2. Un partido real confirmado no desactiva la busqueda ni bloquea otras
--      oportunidades, pero un jugador no debe ser invitado (ni aceptar) una
--      oportunidad cuyos horarios candidatos esten TODOS superpuestos con sus
--      partidos reales. Los horarios candidatos son exactamente los que
--      finalize_auto_match_proposal puede elegir por defecto: la grilla de 15
--      minutos en proposed_starts_at ± 120, acotada a la misma fecha local de
--      America/Argentina/Buenos_Aires, con rangos semiabiertos de 120 minutos
--      (auto_match_play_range) y los mismos estados de partido vigentes. Si
--      queda al menos un candidato libre, la oportunidad sigue permitida y la
--      materializacion elige ese horario; la validacion final de finalize se
--      conserva intacta como ultima defensa.
--
--  A3. Fase A de sync_my_auto_match_gestations evaluaba el conteo de
--      convocados en el filtro del SELECT ... FOR UPDATE SKIP LOCKED. Como el
--      alta de un miembro no modifica la fila de la propuesta, adquirir el
--      lock despues del commit ajeno no re-evalua el subquery y dos syncs muy
--      ajustados podian dejar capacity + 1 pendientes. Ahora, igual que la
--      Fase B, el conteo se repite en un statement nuevo DESPUES de obtener el
--      lock de la fila (snapshot fresco en read committed); todos los caminos
--      que insertan miembros toman ese mismo lock, asi que el re-conteo es
--      autoritativo. No se agregan locks nuevos ni cambia su orden.
--
-- La migracion es aditiva: solo redefine funciones y agrega helpers. No toca
-- datos historicos, tablas, columnas, indices, constraints, RLS ni el cron
-- auto_match_sweep (sigue llamando a auto_match_scheduled_sweep por nombre).
-- ==========================================================================

-- Conflicto contra partidos reales para UN horario candidato concreto. Mismos
-- predicados que finalize_auto_match_proposal: estados vigentes, kickoff
-- canonico y rangos semiabiertos de 120 minutos.
create or replace function public.auto_match_user_real_match_conflict(
  p_user_id uuid,
  p_starts_at timestamptz,
  p_format text,
  p_exclude_partido_id bigint default null
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.jugadores j
    join public.partidos pa on pa.id = j.partido_id
    where j.usuario_id = p_user_id
      and (p_exclude_partido_id is null or pa.id <> p_exclude_partido_id)
      and coalesce(lower(pa.estado), 'active')
            not in ('deleted', 'cancelado', 'cancelled', 'canceled', 'finalizado', 'finished', 'completed')
      and public.partido_kickoff_at(pa.fecha, pa.hora) is not null
      and public.auto_match_play_range(
            public.partido_kickoff_at(pa.fecha, pa.hora), pa.modalidad
          ) && public.auto_match_play_range(p_starts_at, p_format)
  );
$$;

-- Regla final de A2 para una ventana (disponibilidad viva o snapshot): existe
-- al menos un horario candidato de la oportunidad que cae dentro de la ventana
-- del jugador y NO se superpone con sus partidos reales. Con p_fixed_time la
-- oportunidad ya esta materializada y el unico candidato es su horario real.
create or replace function public.auto_match_window_has_free_slot(
  p_user_id uuid,
  p_proposed_starts_at timestamptz,
  p_format text,
  p_days_of_week smallint[],
  p_time_start time,
  p_time_end time,
  p_timezone text,
  p_fixed_time boolean default false,
  p_exclude_partido_id bigint default null
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from (
      select p_proposed_starts_at as starts_at
      where p_fixed_time
      union all
      select candidate
      from generate_series(
        p_proposed_starts_at - interval '120 minutes',
        p_proposed_starts_at + interval '120 minutes',
        interval '15 minutes'
      ) candidate
      where not p_fixed_time
        and (candidate at time zone 'America/Argentina/Buenos_Aires')::date
            = (p_proposed_starts_at at time zone 'America/Argentina/Buenos_Aires')::date
    ) c
    where extract(isodow from (c.starts_at at time zone p_timezone))::smallint
          = any(p_days_of_week)
      and (c.starts_at at time zone p_timezone)::time >= p_time_start
      and p_time_end - (c.starts_at at time zone p_timezone)::time >= interval '60 minutes'
      and not public.auto_match_user_real_match_conflict(
        p_user_id, c.starts_at, p_format, p_exclude_partido_id
      )
  );
$$;

-- Candidato nuevo (invitaciones): ventana viva de player_availability.
create or replace function public.auto_match_availability_has_free_slot(
  p_availability_id bigint,
  p_proposal_id bigint
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.player_availability a
    join public.auto_match_proposals p on p.id = p_proposal_id
    where a.id = p_availability_id
      and public.auto_match_window_has_free_slot(
        a.user_id, p.proposed_starts_at, p.format,
        a.days_of_week, a.time_start, a.time_end, a.timezone,
        p.partido_id is not null, p.partido_id
      )
  );
$$;

-- Miembro existente (aceptacion y reconciliacion): snapshot inmutable.
create or replace function public.auto_match_member_has_free_slot(
  p_proposal_id bigint,
  p_user_id uuid
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
    where m.proposal_id = p_proposal_id
      and m.user_id = p_user_id
      and public.auto_match_window_has_free_slot(
        m.user_id, p.proposed_starts_at, p.format,
        m.snapshot_days_of_week, m.snapshot_time_start, m.snapshot_time_end,
        m.snapshot_timezone, p.partido_id is not null, p.partido_id
      )
  );
$$;

-- Candidato nuevo: igual que antes (ventana + compatibilidad geografica contra
-- todos los snapshots vivos) MAS la regla A2: al menos un horario candidato de
-- la oportunidad libre frente a sus partidos reales. Cubre de una sola vez el
-- matcher, el backfill, las cohortes y el trigger de elegibilidad en INSERT.
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
      and public.auto_match_availability_has_free_slot(p_availability_id, p_proposal_id)
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

-- Matcher canonico. Cambios respecto de la version anterior:
--  * Fase A re-cuenta convocados y re-valida compatibilidad DESPUES de adquirir
--    el lock de la propuesta (A3); si la sala se lleno en el interin, cae a la
--    Fase B como si nunca hubiera calificado.
--  * Fase B aplica la regla A2 al iniciador y a los candidatos ANTES de crear
--    la sala: quien no tiene ningun horario candidato libre no la infla ni
--    recibe push, pero sigue elegible para otros dias, formatos y horarios.
--  * Se eliminan las llamadas a los shims neutralizados de la migracion
--    20260715003000 (user_has_overlapping_auto_match / user_declined_auto_match_slot,
--    ambos `select false`); los shims permanecen definidos por compatibilidad.
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

      -- Fase A: una sala existente solo acepta al usuario si respeta los
      -- radios de todos sus miembros, el horario y la regla A2. El conteo del
      -- filtro es solo un descarte barato: el autoritativo viene despues.
      select p.* into v_proposal
      from public.auto_match_proposals p
      where p.status in ('collecting', 'ready')
        and p.format = v_format
        and p.expires_at > now()
        and extract(isodow from (p.proposed_starts_at at time zone v_mine.timezone))::smallint = v_day
        and (p.proposed_starts_at at time zone v_mine.timezone)::time >= v_mine.time_start
        and v_mine.time_end - (p.proposed_starts_at at time zone v_mine.timezone)::time >= interval '60 minutes'
        and public.auto_match_availability_fits_proposal(v_mine.id, p.id)
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

      -- A3: el filtro anterior se evaluo con el snapshot previo al lock. Con
      -- el lock de la fila ya tomado, este statement ve todos los commits
      -- ajenos; si la sala se lleno o dejo de ser compatible, se descarta sin
      -- insertar ni notificar (misma proteccion que ya usa la Fase B).
      if v_proposal.id is not null then
        select count(*) into v_member_count
        from public.auto_match_proposal_members m
        where m.proposal_id = v_proposal.id
          and m.response not in ('declined', 'expired', 'waitlisted');

        if v_member_count >= v_capacity
           or not public.auto_match_availability_fits_proposal(v_mine.id, v_proposal.id) then
          v_proposal := null;
        end if;
      end if;

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

      -- Fase B: seleccion greedy de una clique. Cada nuevo integrante debe ser
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

      -- A2: si TODOS los horarios candidatos de este slot chocan con partidos
      -- reales del iniciador, se descarta solo este slot; la busqueda sigue
      -- activa para los demas dias y formatos.
      if not public.auto_match_window_has_free_slot(
        auth.uid(), v_proposed, v_format,
        v_mine.days_of_week, v_mine.time_start, v_mine.time_end, v_mine.timezone
      ) then continue; end if;

      -- A2: la regla se evalua antes del minimo, asi los ocupados por partidos
      -- reales nunca inflan la cohorte ni reciben push por un slot imposible.
      delete from tmp_auto_match_gestation_candidates c
      using public.player_availability a
      where a.id = c.availability_id
        and not public.auto_match_window_has_free_slot(
          c.user_id, v_proposed, v_format,
          a.days_of_week, a.time_start, a.time_end, a.timezone
        );
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

        if public.auto_match_availability_fits_proposal(v_candidate.availability_id, v_proposal.id) then
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

-- Cohortes siguientes: misma seleccion pairwise; la regla A2 se evalua en el
-- filtro para que los ocupados no cuenten para el minimo ni reciban push.
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
      and public.auto_match_window_has_free_slot(
        a.user_id, v_base.proposed_starts_at, v_format,
        a.days_of_week, a.time_start, a.time_end, a.timezone
      )
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

-- Respuesta atomica sobre una unica gestacion. Cambio A2: al ACEPTAR se vuelve
-- a calcular si queda algun horario candidato libre frente a los partidos
-- reales del jugador (pudo crear/aceptar uno despues de ser invitado). Si no
-- queda ninguno, la membresia pasa al estado terminal 'expired' con motivo
-- 'schedule_conflict' (los clientes 1.1.15 ya traducen la fila devuelta), se
-- ejecuta el backfill normal para reponer el lugar y la busqueda del jugador
-- sigue activa para otras oportunidades. Nada queda pendiente indefinidamente.
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
  v_geo_incompatible boolean;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_response not in ('accepted','declined') then raise exception 'invalid_response'; end if;

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
  if p_response = 'declined' and v_member.response = 'declined' then return v_member; end if;

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

    -- A2: revalidacion contra partidos reales bajo el lock de la propuesta.
    -- El estado es terminal (confirmed_at nulo => ninguna reconciliacion lo
    -- restaura) y el backfill repone el lugar en la misma transaccion.
    if not public.auto_match_member_has_free_slot(p_proposal_id, auth.uid()) then
      update public.auto_match_proposal_members
      set response = 'expired',
          response_reason = 'schedule_conflict',
          responded_at = now(),
          confirmed_at = null,
          invite_expires_at = null
      where proposal_id = p_proposal_id and user_id = auth.uid()
      returning * into v_member;
      perform public.backfill_auto_match_proposal_members(p_proposal_id);
      return v_member;
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

-- Reconciliacion: las restauraciones (declined por schedule_conflict del viejo
-- camino cruzado y expired automaticos con confirmacion previa) exigen ahora
-- la regla A2, y un pending cuyos horarios candidatos quedaron TODOS ocupados
-- por partidos reales se expira con motivo 'schedule_conflict' liberando su
-- lugar, sin cancelar la sala ni la busqueda del jugador.
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

  -- A schedule-conflict decline was generated by the old cross-gestation
  -- response path. It is not a voluntary exit, so put it back in this room.
  update public.auto_match_proposal_members m
  set response = 'pending',
      response_reason = null,
      responded_at = null,
      invite_expires_at = public.auto_match_invite_deadline(now(), v_proposal.proposed_starts_at)
  where m.proposal_id = p_proposal_id
    and m.response = 'declined'
    and m.response_reason = 'schedule_conflict'
    and m.confirmed_at is null
    and public.auto_match_member_snapshot_is_valid_for_proposal(p_proposal_id, m.user_id)
    and public.auto_match_member_has_free_slot(p_proposal_id, m.user_id)
    and not exists (
      select 1
      from public.auto_match_proposal_members core
      where core.proposal_id = p_proposal_id
        and core.response = 'accepted'
        and core.user_id <> m.user_id
        and not public.auto_match_member_snapshots_are_compatible(
          p_proposal_id, m.user_id, core.user_id
        )
    );
  get diagnostics restored_count = row_count;

  for v_member in
    select m.user_id
    from public.auto_match_proposal_members m
    where m.proposal_id = p_proposal_id
      and m.response = 'expired'
      and m.confirmed_at is not null
      and coalesce(m.response_reason, '') in ('', 'schedule_conflict', 'availability_ineligible')
      and public.auto_match_member_snapshot_is_valid_for_proposal(p_proposal_id, m.user_id)
      and public.auto_match_member_has_free_slot(p_proposal_id, m.user_id)
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
      and coalesce(response_reason, '') in ('', 'schedule_conflict', 'availability_ineligible');
    if found then restored_count := restored_count + 1; end if;
  end loop;

  insert into tmp_auto_match_reconcile_keep(user_id)
  select m.user_id
  from public.auto_match_proposal_members m
  where m.proposal_id = p_proposal_id and m.response = 'accepted'
  on conflict do nothing;

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
    elsif not public.auto_match_member_has_free_slot(
      p_proposal_id, v_member.user_id
    ) then
      v_reason := 'schedule_conflict';
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

-- Trigger de elegibilidad: el camino INSERT hereda la regla A2 a traves de
-- auto_match_availability_fits_proposal; la restauracion expired->accepted la
-- exige explicitamente. El resto queda identico a 20260715003000.
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

-- Reparacion idempotente de salas vivas: retira pendientes que hoy ya no
-- tienen ningun horario candidato libre y repone sus lugares via backfill.
do $$
declare
  v_row record;
begin
  for v_row in
    select p.id
    from public.auto_match_proposals p
    where p.status in ('collecting', 'ready') and p.expires_at > now()
    order by p.id
  loop
    perform * from public.reconcile_auto_match_proposal_members(v_row.id);
  end loop;
end;
$$;

-- Funciones internas: sin EXECUTE para clientes. RPCs publicos: authenticated.
revoke all on function public.auto_match_user_real_match_conflict(uuid,timestamptz,text,bigint) from public, anon, authenticated, service_role;
revoke all on function public.auto_match_window_has_free_slot(uuid,timestamptz,text,smallint[],time,time,text,boolean,bigint) from public, anon, authenticated, service_role;
revoke all on function public.auto_match_availability_has_free_slot(bigint,bigint) from public, anon, authenticated, service_role;
revoke all on function public.auto_match_member_has_free_slot(bigint,uuid) from public, anon, authenticated, service_role;
revoke all on function public.auto_match_availability_fits_proposal(bigint,bigint) from public, anon, authenticated, service_role;
revoke all on function public.spawn_next_auto_match_cohort(bigint) from public, anon, authenticated, service_role;
revoke all on function public.reconcile_auto_match_proposal_members(bigint) from public, anon, authenticated, service_role;
revoke all on function public.enforce_auto_match_member_eligibility() from public, anon, authenticated, service_role;
revoke all on function public.sync_my_auto_match_gestations() from public, anon;
grant execute on function public.sync_my_auto_match_gestations() to authenticated;
revoke all on function public.respond_to_auto_match_proposal(bigint,text,boolean) from public, anon;
grant execute on function public.respond_to_auto_match_proposal(bigint,text,boolean) to authenticated;

commit;
