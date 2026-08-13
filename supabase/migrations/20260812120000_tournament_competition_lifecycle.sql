-- Arma2 Torneos — ciclo de vida de la competencia.
--
-- Cierra el tramo que faltaba del recorrido del propietario:
--
--   Lista para comenzar -> En juego   (start_tournament_competition)
--   En juego            -> Finalizada (finish_tournament_competition)
--   Finalizada          -> En juego   (reopen_tournament_competition, sólo propietario)
--
-- y agrega el retiro estructural de un equipo durante la competencia
-- (withdraw_tournament_competition_participant), cuyos compromisos futuros
-- quedan registrados como fecha libre sin puntos ni estadísticas ficticias.
--
-- Endurecimientos asociados:
--   1. `administrative_result` ya no puede crear ni contar estadísticas
--      individuales ficticias.
--   2. Una competencia Finalizada o Archivada queda operacionalmente
--      read-only: se rechazan las escrituras competitivas sobre partidos,
--      actas y sus hijos, y siguen permitidas lecturas y recálculos derivados.
--   3. Un participante retirado sigue existiendo para la tabla, el fixture y
--      las vistas de partido; deja de desaparecer de las lecturas.
--   4. La baja aislada de una inscripción (`withdraw_tournament_team_entry`)
--      queda limitada a la etapa de preparación y deja de estar al alcance de
--      un `assistant`.
--
-- Sin DROP de tablas, sin borrado de filas, sin cambios de Auth. Todas las
-- columnas nuevas son NULLables y compatibles con los datos existentes.

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- 1. Capacidades
-- ---------------------------------------------------------------------------
-- Aditivo sobre el contrato existente. `tournaments.reopen` es la única
-- capacidad exclusiva del propietario dentro de este alcance.

CREATE OR REPLACE FUNCTION "public"."tournament_role_capabilities"("p_role" "text") RETURNS "text"[]
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
  select case p_role
    when 'owner' then array[
      'organization.read', 'organization.update', 'organization.archive',
      'members.read', 'members.invite', 'members.update_role', 'members.remove',
      'workspace.access', 'workspace.manage',
      'seasons.read', 'seasons.create', 'seasons.update', 'seasons.archive',
      'tournaments.read', 'tournaments.create', 'tournaments.update',
      'tournaments.change_status', 'tournaments.archive',
      'tournaments.start', 'tournaments.finish', 'tournaments.reopen',
      'categories.read', 'categories.create', 'categories.update', 'categories.archive',
      'competition_rules.read', 'competition_rules.update',
      'team_entries.read', 'team_entries.create', 'team_entries.update',
      'team_entries.submit', 'team_entries.review', 'team_entries.approve',
      'team_entries.reject', 'team_entries.withdraw', 'team_entries.archive',
      'team_managers.read', 'team_managers.invite', 'team_managers.revoke',
      'rosters.read', 'rosters.update', 'rosters.submit', 'rosters.review',
      'rosters.approve', 'rosters.lock',
      'roster_players.read', 'roster_players.add', 'roster_players.update',
      'roster_players.remove', 'provisional_players.create',
      'provisional_players.update', 'player_duplicates.override',
      'participants.read', 'participants.freeze', 'participants.reopen',
      'participants.withdraw',
      'draw.read', 'draw.manage', 'draw.execute', 'draw.publish',
      'fixture.read', 'fixture.generate', 'fixture.create_manual',
      'fixture.update_draft', 'fixture.publish', 'fixture.supersede', 'fixture.archive',
      'groups.read', 'groups.manage', 'rounds.read', 'rounds.manage', 'rounds.lock',
      'matches.read', 'matches.create', 'matches.schedule', 'matches.reschedule',
      'matches.postpone', 'matches.cancel',
      'venues.read', 'venues.create', 'venues.update', 'venues.archive',
      'courts.read', 'courts.create', 'courts.update', 'courts.archive',
      'schedule_windows.read', 'schedule_windows.manage', 'schedule_conflicts.override',
      'match_operations.read', 'match_operations.open',
      'match_operations.update_draft', 'match_operations.submit',
      'match_operations.review', 'match_operations.validate',
      'match_operations.make_official', 'match_operations.request_correction',
      'match_operations.correct', 'match_operations.void',
      'match_squads.read', 'match_squads.manage', 'match_squads.submit',
      'match_squads.lock', 'match_availability.read',
      'match_availability.record_manual', 'match_events.read',
      'match_events.create', 'match_events.update_draft', 'match_events.void',
      'match_outcomes.manage', 'match_scores.manage',
      'match_administrative_results.manage',
      'standings.read', 'standings.rebuild', 'standings.publish', 'standings.override',
      'statistics.read', 'statistics.rebuild',
      'qualification.read', 'qualification.resolve', 'qualification.override',
      'discipline.read', 'discipline.manage', 'discipline.resolve',
      'discipline.override', 'suspensions.read', 'suspensions.manage',
      'suspensions.mark_served'
    ]::text[]
    when 'admin' then array[
      'organization.read', 'organization.update',
      'members.read', 'members.invite', 'members.update_role', 'members.remove',
      'workspace.access', 'workspace.manage',
      'seasons.read', 'seasons.create', 'seasons.update', 'seasons.archive',
      'tournaments.read', 'tournaments.create', 'tournaments.update',
      'tournaments.change_status', 'tournaments.archive',
      'tournaments.start', 'tournaments.finish',
      'categories.read', 'categories.create', 'categories.update', 'categories.archive',
      'competition_rules.read', 'competition_rules.update',
      'team_entries.read', 'team_entries.create', 'team_entries.update',
      'team_entries.submit', 'team_entries.review', 'team_entries.approve',
      'team_entries.reject', 'team_entries.withdraw', 'team_entries.archive',
      'team_managers.read', 'team_managers.invite', 'team_managers.revoke',
      'rosters.read', 'rosters.update', 'rosters.submit', 'rosters.review',
      'rosters.approve', 'rosters.lock',
      'roster_players.read', 'roster_players.add', 'roster_players.update',
      'roster_players.remove', 'provisional_players.create',
      'provisional_players.update', 'player_duplicates.override',
      'participants.read', 'participants.freeze', 'participants.reopen',
      'participants.withdraw',
      'draw.read', 'draw.manage', 'draw.execute', 'draw.publish',
      'fixture.read', 'fixture.generate', 'fixture.create_manual',
      'fixture.update_draft', 'fixture.publish', 'fixture.supersede', 'fixture.archive',
      'groups.read', 'groups.manage', 'rounds.read', 'rounds.manage', 'rounds.lock',
      'matches.read', 'matches.create', 'matches.schedule', 'matches.reschedule',
      'matches.postpone', 'matches.cancel',
      'venues.read', 'venues.create', 'venues.update', 'venues.archive',
      'courts.read', 'courts.create', 'courts.update', 'courts.archive',
      'schedule_windows.read', 'schedule_windows.manage', 'schedule_conflicts.override',
      'match_operations.read', 'match_operations.open',
      'match_operations.update_draft', 'match_operations.submit',
      'match_operations.review', 'match_operations.validate',
      'match_operations.make_official', 'match_operations.request_correction',
      'match_operations.correct', 'match_operations.void',
      'match_squads.read', 'match_squads.manage', 'match_squads.submit',
      'match_squads.lock', 'match_availability.read',
      'match_availability.record_manual', 'match_events.read',
      'match_events.create', 'match_events.update_draft', 'match_events.void',
      'match_outcomes.manage', 'match_scores.manage',
      'match_administrative_results.manage',
      'standings.read', 'standings.rebuild', 'standings.publish', 'standings.override',
      'statistics.read', 'statistics.rebuild',
      'qualification.read', 'qualification.resolve', 'qualification.override',
      'discipline.read', 'discipline.manage', 'discipline.resolve',
      'discipline.override', 'suspensions.read', 'suspensions.manage',
      'suspensions.mark_served'
    ]::text[]
    when 'collaborator' then array[
      'organization.read', 'members.read', 'workspace.access',
      'seasons.read', 'tournaments.read', 'categories.read',
      'competition_rules.read', 'team_entries.read', 'team_managers.read',
      'rosters.read', 'roster_players.read',
      'participants.read', 'draw.read', 'fixture.read', 'groups.read',
      'rounds.read', 'matches.read', 'venues.read', 'courts.read',
      'schedule_windows.read', 'match_operations.read', 'match_squads.read',
      'match_availability.read', 'match_events.read',
      'standings.read', 'statistics.read', 'qualification.read',
      'discipline.read', 'suspensions.read'
    ]::text[]
    else array[]::text[]
  end;
$$;

COMMENT ON FUNCTION "public"."tournament_role_capabilities"("p_role" "text") IS
  'Capacidades por rol de organización. `tournaments.reopen` es exclusiva del propietario: reabrir una competencia finalizada es una corrección excepcional.';

-- ---------------------------------------------------------------------------
-- 2. Columnas de ciclo de vida y retiro
-- ---------------------------------------------------------------------------
-- Las columnas guardan la última ocurrencia de cada transición para lecturas
-- baratas. La historia completa —incluidos varios ciclos finalizar/reabrir—
-- vive en `tournament_audit_log`, que nunca se limpia.

ALTER TABLE "public"."tournaments"
  ADD COLUMN IF NOT EXISTS "started_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "completed_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "reopened_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "reopen_count" integer DEFAULT 0 NOT NULL;

COMMENT ON COLUMN "public"."tournaments"."completed_at" IS
  'Última vez que la competencia fue finalizada. No se limpia al reabrir: la secuencia completa de finalizaciones y reaperturas se reconstruye desde tournament_audit_log.';

ALTER TABLE "public"."tournament_competition_participants"
  ADD COLUMN IF NOT EXISTS "withdrawn_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "withdrawn_by" "uuid",
  ADD COLUMN IF NOT EXISTS "withdrawal_reason_code" "text",
  ADD COLUMN IF NOT EXISTS "withdrawal_reason_text" "text";

do $participant_withdrawal_constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'tournament_competition_participants_withdrawn_by_fkey'
  ) then
    alter table public.tournament_competition_participants
      add constraint tournament_competition_participants_withdrawn_by_fkey
      foreign key (withdrawn_by) references auth.users(id) on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'tournament_competition_participants_withdrawal_check'
  ) then
    alter table public.tournament_competition_participants
      add constraint tournament_competition_participants_withdrawal_check
      check (
        (
          withdrawn_at is null
          and withdrawn_by is null
          and withdrawal_reason_code is null
          and withdrawal_reason_text is null
        )
        or (
          status = 'withdrawn'
          and withdrawn_at is not null
          and withdrawn_by is not null
          and withdrawal_reason_code = any (array[
            'voluntary_resignation', 'sanction_exclusion',
            'regulatory_breach', 'other'
          ])
          and (
            withdrawal_reason_code <> 'other'
            or char_length(btrim(coalesce(withdrawal_reason_text, ''))) >= 3
          )
          and (
            withdrawal_reason_text is null
            or char_length(withdrawal_reason_text) <= 2000
          )
        )
      );
  end if;
end;
$participant_withdrawal_constraints$;

COMMENT ON COLUMN "public"."tournament_competition_participants"."withdrawal_reason_code" IS
  'Código estable del motivo de retiro. La etiqueta en castellano vive en la capa de presentación, nunca acá.';

ALTER TABLE "public"."tournament_matches"
  ADD COLUMN IF NOT EXISTS "cancelled_by" "uuid",
  ADD COLUMN IF NOT EXISTS "cancellation_reason_code" "text",
  ADD COLUMN IF NOT EXISTS "cancellation_reason_text" "text",
  ADD COLUMN IF NOT EXISTS "withdrawn_participant_id" "uuid";

do $match_cancellation_constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'tournament_matches_cancelled_by_fkey'
  ) then
    alter table public.tournament_matches
      add constraint tournament_matches_cancelled_by_fkey
      foreign key (cancelled_by) references auth.users(id) on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'tournament_matches_cancellation_check'
  ) then
    alter table public.tournament_matches
      add constraint tournament_matches_cancellation_check
      check (
        (
          cancellation_reason_code is null
          and cancellation_reason_text is null
          and cancelled_by is null
          and withdrawn_participant_id is null
        )
        or (
          status = 'cancelled'
          and cancellation_reason_code = any (array[
            'withdrawal_bye', 'manual_cancellation'
          ])
          and (
            char_length(coalesce(cancellation_reason_text, '')) <= 500
          )
          and (
            withdrawn_participant_id is null
            or cancellation_reason_code = 'withdrawal_bye'
          )
        )
      );
  end if;
end;
$match_cancellation_constraints$;

COMMENT ON COLUMN "public"."tournament_matches"."cancellation_reason_code" IS
  'Distingue una cancelación decidida por la organización (`manual_cancellation`) de una fecha libre por retiro del rival (`withdrawal_bye`). El partido nunca se borra: conserva ambos participantes originales.';

CREATE INDEX IF NOT EXISTS "tournament_matches_withdrawn_participant_idx"
  ON "public"."tournament_matches" ("withdrawn_participant_id")
  WHERE "withdrawn_participant_id" IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Predicado canónico de compromisos abiertos
-- ---------------------------------------------------------------------------
-- Definición a nivel competencia, deliberadamente alineada con la que
-- `resolve_tournament_qualification` aplica a nivel fase/grupo.
--
-- Un partido deja de ser un compromiso abierto cuando:
--   * su estado es `cancelled` —terminal, incluye la fecha libre por retiro—, o
--   * tiene un acta oficial con un resultado terminal, es decir sin resolución
--     pendiente y que no anuncia que el partido se juega más adelante.
--
-- Diferencia deliberada con la calificación: `resolve_tournament_qualification`
-- además exige `counts_for_standings`, porque necesita un marcador para deducir
-- ganador/perdedor de un cruce. Finalizar la competencia no necesita eso: un
-- `not_played` o un `cancelled` resueltos son cierres válidos. Esto elimina la
-- asimetría en la que `status = 'cancelled'` se consideraba resuelto y un
-- resultado `not_played` equivalente bloqueaba el cierre.

CREATE OR REPLACE FUNCTION "public"."tournament_competition_open_commitments"(
  "p_organization_id" "uuid",
  "p_tournament_id" "uuid"
) RETURNS TABLE(
  "match_id" "uuid",
  "category_id" "uuid",
  "match_number" integer,
  "reason_code" "text"
)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select
    match_row.id,
    match_row.category_id,
    match_row.match_number,
    case
      when match_row.home_participant_id is null
        or match_row.away_participant_id is null
        then 'participants_unresolved'
      when not exists (
        select 1
        from public.tournament_match_operations operation
        where operation.match_id = match_row.id
          and operation.status = 'official'
      ) then 'operation_pending'
      when exists (
        select 1
        from public.tournament_match_operations operation
        join public.tournament_match_outcomes outcome
          on outcome.match_operation_id = operation.id
        where operation.match_id = match_row.id
          and operation.status = 'official'
          and outcome.requires_resolution
      ) then 'resolution_pending'
      else 'replay_pending'
    end
  from public.tournament_matches match_row
  join public.tournament_fixture_versions fixture
    on fixture.id = match_row.fixture_version_id
    and fixture.status = 'published'
    and fixture.invalidated_at is null
  join public.tournament_categories category
    on category.organization_id = match_row.organization_id
    and category.tournament_id = match_row.tournament_id
    and category.id = match_row.category_id
    and category.status = 'active'
  where match_row.organization_id = p_organization_id
    and match_row.tournament_id = p_tournament_id
    and match_row.status <> 'cancelled'
    and (
      match_row.home_participant_id is null
      or match_row.away_participant_id is null
      or not exists (
        select 1
        from public.tournament_match_operations operation
        join public.tournament_match_outcomes outcome
          on outcome.match_operation_id = operation.id
        where operation.match_id = match_row.id
          and operation.status = 'official'
          and not outcome.requires_resolution
          and outcome.outcome_type not in ('postponed_before_start', 'resumed_future')
      )
    )

  union all

  select
    match_row.id,
    match_row.category_id,
    match_row.match_number,
    'review_open'
  from public.tournament_match_reviews review
  join public.tournament_match_operations operation
    on operation.id = review.match_operation_id
  join public.tournament_matches match_row
    on match_row.id = operation.match_id
  join public.tournament_fixture_versions fixture
    on fixture.id = match_row.fixture_version_id
    and fixture.status = 'published'
    and fixture.invalidated_at is null
  where match_row.organization_id = p_organization_id
    and match_row.tournament_id = p_tournament_id
    and match_row.status <> 'cancelled'
    and review.status = 'open'
    and review.review_type in (
      'correction', 'dispute_future', 'administrative_resolution'
    );
$$;

COMMENT ON FUNCTION "public"."tournament_competition_open_commitments"("uuid", "uuid") IS
  'Compromisos deportivos todavía abiertos de una competencia. Superconjunto a nivel competencia del predicado de resolve_tournament_qualification: un `cancelled` y un resultado terminal como `not_played` cierran igual, mientras la calificación además exige marcador porque deduce cruces.';

-- ---------------------------------------------------------------------------
-- 4. Iniciar competencia
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "public"."start_tournament_competition"(
  "p_organization_id" "uuid",
  "p_tournament_id" "uuid"
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_tournament public.tournaments%rowtype;
  v_active_categories integer;
  v_categories_without_fixture integer;
  v_unscheduled integer;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  if not public.has_tournament_organization_capability(
    p_organization_id, 'tournaments.start'
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'torneos:competition-lifecycle:' || p_tournament_id::text, 0
  ));

  select tournament.* into v_tournament
  from public.tournaments tournament
  join public.tournament_organizations organization
    on organization.id = tournament.organization_id
    and organization.status = 'active'
  where tournament.id = p_tournament_id
    and tournament.organization_id = p_organization_id
  for update of tournament;

  if v_tournament.id is null then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;

  if v_tournament.status = 'active' then
    -- Idempotencia: repetir la operación sobre una competencia ya En juego no
    -- es un error y no reescribe `started_at`.
    return jsonb_build_object(
      'id', v_tournament.id,
      'status', v_tournament.status,
      'startedAt', v_tournament.started_at,
      'alreadyStarted', true,
      'unscheduledMatches', (
        select count(*)
        from public.tournament_matches match_row
        join public.tournament_fixture_versions fixture
          on fixture.id = match_row.fixture_version_id
          and fixture.status = 'published'
          and fixture.invalidated_at is null
        where match_row.tournament_id = v_tournament.id
          and match_row.scheduled_at is null
          and match_row.status <> 'cancelled'
      )
    );
  end if;

  if v_tournament.status <> 'scheduled' then
    raise exception using errcode = '22023',
      message = 'TORNEOS_INVALID_TOURNAMENT_TRANSITION';
  end if;

  select count(*) into v_active_categories
  from public.tournament_categories category
  where category.organization_id = p_organization_id
    and category.tournament_id = p_tournament_id
    and category.status = 'active';

  if v_active_categories = 0 then
    raise exception using errcode = '23514',
      message = 'TORNEOS_COMPETITION_WITHOUT_CATEGORIES';
  end if;

  select count(*) into v_categories_without_fixture
  from public.tournament_categories category
  where category.organization_id = p_organization_id
    and category.tournament_id = p_tournament_id
    and category.status = 'active'
    and not exists (
      select 1
      from public.tournament_fixture_versions fixture
      where fixture.organization_id = category.organization_id
        and fixture.tournament_id = category.tournament_id
        and fixture.category_id = category.id
        and fixture.status = 'published'
        and fixture.invalidated_at is null
    );

  if v_categories_without_fixture > 0 then
    raise exception using errcode = '23514',
      message = 'TORNEOS_COMPETITION_FIXTURE_NOT_PUBLISHED';
  end if;

  -- Los partidos sin horario no impiden comenzar: se programan después.
  select count(*) into v_unscheduled
  from public.tournament_matches match_row
  join public.tournament_fixture_versions fixture
    on fixture.id = match_row.fixture_version_id
    and fixture.status = 'published'
    and fixture.invalidated_at is null
  where match_row.tournament_id = p_tournament_id
    and match_row.scheduled_at is null
    and match_row.status <> 'cancelled';

  update public.tournaments
  set status = 'active',
      started_at = now()
  where id = p_tournament_id
  returning * into v_tournament;

  perform public.append_tournament_audit(
    p_organization_id, 'tournament.started', 'tournament', v_tournament.id,
    null, v_tournament.id,
    jsonb_build_object(
      'previousStatus', 'scheduled',
      'nextStatus', 'active',
      'activeCategories', v_active_categories,
      'unscheduledMatches', v_unscheduled
    )
  );

  return jsonb_build_object(
    'id', v_tournament.id,
    'status', v_tournament.status,
    'startedAt', v_tournament.started_at,
    'alreadyStarted', false,
    'unscheduledMatches', v_unscheduled
  );
end;
$$;

COMMENT ON FUNCTION "public"."start_tournament_competition"("uuid", "uuid") IS
  'Lista para comenzar -> En juego. Exige fixture publicado para todas las categorías activas y no exige programación completa.';

-- ---------------------------------------------------------------------------
-- 5. Finalizar competencia
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "public"."finish_tournament_competition"(
  "p_organization_id" "uuid",
  "p_tournament_id" "uuid"
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_tournament public.tournaments%rowtype;
  v_pending integer;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  if not public.has_tournament_organization_capability(
    p_organization_id, 'tournaments.finish'
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'torneos:competition-lifecycle:' || p_tournament_id::text, 0
  ));

  select tournament.* into v_tournament
  from public.tournaments tournament
  join public.tournament_organizations organization
    on organization.id = tournament.organization_id
    and organization.status = 'active'
  where tournament.id = p_tournament_id
    and tournament.organization_id = p_organization_id
  for update of tournament;

  if v_tournament.id is null then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;

  if v_tournament.status = 'completed' then
    return jsonb_build_object(
      'id', v_tournament.id,
      'status', v_tournament.status,
      'completedAt', v_tournament.completed_at,
      'alreadyCompleted', true,
      'pendingCommitments', 0
    );
  end if;

  if v_tournament.status <> 'active' then
    raise exception using errcode = '22023',
      message = 'TORNEOS_INVALID_TOURNAMENT_TRANSITION';
  end if;

  select count(*) into v_pending
  from public.tournament_competition_open_commitments(
    p_organization_id, p_tournament_id
  );

  if v_pending > 0 then
    raise exception using errcode = '55000',
      message = 'TORNEOS_COMPETITION_HAS_PENDING_COMMITMENTS',
      detail = v_pending::text;
  end if;

  update public.tournaments
  set status = 'completed',
      completed_at = now()
  where id = p_tournament_id
  returning * into v_tournament;

  perform public.append_tournament_audit(
    p_organization_id, 'tournament.finished', 'tournament', v_tournament.id,
    null, v_tournament.id,
    jsonb_build_object(
      'previousStatus', 'active',
      'nextStatus', 'completed'
    )
  );

  return jsonb_build_object(
    'id', v_tournament.id,
    'status', v_tournament.status,
    'completedAt', v_tournament.completed_at,
    'alreadyCompleted', false,
    'pendingCommitments', 0
  );
end;
$$;

COMMENT ON FUNCTION "public"."finish_tournament_competition"("uuid", "uuid") IS
  'En juego -> Finalizada. Acepta partidos cancelados de forma final, fechas libres por retiro, resultados administrativos y walkovers resueltos; rechaza compromisos realmente pendientes.';

-- ---------------------------------------------------------------------------
-- 6. Reabrir competencia
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "public"."reopen_tournament_competition"(
  "p_organization_id" "uuid",
  "p_tournament_id" "uuid",
  "p_reason" "text"
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_tournament public.tournaments%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  -- `tournaments.reopen` sólo la tiene el propietario.
  if not public.has_tournament_organization_capability(
    p_organization_id, 'tournaments.reopen'
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;
  if char_length(v_reason) not between 3 and 500 then
    raise exception using errcode = '22023', message = 'TORNEOS_REASON_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'torneos:competition-lifecycle:' || p_tournament_id::text, 0
  ));

  select tournament.* into v_tournament
  from public.tournaments tournament
  join public.tournament_organizations organization
    on organization.id = tournament.organization_id
    and organization.status = 'active'
  where tournament.id = p_tournament_id
    and tournament.organization_id = p_organization_id
  for update of tournament;

  if v_tournament.id is null then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;

  if v_tournament.status = 'active' then
    return jsonb_build_object(
      'id', v_tournament.id,
      'status', v_tournament.status,
      'reopenedAt', v_tournament.reopened_at,
      'reopenCount', v_tournament.reopen_count,
      'alreadyActive', true
    );
  end if;

  if v_tournament.status <> 'completed' then
    raise exception using errcode = '22023',
      message = 'TORNEOS_INVALID_TOURNAMENT_TRANSITION';
  end if;

  -- Reabrir no reconstruye fixture ni toca resultados: sólo devuelve
  -- capacidad operativa. `completed_at` se conserva como registro de la
  -- última finalización.
  update public.tournaments
  set status = 'active',
      reopened_at = now(),
      reopen_count = coalesce(reopen_count, 0) + 1
  where id = p_tournament_id
  returning * into v_tournament;

  perform public.append_tournament_audit(
    p_organization_id, 'tournament.reopened', 'tournament', v_tournament.id,
    null, v_tournament.id,
    jsonb_build_object(
      'previousStatus', 'completed',
      'nextStatus', 'active',
      'reason', v_reason,
      'reopenCount', v_tournament.reopen_count,
      'previouslyCompletedAt', v_tournament.completed_at
    )
  );

  return jsonb_build_object(
    'id', v_tournament.id,
    'status', v_tournament.status,
    'reopenedAt', v_tournament.reopened_at,
    'reopenCount', v_tournament.reopen_count,
    'alreadyActive', false
  );
end;
$$;

COMMENT ON FUNCTION "public"."reopen_tournament_competition"("uuid", "uuid", "text") IS
  'Finalizada -> En juego. Sólo propietario, con motivo obligatorio y auditoría. No reconstruye fixture ni modifica resultados.';

-- ---------------------------------------------------------------------------
-- 7. Retiro estructural de un equipo
-- ---------------------------------------------------------------------------
-- Orden transaccional: bloquear, validar, resolver los compromisos futuros
-- como fecha libre, auditar y recién al final marcar el retiro. Al revés, las
-- lecturas dejarían de encontrar los partidos del equipo.

CREATE OR REPLACE FUNCTION "public"."withdraw_tournament_competition_participant"(
  "p_organization_id" "uuid",
  "p_tournament_id" "uuid",
  "p_team_entry_id" "uuid",
  "p_reason_code" "text",
  "p_reason_text" "text" DEFAULT NULL::"text"
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_tournament public.tournaments%rowtype;
  v_participant public.tournament_competition_participants%rowtype;
  v_entry public.tournament_team_entries%rowtype;
  v_reason_code text := btrim(coalesce(p_reason_code, ''));
  v_reason_text text := nullif(btrim(coalesce(p_reason_text, '')), '');
  v_open_operations integer;
  v_match_ids uuid[];
  v_affected integer;
  v_preserved integer;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  if not public.has_tournament_organization_capability(
    p_organization_id, 'participants.withdraw'
  ) then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;
  if v_reason_code not in (
    'voluntary_resignation', 'sanction_exclusion', 'regulatory_breach', 'other'
  ) then
    raise exception using errcode = '22023',
      message = 'TORNEOS_WITHDRAWAL_REASON_INVALID';
  end if;
  if v_reason_code = 'other'
    and char_length(coalesce(v_reason_text, '')) < 3
  then
    raise exception using errcode = '22023',
      message = 'TORNEOS_WITHDRAWAL_NOTE_REQUIRED';
  end if;
  if char_length(coalesce(v_reason_text, '')) > 2000 then
    raise exception using errcode = '22023',
      message = 'TORNEOS_WITHDRAWAL_NOTE_TOO_LONG';
  end if;

  -- (1) Lock de competencia y participante.
  perform pg_advisory_xact_lock(hashtextextended(
    'torneos:competition-lifecycle:' || p_tournament_id::text, 0
  ));

  select tournament.* into v_tournament
  from public.tournaments tournament
  join public.tournament_organizations organization
    on organization.id = tournament.organization_id
    and organization.status = 'active'
  where tournament.id = p_tournament_id
    and tournament.organization_id = p_organization_id
  for update of tournament;

  if v_tournament.id is null then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;

  -- (2) El retiro estructural pertenece a una competencia ya consolidada:
  -- participantes congelados y fixture publicado.
  if v_tournament.status not in ('scheduled', 'active') then
    raise exception using errcode = '22023',
      message = 'TORNEOS_INVALID_TOURNAMENT_TRANSITION';
  end if;

  select entry.* into v_entry
  from public.tournament_team_entries entry
  where entry.id = p_team_entry_id
    and entry.organization_id = p_organization_id
    and entry.tournament_id = p_tournament_id
  for update;

  if v_entry.id is null then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;

  select participant.* into v_participant
  from public.tournament_competition_participants participant
  join public.tournament_fixture_versions fixture
    on fixture.organization_id = participant.organization_id
    and fixture.tournament_id = participant.tournament_id
    and fixture.category_id = participant.category_id
    and fixture.participant_set_id = participant.participant_set_id
    and fixture.status = 'published'
    and fixture.invalidated_at is null
  where participant.organization_id = p_organization_id
    and participant.tournament_id = p_tournament_id
    and participant.team_entry_id = p_team_entry_id
  order by participant.created_at desc
  limit 1
  for update of participant;

  if v_participant.id is null then
    raise exception using errcode = '42501',
      message = 'TORNEOS_PARTICIPANT_NOT_IN_COMPETITION';
  end if;

  if v_participant.status <> 'active' then
    raise exception using errcode = '55000',
      message = 'TORNEOS_PARTICIPANT_ALREADY_WITHDRAWN';
  end if;

  -- (3) Un acta abierta bloquea el retiro: cerrarla o anularla es una decisión
  -- deportiva del organizador, no algo que esta operación deba destruir.
  select count(*) into v_open_operations
  from public.tournament_match_operations operation
  join public.tournament_matches match_row
    on match_row.id = operation.match_id
  where match_row.tournament_id = p_tournament_id
    and (
      match_row.home_participant_id = v_participant.id
      or match_row.away_participant_id = v_participant.id
    )
    and operation.status in (
      'draft', 'submitted', 'under_review', 'validated', 'correction_requested'
    );

  if v_open_operations > 0 then
    raise exception using errcode = '55000',
      message = 'TORNEOS_PARTICIPANT_HAS_OPEN_OPERATIONS',
      detail = v_open_operations::text;
  end if;

  -- (4) Compromisos futuros todavía abiertos. Un partido con cualquier acta
  -- viva —oficial incluida— queda intacto: el pasado deportivo no se reescribe.
  select array_agg(match_row.id order by match_row.match_number)
  into v_match_ids
  from public.tournament_matches match_row
  join public.tournament_fixture_versions fixture
    on fixture.id = match_row.fixture_version_id
    and fixture.status = 'published'
    and fixture.invalidated_at is null
  where match_row.organization_id = p_organization_id
    and match_row.tournament_id = p_tournament_id
    and match_row.status <> 'cancelled'
    and (
      match_row.home_participant_id = v_participant.id
      or match_row.away_participant_id = v_participant.id
    )
    and not exists (
      select 1
      from public.tournament_match_operations operation
      where operation.match_id = match_row.id
        and operation.status not in ('superseded', 'voided')
    );

  v_affected := coalesce(array_length(v_match_ids, 1), 0);

  select count(*) into v_preserved
  from public.tournament_matches match_row
  where match_row.tournament_id = p_tournament_id
    and (
      match_row.home_participant_id = v_participant.id
      or match_row.away_participant_id = v_participant.id
    )
    and (v_match_ids is null or not (match_row.id = any(v_match_ids)));

  -- (5) Fecha libre estructural: el partido se conserva con sus dos equipos
  -- originales, en un estado terminal que no exige jugarse, no otorga puntos
  -- ni estadísticas y guarda la razón.
  if v_affected > 0 then
    update public.tournament_matches
    set status = 'cancelled',
        cancelled_at = now(),
        cancelled_by = auth.uid(),
        cancellation_reason_code = 'withdrawal_bye',
        cancellation_reason_text = left(
          coalesce(v_reason_text, 'Retiro del equipo durante la competencia.'), 500
        ),
        withdrawn_participant_id = v_participant.id
    where id = any(v_match_ids);
  end if;

  -- (6) Auditoría estructurada antes de tocar el participante.
  perform public.append_tournament_audit(
    p_organization_id, 'participant.withdrawn', 'competition_participant',
    v_participant.id, v_entry.id, p_tournament_id,
    jsonb_build_object(
      'teamEntryId', v_entry.id,
      'teamName', v_participant.snapshot_name,
      'categoryId', v_participant.category_id,
      'participantSetId', v_participant.participant_set_id,
      'previousParticipantStatus', v_participant.status,
      'previousEntryStatus', v_entry.status,
      'tournamentStatus', v_tournament.status,
      'reasonCode', v_reason_code,
      'reasonText', left(coalesce(v_reason_text, ''), 2000),
      'affectedMatchCount', v_affected,
      'preservedMatchCount', v_preserved,
      'affectedMatchIds', to_jsonb(coalesce(v_match_ids[1:50], array[]::uuid[]))
    )
  );

  -- (7) Recién ahora se marca el retiro.
  update public.tournament_competition_participants
  set status = 'withdrawn',
      withdrawn_at = now(),
      withdrawn_by = auth.uid(),
      withdrawal_reason_code = v_reason_code,
      withdrawal_reason_text = v_reason_text
  where id = v_participant.id
  returning * into v_participant;

  if v_entry.status = 'approved' then
    update public.tournament_team_entries
    set status = 'withdrawn',
        withdrawn_at = now(),
        updated_at = now()
    where id = v_entry.id;
  end if;

  return jsonb_build_object(
    'participantId', v_participant.id,
    'teamEntryId', v_entry.id,
    'status', v_participant.status,
    'reasonCode', v_reason_code,
    'withdrawnAt', v_participant.withdrawn_at,
    'byeMatchCount', v_affected,
    'preservedMatchCount', v_preserved,
    'byeMatchIds', to_jsonb(coalesce(v_match_ids, array[]::uuid[]))
  );
end;
$$;

COMMENT ON FUNCTION "public"."withdraw_tournament_competition_participant"("uuid", "uuid", "uuid", "text", "text") IS
  'Retiro estructural de un equipo. No hay reemplazo. Los partidos ya disputados se conservan; los compromisos futuros quedan como fecha libre por retiro, sin puntos ni estadísticas. El participante sigue existiendo para la tabla y el historial.';

-- ---------------------------------------------------------------------------
-- 8. El participante retirado sigue existiendo para lecturas e historial
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "public"."tournament_match_team_entries"("p_match_id" "uuid")
  RETURNS TABLE("home_team_entry_id" "uuid", "away_team_entry_id" "uuid")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select home_participant.team_entry_id, away_participant.team_entry_id
  from public.tournament_matches match_row
  join public.tournament_fixture_versions fixture
    on fixture.id = match_row.fixture_version_id
  join public.tournament_competition_participants home_participant
    on home_participant.id = match_row.home_participant_id
    and home_participant.participant_set_id = match_row.participant_set_id
  join public.tournament_competition_participants away_participant
    on away_participant.id = match_row.away_participant_id
    and away_participant.participant_set_id = match_row.participant_set_id
  where match_row.id = p_match_id
    and fixture.status = 'published'
    and fixture.invalidated_at is null
    and home_participant.status in ('active', 'withdrawn')
    and away_participant.status in ('active', 'withdrawn');
$$;

COMMENT ON FUNCTION "public"."tournament_match_team_entries"("uuid") IS
  'Equipos de un partido del fixture publicado. Incluye participantes retirados: qué equipos integraban el enfrentamiento es un hecho estructural que el retiro no borra. Quién puede operar el partido lo deciden los guards de cada operación.';

-- ---------------------------------------------------------------------------
-- 9. Endurecimiento de `administrative_result`
-- ---------------------------------------------------------------------------
-- Ningún resultado puramente administrativo puede crear ni contar
-- estadísticas individuales ficticias.

do $administrative_result_hardening$
declare
  v_source text;
  v_new text;
begin
  select pg_get_functiondef(oid) into v_source
  from pg_proc
  where proname = 'validate_tournament_match_operation_payload'
    and pronamespace = 'public'::regnamespace;

  if v_source is null then
    raise exception 'validate_tournament_match_operation_payload not found';
  end if;

  v_new := replace(
    v_source,
    $old$  if v_outcome.outcome_type in (
    'walkover_home', 'walkover_away',
    'home_no_show', 'away_no_show', 'double_no_show'
  )
    and v_outcome.counts_for_player_stats
  then
    v_errors := v_errors || jsonb_build_array('walkover_player_stats_forbidden');
  end if;$old$,
    $new$  if v_outcome.outcome_type in (
    'walkover_home', 'walkover_away',
    'home_no_show', 'away_no_show', 'double_no_show',
    'administrative_result',
    'postponed_before_start', 'cancelled', 'not_played'
  )
    and v_outcome.counts_for_player_stats
  then
    v_errors := v_errors || jsonb_build_array('walkover_player_stats_forbidden');
  end if;$new$
  );

  if v_new = v_source
    and position('''administrative_result'',' in v_source) = 0
  then
    raise exception 'player stats guard anchor not found in validate_tournament_match_operation_payload';
  end if;

  v_source := v_new;
  v_new := replace(
    v_source,
    $old$  if v_outcome.outcome_type in (
    'postponed_before_start', 'cancelled', 'not_played',
    'walkover_home', 'walkover_away',
    'home_no_show', 'away_no_show', 'double_no_show'
  ) and exists ($old$,
    $new$  if v_outcome.outcome_type in (
    'postponed_before_start', 'cancelled', 'not_played',
    'walkover_home', 'walkover_away', 'administrative_result',
    'home_no_show', 'away_no_show', 'double_no_show'
  ) and exists ($new$
  );

  if v_new = v_source
    and position('''walkover_away'', ''administrative_result''' in v_source) = 0
  then
    raise exception 'events guard anchor not found in validate_tournament_match_operation_payload';
  end if;

  execute v_new;
end;
$administrative_result_hardening$;

COMMENT ON FUNCTION "public"."validate_tournament_match_operation_payload"("uuid") IS
  'Validación del acta. Ningún resultado puramente administrativo —walkover, no presentación o `administrative_result`— puede registrar eventos individuales ni contar para estadísticas de jugador.';

-- ---------------------------------------------------------------------------
-- 10. La tabla conserva al equipo retirado
-- ---------------------------------------------------------------------------

do $standings_keep_withdrawn$
declare
  v_source text;
  v_new text;
begin
  select pg_get_functiondef(oid) into v_source
  from pg_proc
  where proname = 'rebuild_tournament_standings'
    and pronamespace = 'public'::regnamespace;

  if v_source is null then
    raise exception 'rebuild_tournament_standings not found';
  end if;

  v_new := replace(
    v_source,
    $old$    from public.tournament_competition_participants participant
    where participant.participant_set_id = v_fixture.participant_set_id
      and participant.status = 'active'$old$,
    $new$    from public.tournament_competition_participants participant
    where participant.participant_set_id = v_fixture.participant_set_id
      and participant.status in ('active', 'withdrawn')$new$
  );

  if v_new = v_source
    and position('status in (''active'', ''withdrawn'')' in v_source) = 0
  then
    raise exception 'participants anchor not found in rebuild_tournament_standings';
  end if;

  execute v_new;
end;
$standings_keep_withdrawn$;

COMMENT ON FUNCTION "public"."rebuild_tournament_standings"("uuid", "uuid", "uuid", "uuid", "uuid", "text", "uuid") IS
  'Recalcula la tabla. Conserva a los equipos retirados con el récord que obtuvieron antes del retiro: las fechas libres no suman partidos jugados, puntos ni goles a nadie.';

-- ---------------------------------------------------------------------------
-- 11. Finalizada y Archivada = read-only operacional
-- ---------------------------------------------------------------------------
-- Guard transversal: cubre todas las RPC competitivas sin reescribir cada una,
-- y no toca lecturas, página pública, tabla, estadísticas ni recálculos
-- derivados, que siguen operando sobre datos ya existentes.

-- SECURITY DEFINER a propósito: el guard tiene que poder resolver el estado de
-- la competencia siempre. Si dependiera de la visibilidad del invocante, una
-- fila oculta por RLS devolvería NULL y el guard fallaría abierto.
CREATE OR REPLACE FUNCTION "public"."protect_tournament_completed_competition"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_row jsonb;
  v_tournament_id uuid;
  v_match_id uuid;
  v_operation_id uuid;
  v_status text;
begin
  v_row := coalesce(to_jsonb(new), to_jsonb(old));
  v_tournament_id := nullif(v_row->>'tournament_id', '')::uuid;

  if v_tournament_id is null then
    v_match_id := nullif(v_row->>'match_id', '')::uuid;
    if v_match_id is not null then
      select match_row.tournament_id into v_tournament_id
      from public.tournament_matches match_row
      where match_row.id = v_match_id;
    end if;
  end if;

  if v_tournament_id is null then
    v_operation_id := nullif(v_row->>'match_operation_id', '')::uuid;
    if v_operation_id is not null then
      select operation.tournament_id into v_tournament_id
      from public.tournament_match_operations operation
      where operation.id = v_operation_id;
    end if;
  end if;

  if v_tournament_id is null then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  select tournament.status into v_status
  from public.tournaments tournament
  where tournament.id = v_tournament_id;

  if v_status in ('completed', 'archived') then
    raise exception using errcode = '55000',
      message = 'TORNEOS_COMPETITION_READ_ONLY';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

COMMENT ON FUNCTION "public"."protect_tournament_completed_competition"() IS
  'Una competencia Finalizada o Archivada no admite operaciones competitivas mutables. Las lecturas, la página pública y los recálculos derivados sobre datos existentes siguen disponibles. Para corregir algo hay que reabrir la competencia.';

CREATE OR REPLACE TRIGGER "tournament_matches_completed_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "public"."tournament_matches"
  FOR EACH ROW EXECUTE FUNCTION "public"."protect_tournament_completed_competition"();

CREATE OR REPLACE TRIGGER "tournament_match_operations_completed_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "public"."tournament_match_operations"
  FOR EACH ROW EXECUTE FUNCTION "public"."protect_tournament_completed_competition"();

CREATE OR REPLACE TRIGGER "tournament_match_events_completed_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "public"."tournament_match_events"
  FOR EACH ROW EXECUTE FUNCTION "public"."protect_tournament_completed_competition"();

CREATE OR REPLACE TRIGGER "tournament_match_outcomes_completed_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "public"."tournament_match_outcomes"
  FOR EACH ROW EXECUTE FUNCTION "public"."protect_tournament_completed_competition"();

CREATE OR REPLACE TRIGGER "tournament_match_scores_completed_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "public"."tournament_match_scores"
  FOR EACH ROW EXECUTE FUNCTION "public"."protect_tournament_completed_competition"();

CREATE OR REPLACE TRIGGER "tournament_match_squads_completed_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "public"."tournament_match_squads"
  FOR EACH ROW EXECUTE FUNCTION "public"."protect_tournament_completed_competition"();

CREATE OR REPLACE TRIGGER "tournament_match_operation_players_completed_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "public"."tournament_match_operation_players"
  FOR EACH ROW EXECUTE FUNCTION "public"."protect_tournament_completed_competition"();

CREATE OR REPLACE TRIGGER "tournament_match_reviews_completed_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "public"."tournament_match_reviews"
  FOR EACH ROW EXECUTE FUNCTION "public"."protect_tournament_completed_competition"();

CREATE OR REPLACE TRIGGER "tournament_match_reschedules_completed_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "public"."tournament_match_reschedules"
  FOR EACH ROW EXECUTE FUNCTION "public"."protect_tournament_completed_competition"();

-- ---------------------------------------------------------------------------
-- 12. La cancelación manual guarda su motivo y no se confunde con fecha libre
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "public"."cancel_tournament_match"("p_organization_id" "uuid", "p_match_id" "uuid", "p_reason" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_match public.tournament_matches%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if auth.uid() is null or char_length(v_reason) not between 3 and 500
    or not public.has_tournament_organization_capability(
      p_organization_id, 'matches.cancel'
    )
  then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;
  select match_row.* into v_match
  from public.tournament_matches match_row
  join public.tournament_fixture_versions version
    on version.id = match_row.fixture_version_id
    and version.status in ('draft', 'published')
    and version.invalidated_at is null
  where match_row.id = p_match_id
    and match_row.organization_id = p_organization_id
    and match_row.status in ('scheduled', 'postponed')
  for update of match_row;
  if v_match.id is null then
    raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN';
  end if;
  update public.tournament_matches
  set status = 'cancelled',
      cancelled_at = now(),
      cancelled_by = auth.uid(),
      cancellation_reason_code = 'manual_cancellation',
      cancellation_reason_text = v_reason
  where id = v_match.id;
  perform public.append_tournament_audit(
    p_organization_id, 'match.cancelled', 'match', v_match.id,
    null, v_match.tournament_id,
    jsonb_build_object(
      'reason', v_reason, 'previousStatus',
      v_match.status, 'reasonCode', 'manual_cancellation'
    )
  );
  return jsonb_build_object('matchId', v_match.id, 'status', 'cancelled');
end;
$$;

-- ---------------------------------------------------------------------------
-- 13. La baja aislada de inscripción vuelve a su etapa
-- ---------------------------------------------------------------------------
-- Después de publicar el fixture, los participantes están congelados y el
-- fixture depende de ellos: retirar sólo la inscripción dejaba entrada,
-- participante y superficies públicas divergentes. Desde ahí el camino
-- soportado es `withdraw_tournament_competition_participant`.
-- Además, un `assistant` deja de poder dar de baja al equipo.

CREATE OR REPLACE FUNCTION "public"."withdraw_tournament_team_entry"("p_organization_id" "uuid", "p_team_entry_id" "uuid", "p_reason" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare v_entry public.tournament_team_entries%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'TORNEOS_AUTH_REQUIRED';
  end if;
  select * into v_entry from public.tournament_team_entries
  where id = p_team_entry_id and organization_id = p_organization_id for update;
  if v_entry.id is null or v_entry.status not in ('draft','invited','in_progress','changes_requested','approved')
    or not (
      public.has_tournament_organization_capability(p_organization_id, 'team_entries.withdraw')
      or exists (
        select 1
        from public.tournament_team_managers manager
        where manager.team_entry_id = v_entry.id
          and manager.organization_id = v_entry.organization_id
          and manager.user_id = auth.uid()
          and manager.status = 'active'
          and manager.role in ('captain', 'delegate')
      )
    )
    or not exists (
      select 1
      from public.tournaments tournament
      join public.tournament_categories category
        on category.organization_id = tournament.organization_id
        and category.tournament_id = tournament.id
      where tournament.id = v_entry.tournament_id
        and tournament.organization_id = p_organization_id
        and tournament.status in ('draft', 'registration')
        and category.id = v_entry.category_id
        and category.status = 'active'
    )
  then raise exception using errcode = '42501', message = 'TORNEOS_RESOURCE_FORBIDDEN'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception using errcode = '22023', message = 'TORNEOS_REASON_REQUIRED';
  end if;
  update public.tournament_team_entries set status = 'withdrawn', withdrawn_at = now()
  where id = v_entry.id returning * into v_entry;
  perform public.append_tournament_audit(
    p_organization_id, 'team_entry.withdrawn', 'team_entry', v_entry.id,
    v_entry.id, v_entry.tournament_id, jsonb_build_object('reason', left(btrim(p_reason), 240))
  );
  return jsonb_build_object('entryId', v_entry.id, 'status', v_entry.status);
end;
$$;

COMMENT ON FUNCTION "public"."withdraw_tournament_team_entry"("uuid", "uuid", "text") IS
  'Baja de una inscripción durante la etapa de preparación. Una vez publicado el fixture el camino soportado es withdraw_tournament_competition_participant, que resuelve fixture, partidos y tabla en una sola transacción.';

-- ---------------------------------------------------------------------------
-- 14. Las lecturas cuentan la fecha libre y el equipo retirado
-- ---------------------------------------------------------------------------
-- Sin esto la interfaz vería un partido "cancelado" indistinguible y un equipo
-- retirado sin marca en la tabla.

do $expose_lifecycle_reads$
declare
  v_patch record;
  v_source text;
  v_new text;
begin
  for v_patch in
    select *
    from (values
      (
        'get_tournament_fixture_context',
        $anchor$        'status', match_row.status, 'scheduledAt', match_row.scheduled_at,$anchor$,
        $patched$        'status', match_row.status, 'scheduledAt', match_row.scheduled_at,
        'cancellationReasonCode', match_row.cancellation_reason_code,
        'cancellationReasonText', match_row.cancellation_reason_text,
        'withdrawnParticipantId', match_row.withdrawn_participant_id,$patched$
      ),
      (
        'get_tournament_match_operations_context',
        $anchor$          'planningStatus', match_row.status,
          'venue', venue.name,$anchor$,
        $patched$          'planningStatus', match_row.status,
          'cancellationReasonCode', match_row.cancellation_reason_code,
          'cancellationReasonText', match_row.cancellation_reason_text,
          'withdrawnParticipantId', match_row.withdrawn_participant_id,
          'venue', venue.name,$patched$
      ),
      (
        'get_tournament_standings_context',
        $anchor$        'teamEntryId', standing.team_entry_id, 'teamName', participant.snapshot_name,$anchor$,
        $patched$        'teamEntryId', standing.team_entry_id, 'teamName', participant.snapshot_name,
        'participantStatus', participant.status,
        'withdrawnAt', participant.withdrawn_at,
        'withdrawalReasonCode', participant.withdrawal_reason_code,$patched$
      )
    ) as patch(function_name, anchor, patched)
  loop
    select pg_get_functiondef(oid) into v_source
    from pg_proc
    where proname = v_patch.function_name
      and pronamespace = 'public'::regnamespace;

    if v_source is null then
      raise exception 'function % not found', v_patch.function_name;
    end if;

    v_new := replace(v_source, v_patch.anchor, v_patch.patched);

    if v_new = v_source then
      if position(v_patch.patched in v_source) = 0 then
        raise exception 'anchor not found in %', v_patch.function_name;
      end if;
      continue;
    end if;

    execute v_new;
  end loop;
end;
$expose_lifecycle_reads$;

-- ---------------------------------------------------------------------------
-- 15. Superficie ejecutable
-- ---------------------------------------------------------------------------
-- Las cuatro operaciones nuevas son de cliente autenticado. El predicado de
-- compromisos abiertos queda como helper interno: se consume desde las RPC
-- SECURITY DEFINER, no desde el navegador.

REVOKE ALL ON FUNCTION "public"."start_tournament_competition"("uuid", "uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."finish_tournament_competition"("uuid", "uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."reopen_tournament_competition"("uuid", "uuid", "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."withdraw_tournament_competition_participant"("uuid", "uuid", "uuid", "text", "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."tournament_competition_open_commitments"("uuid", "uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."protect_tournament_completed_competition"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."start_tournament_competition"("uuid", "uuid") TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."start_tournament_competition"("uuid", "uuid") TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."finish_tournament_competition"("uuid", "uuid") TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."finish_tournament_competition"("uuid", "uuid") TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."reopen_tournament_competition"("uuid", "uuid", "text") TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."reopen_tournament_competition"("uuid", "uuid", "text") TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."withdraw_tournament_competition_participant"("uuid", "uuid", "uuid", "text", "text") TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."withdraw_tournament_competition_participant"("uuid", "uuid", "uuid", "text", "text") TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."tournament_competition_open_commitments"("uuid", "uuid") TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."protect_tournament_completed_competition"() TO "service_role";
