-- Core: who each player is stays with the organizer and the roster, on Core Production's real
-- columns too.
--
-- Gate B on the real schema (2026-10-09) found what 20261010140000 still let through to an
-- account outside the match and to anon (WhatsApp link):
--   * jugadores.uuid: the app writes the player's ACCOUNT id there when an account joins
--     (QuieroJugar and others: uuid = profile.id); for a guest it is the device's guest key,
--     which guest RPCs accept as the guest's identity (player_row.uuid = p_guest_uuid).
--     140000 removed usuario_id but kept uuid: get_public_match_roster, public_get_match_by_code
--     and partidos_view's embedded roster still gave every account id;
--   * jugadores.responsabilidad_score (Production only): a per-player rating, given to all;
--   * "involved" (app_private.match_involves_user) counts a pending join request and any
--     notification about the match, so an account that only asked to join got usuario_id and
--     score of the whole roster, from the RPC and from the table. Nico's rule: organizer + roster.
-- Fix:
--   * app_private.match_roster_identity_visible(match, user): organizer/admin or roster
--     (partido_id or Production's match_ref link). It decides who gets full roster entries, in
--     the views, both RPCs and the jugadores table; match_involves_user keeps deciding who may
--     open a match (a requester or invitee still sees the match and its roster, masked);
--   * for everyone else a roster entry has no usuario_id, score or responsabilidad_score, and
--     its uuid is an opaque key derived from the row id (md5('arma2-roster-entry:' || id)),
--     stable and unique per row, so pages that key votes or list items by uuid keep working
--     (votes go by the numeric id). has_account / is_me as before. One's own row stays whole;
--   * public.jugadores (and realtime): rows of a match only for its organizer and roster, plus
--     one's own rows; match-less rows: team rosters (no match_ref) as before, Production's
--     legacy match_ref-only rows only for that match's organizer and roster.
-- Effect on installed 1.1.21: an account invited to (or that asked to join) a match it is not
-- in sees that match with an empty roster from the table, as for published matches since
-- 140000; joining by invitation, request or link is unchanged.

create or replace function app_private.match_roster_identity_visible(
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
    or exists (
      select 1 from public.partidos m
      join public.jugadores j on j.match_ref = m.match_ref
      where m.id = p_partido_id and m.match_ref is not null and j.usuario_id = p_user_id
    )
  )
$function$;

-- Production's legacy roster rows linked only by match_ref (no partido_id).
create or replace function app_private.match_ref_roster_identity_visible(
  p_match_ref uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select p_match_ref is not null and p_user_id is not null and (
    exists (
      select 1 from public.partidos m
      where m.match_ref = p_match_ref and p_user_id in (m.creado_por, m.admin_id)
    )
    or exists (
      select 1 from public.jugadores j
      where j.match_ref = p_match_ref and j.usuario_id = p_user_id
    )
  )
$function$;
revoke all on function app_private.match_roster_identity_visible(bigint, uuid) from public;
revoke all on function app_private.match_ref_roster_identity_visible(uuid, uuid) from public;
-- Functions inside views and policies run with the caller's EXECUTE (see 20261010137000).
grant execute on function app_private.match_roster_identity_visible(bigint, uuid)
  to anon, authenticated, service_role, core_match_public_reader;
grant execute on function app_private.match_ref_roster_identity_visible(uuid, uuid)
  to anon, authenticated, service_role, core_match_public_reader;

-- ---------- one entry, as the caller may see it ----------
create or replace function app_private.roster_entry_json(p_entry jsonb, p_owner uuid, p_full boolean)
returns jsonb
language sql
stable
set search_path to ''
as $function$
  select
    case
      when coalesce(p_full, false) or p_owner = app_private.request_user_id() then p_entry
      else (p_entry - array['usuario_id', 'score', 'responsabilidad_score', 'uuid'])
        || case
             when p_entry ? 'uuid' and p_entry ->> 'id' is not null
               then jsonb_build_object('uuid', md5('arma2-roster-entry:' || (p_entry ->> 'id'))::uuid)
             else '{}'::jsonb
           end
    end
    || jsonb_build_object(
      'has_account', p_owner is not null,
      'is_me', p_owner is not null and p_owner = app_private.request_user_id()
    )
$function$;

create or replace function app_private.roster_entry(p_player public.jugadores, p_full boolean)
returns jsonb
language sql
stable
set search_path to ''
as $function$
  select app_private.roster_entry_json(to_jsonb(p_player), p_player.usuario_id, p_full)
$function$;

-- ---------- the views: full entries only for organizer and roster ----------
do $roster_views$
declare
  v_view text;
  v_def text;
  v_opts text;
  v_old constant text := 'app_private.match_involves_user(p.id, app_private.request_user_id())) ORDER BY j.id)';
  v_new constant text := 'app_private.match_roster_identity_visible(p.id, app_private.request_user_id())) ORDER BY j.id)';
begin
  foreach v_view in array array['partidos_view', 'partidos_abiertos_operativos', 'partidos_abiertos_operativos_v2'] loop
    if to_regclass(format('public.%I', v_view)) is null then
      continue;
    end if;
    v_def := pg_get_viewdef(format('public.%I', v_view)::regclass);
    if position(v_old in v_def) = 0 then
      continue;
    end if;
    select array_to_string(c.reloptions, ', ') into v_opts from pg_class c where c.oid = format('public.%I', v_view)::regclass;
    execute format('create or replace view public.%I as %s', v_view, replace(v_def, v_old, v_new));
    if v_opts is not null then
      execute format('alter view public.%I set (%s)', v_view, v_opts);
    end if;
  end loop;
end
$roster_views$;

-- ---------- the table (and realtime) ----------
drop policy if exists jugadores_select_authenticated on public.jugadores;
create policy jugadores_select_authenticated on public.jugadores
  for select to authenticated
  using (
    usuario_id = (select auth.uid())
    or (partido_id is null and match_ref is null)
    or (partido_id is null and app_private.match_ref_roster_identity_visible(match_ref))
    or app_private.match_roster_identity_visible(partido_id)
  );

-- ---------- link code and public roster: same entries ----------
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
        app_private.roster_entry(roster_player, app_private.match_roster_identity_visible(match_row.id, auth.uid()))
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

create or replace function public.get_public_match_roster(p_partido_id bigint)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  select coalesce((
    select jsonb_agg(app_private.roster_entry(roster_player, v.full_entries) order by roster_player.id)
    from public.jugadores roster_player
    where roster_player.partido_id = p_partido_id
  ), '[]'::jsonb)
  from (
    select app_private.match_involves_user(p_partido_id, auth.uid()) as involved,
           app_private.match_roster_identity_visible(p_partido_id, auth.uid()) as full_entries
  ) v
  where auth.uid() is not null
    and (v.involved or app_private.match_is_publicly_open(p_partido_id))
$function$;

do $$
declare
  v_view text;
begin
  foreach v_view in array array['partidos_view', 'partidos_abiertos_operativos', 'partidos_abiertos_operativos_v2'] loop
    if to_regclass(format('public.%I', v_view)) is not null
       and pg_get_viewdef(format('public.%I', v_view)::regclass) ~ 'jsonb_agg'
       and pg_get_viewdef(format('public.%I', v_view)::regclass) ~ 'roster_entry_json'
       and pg_get_viewdef(format('public.%I', v_view)::regclass) !~ 'match_roster_identity_visible' then
      raise exception '% still gives full roster entries to every involved account', v_view;
    end if;
  end loop;
  if pg_get_functiondef('public.public_get_match_by_code(text,bigint)'::regprocedure) !~ 'match_roster_identity_visible'
     or pg_get_functiondef('public.get_public_match_roster(bigint)'::regprocedure) !~ 'match_roster_identity_visible' then
    raise exception 'roster RPCs still give full entries to every involved account';
  end if;
end;
$$;
