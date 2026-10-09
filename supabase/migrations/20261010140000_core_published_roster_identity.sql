-- Core: the roster of a published match keeps only what the public page needs for those who
-- are not involved: who each player is (the account behind a name) and their rating stay with
-- the organizer and the roster.
--
-- After 20261010139000, any signed-in account still read from the roster of a match published
-- looking for players (table, realtime, "Quiero jugar" views) and anyone with the link code
-- (public_get_match_by_code) each player's usuario_id and score. usuario_id leads to the
-- public profile (city, ~1 km location, bio, stats) and to where and when that person plays;
-- score is the 1–10 rating peers gave them. Nico decided to close it now (2026-10-09).
--
-- Reads, for an account not involved in the match (involved = organizer/admin, roster, join
-- request, notification; app_private.match_involves_user) and for anon:
--   * public.jugadores: no row of a published match anymore (the published clause of
--     jugadores_select_authenticated goes away; own rows, rosters of matches one is involved
--     in and team rows stay). Realtime follows. Installed 1.1.21 then shows that page with an
--     empty roster: what it can still DO is enforced below, not by what it shows;
--   * partidos_abiertos_operativos(_v2) and get_open_matches_for_quiero_jugar_v2: each roster
--     entry without usuario_id and score, plus has_account / is_me (involved: everything);
--   * public_get_match_by_code (WhatsApp voting and guest links): the same entries, so the
--     "¿Quién sos?" list (guests = has_account false), its photo and its vote keep working;
--   * get_public_match_roster(id): the roster of a published (or own) match for the web's
--     public page, with the same entries.
-- Writes (server-side, whatever the client shows):
--   * jugadores INSERT of oneself: only the match admin, or an account invited to the match
--     (a match_invite notification not superseded by a kick), with an approved join request,
--     or that validated the guest invite link (code + token) in the last 24 h —
--     validate_guest_match_invite now records that for a signed-in caller. Before, any account
--     could insert itself into any match. Capacity stays enforced by assign_substitute_slot
--     (the match row is locked FOR UPDATE: cupo starters + 4 substitutes, then an error);
--   * jugadores UPDATE of one's own row by a non-admin: only nombre, avatar_url and posicion
--     (the app renames and re-photographs its own rows). Moving the row to another match,
--     promoting oneself from substitute, or changing one's score is refused;
--   * match_join_requests INSERT by an account: always 'pending' (never approved/decided by
--     its own author), one per account and match (any earlier request → unique_violation
--     23505, which 1.1.21 and the web already turn into "reopen" through
--     reopen_own_match_join_request), never for a deleted or cancelled match. Serialized with
--     an advisory lock per (match, account).

-- ---------- roster entries as the viewer may see them ----------
create or replace function app_private.roster_entry(p_player public.jugadores, p_full boolean)
returns jsonb
language sql
stable
set search_path to ''
as $function$
  select
    case
      when coalesce(p_full, false) or p_player.usuario_id = app_private.request_user_id()
        then to_jsonb(p_player)
      else to_jsonb(p_player) - array['usuario_id', 'score']
    end
    || jsonb_build_object(
      'has_account', p_player.usuario_id is not null,
      'is_me', p_player.usuario_id is not null and p_player.usuario_id = app_private.request_user_id()
    )
$function$;
-- Functions inside views run with the caller's EXECUTE (see 20261010137000).
grant execute on function app_private.roster_entry(public.jugadores, boolean) to anon, authenticated, core_match_public_reader;

-- The same rule for a roster entry already built as json (the views build their own).
create or replace function app_private.roster_entry_json(p_entry jsonb, p_owner uuid, p_full boolean)
returns jsonb
language sql
stable
set search_path to ''
as $function$
  select
    case
      when coalesce(p_full, false) or p_owner = app_private.request_user_id() then p_entry
      else p_entry - array['usuario_id', 'score']
    end
    || jsonb_build_object(
      'has_account', p_owner is not null,
      'is_me', p_owner is not null and p_owner = app_private.request_user_id()
    )
$function$;
grant execute on function app_private.roster_entry_json(jsonb, uuid, boolean) to anon, authenticated, core_match_public_reader;

-- Every match view that embeds its roster (the "Quiero jugar" views; in Core Production also
-- partidos_view) builds each entry through roster_entry_json. The views are rewritten from
-- their CURRENT definition: only the roster aggregate changes.
do $roster_views$
declare
  v_view text;
  v_def text;
  v_new text;
begin
  foreach v_view in array array['partidos_view', 'partidos_abiertos_operativos', 'partidos_abiertos_operativos_v2'] loop
    v_def := pg_get_viewdef(format('public.%I', v_view)::regclass);
    if v_def ~ 'roster_entry_json' or v_def !~ 'jsonb_agg\(.+? ORDER BY j\.id\)' then
      continue;
    end if;
    v_new := regexp_replace(v_def, 'jsonb_agg\((.+?) ORDER BY j\.id\)',
      'jsonb_agg(app_private.roster_entry_json(\1, j.usuario_id, app_private.match_involves_user(p.id, app_private.request_user_id())) ORDER BY j.id)');
    execute format('create or replace view public.%I as %s', v_view, v_new);
    execute format('alter view public.%I set (security_invoker = false)', v_view);
  end loop;
end
$roster_views$;

-- ---------- the table: no published-match clause for jugadores ----------
drop policy if exists jugadores_select_authenticated on public.jugadores;
create policy jugadores_select_authenticated on public.jugadores
  for select to authenticated
  using (
    partido_id is null
    or usuario_id = (select auth.uid())
    or app_private.match_involves_user(partido_id)
  );

-- ---------- link code: same entries ----------
create or replace function public.public_get_match_by_code(p_codigo text, p_partido_id bigint default null::bigint)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  select jsonb_build_object(
    'partido', to_jsonb(match_row),
    'jugadores', coalesce((
      select jsonb_agg(
        app_private.roster_entry(roster_player, app_private.match_involves_user(match_row.id, auth.uid()))
        order by roster_player.id
      )
      from public.jugadores roster_player
      where roster_player.partido_id = match_row.id
    ), '[]'::jsonb)
  )
  from public.partidos match_row
  where nullif(btrim(coalesce(p_codigo, '')), '') is not null
    and upper(btrim(match_row.codigo)) = upper(btrim(p_codigo))
    and (p_partido_id is null or match_row.id = p_partido_id)
    and match_row.deleted_at is null
    and public.normalize_partido_estado(match_row.estado) not in ('deleted', 'cancelado')
  order by match_row.id desc
  limit 1
$function$;

-- ---------- the web's public page ----------
create or replace function public.get_public_match_roster(p_partido_id bigint)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  select coalesce((
    select jsonb_agg(app_private.roster_entry(roster_player, v.involved) order by roster_player.id)
    from public.jugadores roster_player
    where roster_player.partido_id = p_partido_id
  ), '[]'::jsonb)
  from (select app_private.match_involves_user(p_partido_id, auth.uid()) as involved) v
  where auth.uid() is not null
    and (v.involved or app_private.match_is_publicly_open(p_partido_id))
$function$;
revoke all on function public.get_public_match_roster(bigint) from public, anon;
grant execute on function public.get_public_match_roster(bigint) to authenticated;

-- ---------- joining: who may insert themselves ----------
create table if not exists app_private.match_link_access (
  partido_id bigint not null references public.partidos (id) on delete cascade,
  user_id uuid not null,
  granted_at timestamptz not null default now(),
  primary key (partido_id, user_id)
);
revoke all on table app_private.match_link_access from public, anon, authenticated;

create or replace function public.validate_guest_match_invite(p_partido_id bigint, p_codigo text, p_token text)
returns table(ok boolean, reason text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_match_code text;
  v_token text := trim(coalesce(p_token, ''));
begin
  select trim(coalesce(p.codigo, ''))
  into v_match_code
  from public.partidos p
  where p.id = p_partido_id;

  if not found then
    return query select false, 'not_found'::text;
    return;
  end if;

  if trim(coalesce(p_codigo, '')) = '' or trim(coalesce(p_codigo, '')) <> v_match_code then
    return query select false, 'invalid_code'::text;
    return;
  end if;

  if v_token = '' then
    return query select false, 'invalid_invite'::text;
    return;
  end if;

  if not exists (
    select 1
    from public.guest_match_invites g
    where g.partido_id = p_partido_id
      and g.token = v_token
      and g.revoked_at is null
      and g.expires_at > now()
      and g.uses_count < g.max_uses
  ) then
    return query select false, 'invalid_invite'::text;
    return;
  end if;

  -- A signed-in account that opened a valid invite link may now join that match itself
  -- (installed apps and the web insert their own roster row after this check).
  if auth.uid() is not null then
    insert into app_private.match_link_access (partido_id, user_id, granted_at)
    values (p_partido_id, auth.uid(), now())
    on conflict (partido_id, user_id) do update set granted_at = excluded.granted_at;
  end if;

  return query select true, null::text;
end;
$function$;

create or replace function app_private.may_self_join_match(p_partido_id bigint, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  with match_row as (
    select m.id
    from public.partidos m
    where m.id = p_partido_id
      and m.deleted_at is null
      and public.normalize_partido_estado(m.estado) not in ('deleted', 'cancelado')
  ),
  notices as (
    select n.type, lower(btrim(coalesce(n.data ->> 'status', ''))) as status,
           coalesce(n.send_at, n.created_at) as at
    from public.notifications n
    where n.user_id = p_user_id
      and n.type in ('match_invite', 'match_kicked')
      and (
        n.partido_id = p_partido_id
        or n.data ->> 'match_id' = p_partido_id::text
        or n.data ->> 'matchId' = p_partido_id::text
      )
  ),
  last_kick as (
    select max(at) as at from notices where type = 'match_kicked'
  ),
  grants as (
    select at from notices
    where type = 'match_invite' and status in ('', 'pending', 'sent', 'accepted')
    union all
    select coalesce(r.decided_at, r.created_at)
    from public.match_join_requests r
    where r.match_id = p_partido_id and r.user_id = p_user_id and r.status = 'approved'
    union all
    select a.granted_at
    from app_private.match_link_access a
    where a.partido_id = p_partido_id and a.user_id = p_user_id
      and a.granted_at > now() - interval '24 hours'
  )
  select p_user_id is not null
    and exists (select 1 from match_row)
    and exists (
      select 1 from grants g, last_kick k
      where k.at is null or g.at > k.at
    )
$function$;
revoke all on function app_private.may_self_join_match(bigint, uuid) from public, anon;
grant execute on function app_private.may_self_join_match(bigint, uuid) to authenticated;

drop policy if exists jugadores_insert_self_or_admin on public.jugadores;
create policy jugadores_insert_self_or_admin on public.jugadores
  for insert to authenticated
  with check (
    app_private.is_match_admin(partido_id)
    or (
      usuario_id = (select auth.uid())
      and (partido_id is null or app_private.may_self_join_match(partido_id))
    )
  );

-- ---------- one's own roster row: only name, photo, position ----------
-- SECURITY INVOKER on purpose: a client's own UPDATE runs as authenticated and is checked;
-- server functions that move players (substitute promotion, team saves) run as their owner
-- and are not.
create or replace function app_private.tg_jugadores_self_update_guard()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if current_user not in ('authenticated', 'anon') or old.partido_id is null then
    return new;
  end if;
  if app_private.is_match_admin(old.partido_id) then
    return new;
  end if;
  if (to_jsonb(new) - array['nombre', 'avatar_url', 'posicion', 'updated_at'])
     is distinct from (to_jsonb(old) - array['nombre', 'avatar_url', 'posicion', 'updated_at']) then
    raise exception 'not_authorized: solo el organizador cambia el partido, el puesto o el puntaje de un jugador'
      using errcode = '42501';
  end if;
  return new;
end;
$function$;
revoke all on function app_private.tg_jugadores_self_update_guard() from public, anon, authenticated;

drop trigger if exists trg_jugadores_self_update_guard on public.jugadores;
create trigger trg_jugadores_self_update_guard
before update on public.jugadores
for each row execute function app_private.tg_jugadores_self_update_guard();

-- ---------- join requests: pending, one per account and match ----------
-- The requester may not see the match row anymore (20261010137000): this answers only
-- whether it takes a request from this account — a live match that is published looking for
-- players, or one the account is already involved in (an invitation or suggestion it got). A
-- private match is not open to requests from strangers.
drop function if exists app_private.match_accepts_requests(bigint);
create or replace function app_private.match_accepts_requests(p_match_id bigint, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select exists (
    select 1 from public.partidos m
    where m.id = p_match_id
      and m.deleted_at is null
      and public.normalize_partido_estado(m.estado) not in ('deleted', 'cancelado')
  )
  and (app_private.match_is_publicly_open(p_match_id) or app_private.match_involves_user(p_match_id, p_user_id))
$function$;
revoke all on function app_private.match_accepts_requests(bigint, uuid) from public, anon;
grant execute on function app_private.match_accepts_requests(bigint, uuid) to authenticated;

-- SECURITY INVOKER on purpose (same reason as above): only an account's own INSERT is checked.
create or replace function app_private.tg_match_join_request_insert_guard()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('match_join_request:' || new.match_id || ':' || new.user_id, 0));

  if lower(btrim(coalesce(new.status, 'pending'))) <> 'pending'
     or (to_jsonb(new) ->> 'decided_at') is not null or (to_jsonb(new) ->> 'decided_by') is not null
     or (to_jsonb(new) ->> 'cancelled_at') is not null then
    raise exception 'not_authorized: una solicitud nueva siempre queda pendiente'
      using errcode = '42501';
  end if;

  if not app_private.match_accepts_requests(new.match_id, new.user_id) then
    raise exception 'match_not_available' using errcode = 'P0001';
  end if;

  -- The account reads its own requests (policy "user can read own requests").
  if exists (
    select 1 from public.match_join_requests r
    where r.match_id = new.match_id and r.user_id = new.user_id
  ) then
    raise exception 'duplicate join request for this match'
      using errcode = '23505';
  end if;

  return new;
end;
$function$;
revoke all on function app_private.tg_match_join_request_insert_guard() from public, anon, authenticated;

drop trigger if exists trg_match_join_request_insert_guard on public.match_join_requests;
create trigger trg_match_join_request_insert_guard
before insert on public.match_join_requests
for each row execute function app_private.tg_match_join_request_insert_guard();

do $$
begin
  if exists (
    select 1 from pg_policy
    where polrelid = 'public.jugadores'::regclass and polname = 'jugadores_select_authenticated'
      and pg_get_expr(polqual, polrelid) ~ 'match_is_publicly_open'
  ) then
    raise exception 'jugadores_select_authenticated must not return published rosters to everyone';
  end if;
  if exists (
    select 1 from pg_class
    where relnamespace = 'public'::regnamespace
      and relname in ('partidos_view', 'partidos_abiertos_operativos', 'partidos_abiertos_operativos_v2')
      and ((pg_get_viewdef(oid) ~ 'jsonb_agg\(' and pg_get_viewdef(oid) !~ 'roster_entry_json')
           or pg_get_userbyid(relowner) <> 'core_match_public_reader')
  ) then
    raise exception 'match views must build roster entries with app_private.roster_entry_json and stay owned by the reader';
  end if;
  if (select prosrc from pg_proc where oid = 'public.public_get_match_by_code(text,bigint)'::regprocedure) !~ 'roster_entry' then
    raise exception 'public_get_match_by_code must build roster entries with app_private.roster_entry';
  end if;
end;
$$;
