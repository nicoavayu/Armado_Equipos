-- Rollback of 20261010137000 (match code never public). Run as postgres, in one transaction.
-- Data: none touched. Effect: back to 20261010136000 — any signed-in account reads from the
-- table every match published looking for players, with its code (the link-voting credential).
-- partidos_view keeps the three appended columns (busca_arquero, player_invites_enabled,
-- precio_cancha_por_persona): CREATE OR REPLACE cannot drop columns and no client breaks on
-- extra columns. Anon keeps EXECUTE on the three pure helpers (no data behind them).
drop policy if exists partidos_select_authenticated on public.partidos;
create policy partidos_select_authenticated on public.partidos
  for select to authenticated
  using (
    coalesce(creado_por, admin_id) = (select auth.uid())
    or (
      deleted_at is null
      and (
        admin_id = (select auth.uid())
        or public.partido_is_operationally_open(
          estado, deleted_at, survey_status, result_status, finished_at, fecha, hora,
          coalesce(falta_jugadores, false) or coalesce(busca_arquero, false),
          now()
        )
        or app_private.match_involves_user(id)
      )
    )
  );
drop policy if exists partidos_select_public_reader on public.partidos;
drop policy if exists jugadores_select_public_reader on public.jugadores;

-- The views go back to postgres and run as the caller again (their grants move with them).
alter view public.partidos_view owner to postgres;
alter view public.partidos_abiertos_operativos owner to postgres;
alter view public.partidos_abiertos_operativos_v2 owner to postgres;
alter view public.partidos_view set (security_invoker = on);
alter view public.partidos_abiertos_operativos set (security_invoker = on);
alter view public.partidos_abiertos_operativos_v2 set (security_invoker = on);

revoke execute on function app_private.match_involves_user(bigint, uuid) from anon, core_match_public_reader;
revoke execute on function app_private.match_is_publicly_open(bigint) from anon, core_match_public_reader;
revoke execute on function app_private.match_access_code(bigint) from core_match_public_reader;
revoke execute on function public.partido_is_operationally_open(text, timestamp with time zone, text, text, timestamp with time zone, date, text, boolean, timestamp with time zone) from core_match_public_reader;
revoke execute on function public.normalize_partido_estado(text) from core_match_public_reader;
revoke execute on function public.partido_kickoff_at(date, text) from core_match_public_reader;
revoke select on table public.partidos, public.jugadores from core_match_public_reader;
revoke usage on schema public, app_private from core_match_public_reader;
drop function if exists app_private.request_user_id();
drop role if exists core_match_public_reader;
delete from supabase_migrations.schema_migrations where version = '20261010137000';
