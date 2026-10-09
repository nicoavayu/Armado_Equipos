-- DRAFT — option A for Nico (2026-10-09). NOT in supabase/migrations, NOT in apply-193.psql.
-- Core: the row of a match in public.partidos (and its codigo) only for its organizer and roster.
--
-- Gate B found that partidos_select_authenticated still lets every account "involved" through
-- app_private.match_involves_user (a join request in any state, any notification about the
-- match) read the match row from the table, including partidos.codigo, the code of the
-- WhatsApp voting/guest link. Any account can request to join a published match and then read
-- its code (get_match_access_codes and partidos_view already hide it from them).
-- This draft narrows that clause to app_private.match_roster_identity_visible (20261010143000:
-- organizer/admin or roster, incl. Production's match_ref link). Unchanged:
--   * partidos_view and the "Quiero jugar" views (they read as core_match_public_reader, whose
--     policy still lets an involved account see the match, with the code masked);
--   * get_public_match_roster (masked), public_get_match_by_code (needs the code), the organizer's
--     and roster's reads, partidos_insert_own and Production's UPDATE/DELETE policies.
-- Effect to verify with 1.1.21 (gate B): an account invited to a PRIVATE match, or with a
-- pending request, no longer gets that match from the table (select('*') by id returns no row;
-- realtime follows). It still sees it in partidos_view (code masked) and can still join by the
-- invitation, the approved request or the validated link.
-- Requires 20261010143000. Rollback: drafts/20261010144000_core_partidos_row_roster_only.rollback.sql.

drop policy if exists partidos_select_authenticated on public.partidos;
create policy partidos_select_authenticated on public.partidos
  for select to authenticated
  using (
    (coalesce(creado_por, admin_id) = (select auth.uid()))
    or (deleted_at is null and ((admin_id = (select auth.uid())) or app_private.match_roster_identity_visible(id)))
  );

do $$
begin
  if (select pg_get_expr(polqual, polrelid) from pg_policy
      where polrelid = 'public.partidos'::regclass and polname = 'partidos_select_authenticated') ~ 'match_involves_user' then
    raise exception 'partidos_select_authenticated still lets every involved account read the row';
  end if;
end;
$$;
