-- ==========================================================================
-- DRY-RUN DE SOLO LECTURA — residuo historico de "Dejar de buscar"
--
-- Este archivo NO forma parte de ninguna migracion y NO crea ninguna funcion
-- en la base. Es SQL de inspeccion para correr a mano contra Produccion antes
-- de decidir cualquier limpieza.
--
-- Garantias del archivo:
--   * solo hay sentencias SELECT (y el SET TRANSACTION READ ONLY de abajo);
--   * no hay CREATE, DROP, ALTER, INSERT, UPDATE, DELETE, TRUNCATE, GRANT ni
--     REVOKE;
--   * no se invoca ninguna funcion de la aplicacion. Los predicados de
--     elegibilidad, capacidad y minimo estan INLINE, copiados de
--     auto_match_account_is_eligible (20260714030000),
--     auto_match_invitation_capacity y auto_match_min_candidates
--     (20260712220000), para que el archivo se pueda auditar solo;
--   * la transaccion se marca READ ONLY: si por error se colara una escritura,
--     PostgreSQL la rechaza.
--
-- Uso:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f scripts/auto-match-stop-search/readonly_dry_run.sql
--
-- Los bloques marcados "requiere: pg_cron" solo funcionan donde la extension
-- este instalada; en el resto devuelven vacio en lugar de fallar.
-- ==========================================================================

begin;
set transaction read only;

\echo '================ 1. Extension pg_cron ================'
-- Estado de la extension: si esta instalada, en que schema y con que version.
select
  e.extname                                  as extension,
  n.nspname                                  as schema,
  e.extversion                               as version,
  true                                       as installed
from pg_extension e
join pg_namespace n on n.oid = e.extnamespace
where e.extname = 'pg_cron'
union all
select 'pg_cron', null, null, false
where not exists (select 1 from pg_extension where extname = 'pg_cron');


\echo '================ 2. Job auto_match_sweep (requiere: pg_cron) ================'
-- Existencia, nombre, schedule, comando y estado activo del job.
-- El to_regclass evita el error si cron.job no existe.
select
  j.jobid,
  j.jobname,
  j.schedule,
  j.command,
  j.active,
  j.nodename,
  j.database,
  j.username
from cron.job j
where to_regclass('cron.job') is not null
order by j.jobid;


\echo '================ 3. Ultimas ejecuciones del job (requiere: pg_cron) ================'
-- Las 20 corridas mas recientes con su estado y duracion.
select
  d.jobid,
  j.jobname,
  d.runid,
  d.status,
  d.return_message,
  d.start_time,
  d.end_time,
  d.end_time - d.start_time as duration
from cron.job_run_details d
left join cron.job j on j.jobid = d.jobid
where to_regclass('cron.job_run_details') is not null
order by d.start_time desc
limit 20;


-- ==========================================================================
-- COHORTE ANALIZADA (definicion unica, reutilizada por los bloques 4 a 12)
--
-- Membresias que HOY ocupan cupo:
--   * pending/accepted sobre una gestacion viva y no vencida, o
--   * pending sobre un partido ya creado y todavia futuro,
-- cuyo dueno ya no deberia estar ahi:
--   * account_ineligible  -> cuenta borrada o baneada;
--   * orphan_availability -> sin ninguna player_availability activa, que es el
--                            residuo exacto del bug de "Dejar de buscar".
--
-- Un 'accepted' sobre una propuesta 'created' NUNCA entra: ese jugador
-- pertenece al partido real.
-- ==========================================================================

\echo '================ 4. Membresias inelegibles y huerfanas — totales ================'
with candidates as (
  select
    m.proposal_id,
    m.user_id,
    m.response,
    p.status as proposal_status,
    not exists (
      select 1 from auth.users au
      where au.id = m.user_id
        and au.deleted_at is null
        and (au.banned_until is null or au.banned_until <= now())
    ) as account_ineligible,
    not exists (
      select 1 from public.player_availability a
      where a.user_id = m.user_id and a.status = 'active'
    ) as orphan_availability
  from public.auto_match_proposal_members m
  join public.auto_match_proposals p on p.id = m.proposal_id
  where (
      (p.status in ('collecting', 'ready') and m.response in ('pending', 'accepted') and p.expires_at > now())
      or (p.status = 'created' and m.response = 'pending' and p.proposed_starts_at > now())
    )
    and (
      not exists (
        select 1 from auth.users au
        where au.id = m.user_id
          and au.deleted_at is null
          and (au.banned_until is null or au.banned_until <= now())
      )
      or not exists (
        select 1 from public.player_availability a
        where a.user_id = m.user_id and a.status = 'active'
      )
    )
)
select
  count(*)                                                              as memberships_total,
  count(*) filter (where account_ineligible)                            as account_ineligible_total,
  count(*) filter (where orphan_availability)                           as orphan_availability_total,
  count(*) filter (where orphan_availability and not account_ineligible) as orphan_availability_only,
  count(distinct user_id)                                               as distinct_users,
  count(distinct proposal_id)                                           as distinct_proposals
from candidates;


\echo '================ 5. Distribucion por estado del MIEMBRO ================'
with candidates as (
  select m.response, p.status as proposal_status
  from public.auto_match_proposal_members m
  join public.auto_match_proposals p on p.id = m.proposal_id
  where (
      (p.status in ('collecting', 'ready') and m.response in ('pending', 'accepted') and p.expires_at > now())
      or (p.status = 'created' and m.response = 'pending' and p.proposed_starts_at > now())
    )
    and (
      not exists (
        select 1 from auth.users au
        where au.id = m.user_id and au.deleted_at is null
          and (au.banned_until is null or au.banned_until <= now())
      )
      or not exists (
        select 1 from public.player_availability a
        where a.user_id = m.user_id and a.status = 'active'
      )
    )
)
select response as member_response, count(*) as memberships
from candidates
group by response
order by 1;


\echo '================ 6. Distribucion por estado de PROPUESTA ================'
with candidates as (
  select m.user_id, p.status as proposal_status
  from public.auto_match_proposal_members m
  join public.auto_match_proposals p on p.id = m.proposal_id
  where (
      (p.status in ('collecting', 'ready') and m.response in ('pending', 'accepted') and p.expires_at > now())
      or (p.status = 'created' and m.response = 'pending' and p.proposed_starts_at > now())
    )
    and (
      not exists (
        select 1 from auth.users au
        where au.id = m.user_id and au.deleted_at is null
          and (au.banned_until is null or au.banned_until <= now())
      )
      or not exists (
        select 1 from public.player_availability a
        where a.user_id = m.user_id and a.status = 'active'
      )
    )
)
select proposal_status, count(*) as memberships
from candidates
group by proposal_status
order by 1;


-- ==========================================================================
-- IMPACTO POR PROPUESTA (bloques 7 a 12)
--
-- "Activo" usa el mismo predicado que el backend:
--   response not in ('declined','expired','waitlisted').
-- capacity = ceil(max_players * 1.5)  [auto_match_invitation_capacity]
-- minimo de compatibles = 4           [auto_match_min_candidates]
-- ==========================================================================

\echo '================ 7. Propuestas afectadas, por estado ================'
with candidates as (
  select m.proposal_id, m.user_id
  from public.auto_match_proposal_members m
  join public.auto_match_proposals p on p.id = m.proposal_id
  where (
      (p.status in ('collecting', 'ready') and m.response in ('pending', 'accepted') and p.expires_at > now())
      or (p.status = 'created' and m.response = 'pending' and p.proposed_starts_at > now())
    )
    and (
      not exists (
        select 1 from auth.users au
        where au.id = m.user_id and au.deleted_at is null
          and (au.banned_until is null or au.banned_until <= now())
      )
      or not exists (
        select 1 from public.player_availability a
        where a.user_id = m.user_id and a.status = 'active'
      )
    )
)
select p.status as proposal_status, count(distinct p.id) as proposals_affected
from public.auto_match_proposals p
where exists (select 1 from candidates c where c.proposal_id = p.id)
group by p.status
order by 1;


\echo '================ 8..12. Impacto detallado por propuesta ================'
-- Un solo calculo del impacto; los bloques 9 a 12 lo resumen.
with candidates as (
  select m.proposal_id, m.user_id
  from public.auto_match_proposal_members m
  join public.auto_match_proposals p on p.id = m.proposal_id
  where (
      (p.status in ('collecting', 'ready') and m.response in ('pending', 'accepted') and p.expires_at > now())
      or (p.status = 'created' and m.response = 'pending' and p.proposed_starts_at > now())
    )
    and (
      not exists (
        select 1 from auth.users au
        where au.id = m.user_id and au.deleted_at is null
          and (au.banned_until is null or au.banned_until <= now())
      )
      or not exists (
        select 1 from public.player_availability a
        where a.user_id = m.user_id and a.status = 'active'
      )
    )
),
impact as (
  select
    p.id                            as proposal_id,
    p.status                        as proposal_status,
    p.format,
    p.max_players,
    p.partido_id,
    ceil(p.max_players * 1.5)::int  as capacity,
    count(*) filter (where m.response not in ('declined','expired','waitlisted'))          as active_before,
    count(*) filter (where c.user_id is not null)                                          as removed,
    count(*) filter (where m.response = 'accepted')                                        as accepted_before,
    count(*) filter (where c.user_id is not null and m.response = 'accepted')              as removed_accepted
  from public.auto_match_proposals p
  join public.auto_match_proposal_members m on m.proposal_id = p.id
  left join candidates c on c.proposal_id = m.proposal_id and c.user_id = m.user_id
  where exists (select 1 from candidates c2 where c2.proposal_id = p.id)
  group by p.id, p.status, p.format, p.max_players, p.partido_id
)
select
  proposal_id,
  proposal_status,
  format,
  max_players,
  capacity,
  partido_id,
  active_before,
  removed,
  active_before - removed                       as active_after,
  accepted_before,
  accepted_before - removed_accepted            as accepted_after,
  (active_before - removed) < 4                 as would_fall_below_minimum,
  (proposal_status = 'ready'
     and (accepted_before - removed_accepted) < max_players) as would_return_to_collecting
from impact
order by proposal_id;


\echo '================ 9. Resumen: ready -> collecting, bajo minimo, created relacionadas, notificaciones ================'
with candidates as (
  select m.proposal_id, m.user_id
  from public.auto_match_proposal_members m
  join public.auto_match_proposals p on p.id = m.proposal_id
  where (
      (p.status in ('collecting', 'ready') and m.response in ('pending', 'accepted') and p.expires_at > now())
      or (p.status = 'created' and m.response = 'pending' and p.proposed_starts_at > now())
    )
    and (
      not exists (
        select 1 from auth.users au
        where au.id = m.user_id and au.deleted_at is null
          and (au.banned_until is null or au.banned_until <= now())
      )
      or not exists (
        select 1 from public.player_availability a
        where a.user_id = m.user_id and a.status = 'active'
      )
    )
),
impact as (
  select
    p.id                            as proposal_id,
    p.status                        as proposal_status,
    p.max_players,
    p.partido_id,
    ceil(p.max_players * 1.5)::int  as capacity,
    count(*) filter (where m.response not in ('declined','expired','waitlisted'))
      - count(*) filter (where c.user_id is not null)                            as active_after,
    count(*) filter (where m.response = 'accepted')
      - count(*) filter (where c.user_id is not null and m.response = 'accepted') as accepted_after
  from public.auto_match_proposals p
  join public.auto_match_proposal_members m on m.proposal_id = p.id
  left join candidates c on c.proposal_id = m.proposal_id and c.user_id = m.user_id
  where exists (select 1 from candidates c2 where c2.proposal_id = p.id)
  group by p.id, p.status, p.max_players, p.partido_id
)
select
  -- Propuestas 'ready' que dejarian de estar completas y volverian a collecting.
  count(*) filter (
    where proposal_status = 'ready' and accepted_after < max_players
  )                                                             as proposals_ready_to_collecting,

  -- Propuestas vivas que quedarian por debajo del minimo de 4 compatibles.
  count(*) filter (
    where proposal_status in ('collecting','ready') and active_after < 4
  )                                                             as proposals_below_minimum,

  -- Propuestas 'created' relacionadas (invitaciones pendientes en la cohorte).
  count(*) filter (where proposal_status = 'created')            as proposals_created_related,
  count(distinct partido_id) filter (
    where proposal_status = 'created' and partido_id is not null
  )                                                             as related_real_matches,

  -- COTA SUPERIOR de notificaciones. Una limpieza sobre una gestacion viva
  -- pasa por process_auto_match_member_exit -> backfill, que emite como maximo
  -- una notificacion por lugar repuesto. Cuantos se repongan de verdad depende
  -- de que existan compatibles disponibles en ese momento, asi que el numero
  -- real es <= a este. Al miembro retirado no se le notifica nada.
  coalesce(sum(greatest(0, capacity - active_after)) filter (
    where proposal_status in ('collecting','ready')
  ), 0)                                                          as notifications_upper_bound
from impact;


\echo '================ 10. Contexto: membresias equivalentes sobre propuestas ya vencidas ================'
-- Fuera del alcance de cualquier limpieza: no ocupan cupo de nada vivo.
select count(*) as memberships_on_stale_proposals
from public.auto_match_proposal_members m
join public.auto_match_proposals p on p.id = m.proposal_id
where m.response in ('pending', 'accepted')
  and (
    (p.status in ('collecting', 'ready') and p.expires_at <= now())
    or (p.status = 'created' and p.proposed_starts_at <= now())
    or p.status in ('cancelled', 'expired')
  );

commit;
