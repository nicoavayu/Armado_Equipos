-- Core: a match and its roster are visible to the people involved in it, plus the matches
-- published to find players — not to every signed-in account.
--
-- partidos_select_authenticated was (deleted_at IS NULL OR admin) and
-- jugadores_select_authenticated was USING (true): any account (sign-up is open) listed
-- every match with its access code (partidos.codigo) and every roster (name, photo,
-- usuario_id of each player). Revoking columns would break installed apps (1.1.21 reads
-- partidos with select('*') and subscribes to partidos/jugadores in realtime), so the rule
-- is per ROW, which keeps the shape of every response:
--   * a match row is visible to its organizer/admin, to whoever is on its roster, asked to
--     join it, or got a notification about it (invitation, call to vote, …), and — while it
--     is published looking for players (the "Quiero jugar" rule,
--     partido_is_operationally_open) — to any signed-in account, like the listing already
--     shows it (installed apps open that match reading the table);
--   * a roster row follows its match; rows without a match (team/challenge players) and the
--     caller's own rows stay visible;
--   * deleted matches stay visible only to their admin (unchanged);
--   * anon still reads no rows (no anon policy, unchanged); voting by link and invitations
--     go through their RPCs (security definer), which are unaffected.
-- Consequence by design: lists that used to scan every roster (challenge player base,
-- "find player by name") only see the players of matches the caller is involved in, plus
-- team players. Residual by design: the code of a match published looking for players is
-- readable by signed-in accounts while it stays published (it disappears once the match
-- stops looking for players).

create index if not exists match_join_requests_match_user_idx
  on public.match_join_requests (match_id, user_id);
create index if not exists notifications_user_partido_idx
  on public.notifications (user_id, partido_id);

create or replace function app_private.match_involves_user(
  p_partido_id bigint,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select p_partido_id is not null and p_user_id is not null and (
    exists (
      select 1 from public.partidos m
      where m.id = p_partido_id and p_user_id in (m.creado_por, m.admin_id)
    )
    or exists (
      select 1 from public.jugadores j
      where j.partido_id = p_partido_id and j.usuario_id = p_user_id
    )
    -- Roster rows linked by match_ref (Core Production's policies honor that link too).
    or exists (
      select 1 from public.partidos m
      join public.jugadores j on j.match_ref = m.match_ref
      where m.id = p_partido_id and m.match_ref is not null and j.usuario_id = p_user_id
    )
    or exists (
      select 1 from public.match_join_requests r
      where r.match_id = p_partido_id and r.user_id = p_user_id
    )
    or exists (
      select 1 from public.notifications n
      where n.user_id = p_user_id
        and (
          n.partido_id = p_partido_id
          or n.data ->> 'match_id' = p_partido_id::text
          or n.data ->> 'matchId' = p_partido_id::text
        )
    )
  )
$function$;

create or replace function app_private.match_is_publicly_open(p_partido_id bigint)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select exists (
    select 1
    from public.partidos m
    where m.id = p_partido_id
      and public.partido_is_operationally_open(
        m.estado, m.deleted_at, m.survey_status, m.result_status, m.finished_at, m.fecha, m.hora,
        coalesce(m.falta_jugadores, false) or coalesce(m.busca_arquero, false),
        now()
      )
  )
$function$;

revoke all on function app_private.match_involves_user(bigint, uuid) from public, anon;
revoke all on function app_private.match_is_publicly_open(bigint) from public, anon;
-- Policies run as the caller: authenticated evaluates them.
grant execute on function app_private.match_involves_user(bigint, uuid) to authenticated;
grant execute on function app_private.match_is_publicly_open(bigint) to authenticated;

drop policy if exists partidos_select_authenticated on public.partidos;
-- The organizer is checked on the row itself: INSERT … RETURNING (how every app creates a
-- match) evaluates this policy on the new row, which a lookup by id cannot see yet.
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

drop policy if exists jugadores_select_authenticated on public.jugadores;
create policy jugadores_select_authenticated on public.jugadores
  for select to authenticated
  using (
    partido_id is null
    or usuario_id = (select auth.uid())
    or app_private.match_involves_user(partido_id)
    or app_private.match_is_publicly_open(partido_id)
  );

do $$
begin
  if not exists (
    select 1 from pg_policy
    where polrelid = 'public.jugadores'::regclass and polname = 'jugadores_select_authenticated'
      and pg_get_expr(polqual, polrelid) <> 'true'
  ) then
    raise exception 'jugadores_select_authenticated must not be USING (true)';
  end if;
  if exists (
    select 1 from pg_policy
    where polrelid = 'public.partidos'::regclass and polcmd in ('r', '*')
      and pg_get_expr(polqual, polrelid) ~ '^\(*deleted_at IS NULL\)* OR '
  ) then
    raise exception 'partidos_select_authenticated still lists every non-deleted match';
  end if;
end;
$$;
