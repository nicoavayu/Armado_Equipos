-- Core: a match's access code never reaches a public read.
--
-- Checked on the shared rehearsal lab (2026-10-08): an account unrelated to a match that is
-- published looking for players read its codigo from partidos (20261010136000 kept those
-- rows readable from the table), and with that code, without a session:
--   * public_submit_player_rating stored a rating as a guest of the roster (the code is the
--     whole credential of link voting; issue-voting-photo-token also takes it to replace a
--     guest's photo);
--   * public_get_match_by_code returned the full match row and the full roster.
-- (Joining needs the guest invite token too; no admin action or private data came with it.)
-- So the code is a credential and must only reach people involved in the match:
--   * partidos (table, realtime): visible only to those involved — organizer/admin (checked
--     on the row), roster, join requests, notifications. Published matches are no longer
--     returned by the table to others;
--   * partidos_view and partidos_abiertos_operativos(_v2) keep showing published matches
--     to signed-in accounts, with the code masked (app_private.match_access_code). They now
--     read the tables as core_match_public_reader (no login, no other privileges), whose
--     own policies allow exactly: involved, or published looking for players — instead of
--     inheriting the table rule;
--   * partidos_view gains busca_arquero and player_invites_enabled, so no app falls back to
--     reading those flags from the table (installed apps did for published matches).
-- Rosters of published matches stay readable from jugadores (no private personal data in
-- that table; installed apps list them on the public match page).

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'core_match_public_reader') then
    create role core_match_public_reader nologin noinherit;
  end if;
end;
$$;
-- The migration role must be able to hand the views to it (ALTER … OWNER TO).
grant core_match_public_reader to current_user;

-- The signed-in account as auth.uid() reads it, without needing the auth schema.
create or replace function app_private.request_user_id()
returns uuid
language sql
stable
set search_path to ''
as $function$
  select nullif(
    coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
    ),
    ''
  )::uuid
$function$;

grant usage on schema public, app_private to core_match_public_reader;
grant select on table public.partidos, public.jugadores to core_match_public_reader;
grant execute on function app_private.request_user_id() to core_match_public_reader, authenticated;
grant execute on function public.partido_kickoff_at(date, text) to core_match_public_reader;
grant execute on function public.normalize_partido_estado(text) to core_match_public_reader;
grant execute on function public.partido_is_operationally_open(text, timestamp with time zone, text, text, timestamp with time zone, date, text, boolean, timestamp with time zone) to core_match_public_reader;
grant execute on function app_private.match_access_code(bigint) to core_match_public_reader;
grant execute on function app_private.match_involves_user(bigint, uuid) to core_match_public_reader;
grant execute on function app_private.match_is_publicly_open(bigint) to core_match_public_reader;
-- A function inside a view (its WHERE, or a policy the view owner applies) is still
-- executed with the CALLER's EXECUTE privilege. anon keeps SELECT on these views (installed
-- apps read partidos_view on the public match page): without these grants that read fails
-- with "permission denied for function partido_is_operationally_open" instead of returning
-- no rows, which is what anon gets (the reader's policies require a signed-in caller).
-- Before, anon met no policy at all, the planner folded the scan to false and never
-- reached the functions. All of these only compute on their arguments or answer for the
-- signed-in caller; app_private is not exposed by the API.
grant execute on function public.partido_kickoff_at(date, text) to anon;
grant execute on function public.normalize_partido_estado(text) to anon;
grant execute on function public.partido_is_operationally_open(text, timestamp with time zone, text, text, timestamp with time zone, date, text, boolean, timestamp with time zone) to anon;
grant execute on function app_private.request_user_id() to anon;
grant execute on function app_private.match_involves_user(bigint, uuid) to anon;
grant execute on function app_private.match_is_publicly_open(bigint) to anon;

-- The reader's own view of the rows: a signed-in caller involved in the match, or any
-- signed-in caller while the match is published looking for players.
drop policy if exists partidos_select_public_reader on public.partidos;
create policy partidos_select_public_reader on public.partidos
  for select to core_match_public_reader
  using (
    (select app_private.request_user_id()) is not null
    and (
      coalesce(creado_por, admin_id) = (select app_private.request_user_id())
      or (
        deleted_at is null
        and (
          admin_id = (select app_private.request_user_id())
          or public.partido_is_operationally_open(
            estado, deleted_at, survey_status, result_status, finished_at, fecha, hora,
            coalesce(falta_jugadores, false) or coalesce(busca_arquero, false),
            now()
          )
          or app_private.match_involves_user(id, (select app_private.request_user_id()))
        )
      )
    )
  );

drop policy if exists jugadores_select_public_reader on public.jugadores;
create policy jugadores_select_public_reader on public.jugadores
  for select to core_match_public_reader
  using (
    (select app_private.request_user_id()) is not null
    and (
      partido_id is null
      or usuario_id = (select app_private.request_user_id())
      or app_private.match_involves_user(partido_id, (select app_private.request_user_id()))
      or app_private.match_is_publicly_open(partido_id)
    )
  );

-- The table: only those involved (no more published-match clause).
drop policy if exists partidos_select_authenticated on public.partidos;
create policy partidos_select_authenticated on public.partidos
  for select to authenticated
  using (
    coalesce(creado_por, admin_id) = (select auth.uid())
    or (
      deleted_at is null
      and (
        admin_id = (select auth.uid())
        or app_private.match_involves_user(id)
      )
    )
  );

create or replace view public.partidos_view as
 SELECT id,
    uuid,
    match_ref,
    app_private.match_access_code(id) AS codigo,
    nombre,
    fecha,
    hora,
    sede,
    "sedeMaps",
    modalidad,
    tipo_partido,
    cupo_jugadores,
    falta_jugadores,
    precio_cancha,
    creado_por,
    admin_id,
    equipos_json,
    equipos_generados,
    teams_confirmed,
    awards_status,
    awards_resolved_at,
    estado,
    deleted_at,
    created_at,
    updated_at,
    busca_arquero,
    player_invites_enabled
   FROM public.partidos p
  WHERE deleted_at IS NULL;

alter view public.partidos_view owner to core_match_public_reader;
alter view public.partidos_abiertos_operativos owner to core_match_public_reader;
alter view public.partidos_abiertos_operativos_v2 owner to core_match_public_reader;
alter view public.partidos_view set (security_invoker = false);
alter view public.partidos_abiertos_operativos set (security_invoker = false);
alter view public.partidos_abiertos_operativos_v2 set (security_invoker = false);

do $$
begin
  if exists (
    select 1 from pg_policy
    where polrelid = 'public.partidos'::regclass and polname = 'partidos_select_authenticated'
      and pg_get_expr(polqual, polrelid) ~* 'partido_is_operationally_open'
  ) then
    raise exception 'partidos_select_authenticated must not return published matches to everyone';
  end if;
  if exists (select 1 from pg_roles where rolname = 'core_match_public_reader' and (rolcanlogin or rolbypassrls or rolsuper)) then
    raise exception 'core_match_public_reader must not log in nor bypass RLS';
  end if;
  if (select count(*) from pg_class where relname in ('partidos_view', 'partidos_abiertos_operativos', 'partidos_abiertos_operativos_v2')
        and pg_get_userbyid(relowner) = 'core_match_public_reader') <> 3 then
    raise exception 'the three match views must be read as core_match_public_reader';
  end if;
end;
$$;
