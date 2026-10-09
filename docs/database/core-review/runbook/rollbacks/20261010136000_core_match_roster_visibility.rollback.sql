-- Rollback of 20261010136000 (match and roster visibility). Run as postgres, in one transaction,
-- after the rollback of 137000. Data: none touched. Effect: any signed-in account lists every
-- match (with its code) and every roster again. The two indexes stay (harmless).
drop policy if exists partidos_select_authenticated on public.partidos;
create policy partidos_select_authenticated on public.partidos
  for select to authenticated
  using ((deleted_at is null) or app_private.is_match_admin(id));
drop policy if exists jugadores_select_authenticated on public.jugadores;
create policy jugadores_select_authenticated on public.jugadores
  for select to authenticated
  using (true);
drop function if exists app_private.match_is_publicly_open(bigint);
drop function if exists app_private.match_involves_user(bigint, uuid);
delete from supabase_migrations.schema_migrations where version = '20261010136000';
