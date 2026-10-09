-- Rollback of 20261010144000 (partidos row and codigo only for organizer and roster). Run as
-- postgres, in one transaction, after the rollbacks of 146000 and 145000 and before 143000's.
-- Data: none. Effect: back to 20261010137000's partidos_select_authenticated — every involved
-- account, also a pending requester or a notified one, reads the match row and its codigo.
drop policy if exists partidos_select_authenticated on public.partidos;
create policy partidos_select_authenticated on public.partidos
  for select to authenticated
  using (
    (coalesce(creado_por, admin_id) = (select auth.uid()))
    or (deleted_at is null and ((admin_id = (select auth.uid())) or app_private.match_involves_user(id)))
  );
delete from supabase_migrations.schema_migrations where version = '20261010144000';
